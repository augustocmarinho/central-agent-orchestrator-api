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

    // Atualizar status da(s) mensagem(ns) do usuário para "processing"
    // Se é um batch de debounce, atualizar todas as mensagens originais
    const debouncedMessageIds: string[] | undefined = job.data.channelMetadata?.debouncedMessageIds;
    const userMessageId = job.data.channelMetadata?.userMessageId;
    const allUserMessageIds = debouncedMessageIds || (userMessageId ? [userMessageId] : []);

    for (const msgId of allUserMessageIds) {
      try {
        await conversationService.updateMessageStatus(msgId, 'processing', {
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

      logInfo('Agent loaded', { agentId, agentName: agent.name, status: agent.status });

      // 1.1. Se o agente estiver pausado/draft, não gerar resposta
      if (agent.status !== 'active') {
        logInfo('Agent is not active, skipping response generation', {
          agentId,
          status: agent.status,
          channel,
        });

        // Marcar mensagem(ns) do usuário como "delivered" para indicar que foi processada,
        // mas sem resposta automática.
        for (const msgId of allUserMessageIds) {
          try {
            await conversationService.updateMessageStatus(msgId, 'delivered', {
              processedAt: new Date(),
              deliveredAt: new Date(),
            });
          } catch (error: any) {
            logError('Error updating user message status for inactive agent', error);
          }
        }

        const processingTime = Date.now() - startTime;

        // Finalizar o job com sucesso, mas sem resposta
        return {
          success: true,
          messageId: id,
          conversationId,
          response: undefined,
          processingTime,
        };
      }

      // 1.2. Se a conversa estiver pausada, não gerar resposta da IA
      const conversation = await conversationService.getConversation(conversationId);
      if (conversation && conversation.status === 'paused') {
        logInfo('Conversation is paused, skipping AI response', {
          conversationId,
          agentId,
          channel,
        });

        for (const msgId of allUserMessageIds) {
          try {
            await conversationService.updateMessageStatus(msgId, 'delivered', {
              processedAt: new Date(),
              deliveredAt: new Date(),
            });
          } catch (error: any) {
            logError('Error updating message status for paused conversation', error);
          }
        }

        const processingTime = Date.now() - startTime;

        return {
          success: true,
          messageId: id,
          conversationId,
          response: undefined,
          processingTime,
        };
      }

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

      // Aceitar message em response direto ou aninhado (workflow pode retornar { message } ou { response: { message } })
      const messageText =
        (n8nResponse && typeof n8nResponse.message === 'string' && n8nResponse.message) ||
        (n8nResponse && typeof n8nResponse.response === 'string' && n8nResponse.response) ||
        (n8nResponse && typeof n8nResponse === 'string' && n8nResponse);

      if (!messageText || typeof messageText !== 'string') {
        logWarn('Invalid N8N response shape', {
          hasResponse: !!n8nResponse,
          keys: n8nResponse ? Object.keys(n8nResponse) : [],
          sample: n8nResponse ? JSON.stringify(n8nResponse).slice(0, 200) : undefined,
        });
        throw new Error('Invalid N8N response: missing or invalid message');
      }

      const n8nResponseNormalized = {
        ...(typeof n8nResponse === 'object' && n8nResponse !== null ? n8nResponse : {}),
        message: messageText,
      };

      logInfo('N8N response received', { 
        conversationId,
        messageLength: n8nResponseNormalized.message.length,
        tokensUsed: n8nResponseNormalized.tokens_used 
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
          content: n8nResponseNormalized.message,
          type: 'assistant',
          direction: 'outbound',
          channel,
          channelMetadata: job.data.channelMetadata,
          status: 'delivered',
          processedAt: new Date(),
          deliveredAt: new Date(),
          processingTime,
          tokensUsed: n8nResponseNormalized.tokens_used || 0,
          model: n8nResponseNormalized.model || 'unknown',
          finishReason: n8nResponseNormalized.finish_reason || 'stop',
          replyToMessageId: userMessageId,
          jobId: job.id?.toString(),
        });

        // Atualizar status da(s) mensagem(ns) do usuário para "delivered"
        for (const msgId of allUserMessageIds) {
          try {
            await conversationService.updateMessageStatus(msgId, 'delivered', {
              deliveredAt: new Date()
            });
          } catch (error: any) {
            logError('Error updating user message status to delivered', error);
          }
        }
      } catch (error: any) {
        logError('Error saving assistant message', error);
        // Não falhar o job por erro ao salvar no MongoDB
      }

      // 5. Publicar resposta no PubSub (80%)
      job.progress(80);
      await this.publishResponse(job.data, n8nResponseNormalized, processingTime);

      // 5.1 Agendar follow-up automático (se configurado para este agente)
      try {
        const { followUpService } = await import('../../services/followup.service');
        await followUpService.scheduleSequence(
          conversationId,
          agentId,
          job.data.channel,
          job.data.channelMetadata
        );
      } catch (error: any) {
        logError('Error scheduling follow-up', error, { conversationId, agentId });
        // Non-fatal: não falhar o job de mensagem por causa do follow-up
      }

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
        response: n8nResponseNormalized.message,
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

      // Marcar mensagem(ns) do usuário como failed
      for (const msgId of allUserMessageIds) {
        try {
          await conversationService.updateMessageStatus(msgId, 'failed', {
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
      messageType: 'assistant',
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
