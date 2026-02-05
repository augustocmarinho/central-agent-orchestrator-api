import Queue, { Job } from 'bull';
import { redisConnection } from '../../config/redis.config';
import { MessageJob, MessageProcessingResult } from '../../types/queue.types';
import { agentService } from '../../services/agent.service';
import { conversationService } from '../../services/conversation.service';
import { logInfo, logError, logWarn } from '../../utils/logger';
import { n8nService } from '../../services/n8n.service';
import { responsePublisher } from '../pubsub';
import { v4 as uuidv4 } from 'uuid';

/**
 * Consumer de mensagens
 * Responsável por processar jobs da fila
 */
export class MessageConsumer {
  private queue: Queue.Queue<MessageJob>;
  private concurrency: number = 5; // Processar 5 jobs simultâneos

  constructor() {
    this.queue = new Queue<MessageJob>('ai-messages', {
      redis: redisConnection,
      prefix: 'bull',
    });

    this.startProcessing();
    logInfo('✅ Message Consumer initialized');
  }

  /**
   * Inicia o processamento de mensagens
   */
  private startProcessing() {
    this.queue.process(this.concurrency, async (job: Job<MessageJob>) => {
      return this.processMessage(job);
    });

    // Event listeners
    this.queue.on('error', (error) => {
      logError('Consumer queue error', error);
    });
  }

  /**
   * Processa uma mensagem
   */
  private async processMessage(job: Job<MessageJob>): Promise<MessageProcessingResult> {
    const startTime = Date.now();
    const { id, agentId, userId, message, conversationId, channel } = job.data;

    logInfo('🔄 Processing message', { 
      jobId: job.id, 
      messageId: id,
      agentId,
      channel 
    });

    // Atualizar status da mensagem do usuário para "processing"
    const userMessageId = job.data.channelMetadata?.userMessageId;
    if (userMessageId) {
      try {
        await conversationService.updateMessageStatus(userMessageId, 'processing', {
          processedAt: new Date()
        });
      } catch (error: any) {
        logError('Error updating user message status', error);
      }
    }

    try {
      // 1. Buscar contexto do agente (10%)
      job.progress(10);
      const agent = await agentService.getAgentByIdForSystem(agentId);
      
      if (!agent) {
        throw new Error(`Agent ${agentId} not found`);
      }

      logInfo('Agent loaded', { agentId, agentName: agent.name });

      // 2. Preparar payload para N8N (30%)
      // O N8N vai buscar o histórico automaticamente do Redis (chave: chat:{conversationId})
      job.progress(30);
      const n8nPayload = {
        agent_id: agentId,
        message: message,
        conversation_id: conversationId,
      };

      // 3. Chamar workflow N8N (50% - etapa mais demorada)
      job.progress(50);
      logInfo('Calling N8N workflow (OpenAI Chat with Redis)', { conversationId });
      
      const n8nResponse = await n8nService.callOpenAIChatWorkflow(n8nPayload);

      if (!n8nResponse || !n8nResponse.message) {
        throw new Error('Invalid N8N response');
      }

      logInfo('N8N response received', { 
        conversationId,
        messageLength: n8nResponse.message.length,
        tokensUsed: n8nResponse.tokens_used 
      });

      const processingTime = Date.now() - startTime;

      // 4. Salvar resposta do assistente no MongoDB (70%)
      job.progress(70);
      const assistantMessageId = uuidv4();
      try {
        await conversationService.saveMessage({
          messageId: assistantMessageId,
          conversationId,
          agentId,
          userId,
          content: n8nResponse.message,
          type: 'assistant',
          direction: 'outbound',
          channel,
          channelMetadata: job.data.channelMetadata,
          status: 'delivered',
          processedAt: new Date(),
          deliveredAt: new Date(),
          processingTime,
          tokensUsed: n8nResponse.tokens_used || 0,
          model: n8nResponse.model || 'unknown',
          finishReason: n8nResponse.finish_reason || 'stop',
          replyToMessageId: userMessageId,
          jobId: job.id?.toString(),
        });

        // Atualizar status da mensagem do usuário para "delivered"
        if (userMessageId) {
          await conversationService.updateMessageStatus(userMessageId, 'delivered', {
            deliveredAt: new Date()
          });
        }
      } catch (error: any) {
        logError('Error saving assistant message', error);
        // Não falhar o job por erro ao salvar no MongoDB
      }

      // 5. Publicar resposta no PubSub (80%)
      job.progress(80);
      await this.publishResponse(job.data, n8nResponse, processingTime);

      // 6. Finalizado (100%)
      job.progress(100);
      
      logInfo('✅ Message processed successfully', { 
        jobId: job.id,
        messageId: id,
        assistantMessageId,
        processingTime: `${processingTime}ms` 
      });

      return {
        success: true,
        messageId: id,
        conversationId,
        response: n8nResponse.message,
        processingTime,
      };

    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      
      logError('❌ Error processing message', error, { 
        jobId: job.id,
        messageId: id,
        agentId,
        attempt: job.attemptsMade,
        maxAttempts: job.opts.attempts 
      });

      // Marcar mensagem do usuário como failed
      if (userMessageId) {
        try {
          await conversationService.updateMessageStatus(userMessageId, 'failed', {
            error: {
              message: error.message,
              code: 'PROCESSING_ERROR',
            }
          });
        } catch (err: any) {
          logError('Error updating message status to failed', err);
        }
      }

      // Se é a última tentativa, publicar erro
      if (job.attemptsMade >= (job.opts.attempts || 3)) {
        await this.publishError(job.data, error.message, processingTime);
      }

      throw error; // Bull vai fazer retry automaticamente
    }
  }

  /**
   * Publica resposta no PubSub
   */
  private async publishResponse(jobData: MessageJob, n8nResponse: any, processingTime: number) {
    await responsePublisher.publishResponse({
      messageId: jobData.id,
      conversationId: jobData.conversationId,
      agentId: jobData.agentId,
      response: {
        message: n8nResponse.message,
        tokensUsed: n8nResponse.tokens_used || 0,
        model: n8nResponse.model || 'unknown',
        finishReason: n8nResponse.finish_reason || 'stop',
      },
      channel: jobData.channel,
      channelMetadata: jobData.channelMetadata,
      timestamp: new Date().toISOString(),
      processingTime,
    });
  }

  /**
   * Publica erro no PubSub
   */
  private async publishError(jobData: MessageJob, errorMessage: string, processingTime: number) {
    try {
      await responsePublisher.publishResponse({
        messageId: jobData.id,
        conversationId: jobData.conversationId,
        agentId: jobData.agentId,
        response: {
          message: `Desculpe, ocorreu um erro ao processar sua mensagem: ${errorMessage}`,
          tokensUsed: 0,
          model: 'error',
          finishReason: 'error',
        },
        channel: jobData.channel,
        channelMetadata: jobData.channelMetadata,
        timestamp: new Date().toISOString(),
        processingTime,
      });
    } catch (error) {
      logError('Error publishing error response', error as Error);
    }
  }

  /**
   * Fecha o consumer (graceful shutdown)
   */
  async close() {
    try {
      await this.queue.close();
      logInfo('✅ Message Consumer closed');
    } catch (error) {
      logError('Error closing message consumer', error as Error);
    }
  }
}

// Singleton instance
export const messageConsumer = new MessageConsumer();
