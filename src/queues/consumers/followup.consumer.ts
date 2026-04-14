import Queue, { Job } from 'bull';
import { redisConnection, getRedisClient, REDIS_NAMESPACES } from '../../config/redis.config';
import { FollowUpJob, FollowUpState } from '../../types/followup.types';
import { conversationService } from '../../services/conversation.service';
import { agentService } from '../../services/agent.service';
import { followUpService } from '../../services/followup.service';
import { responsePublisher } from '../pubsub';
import { logInfo, logError, logWarn } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Consumer da fila de follow-up
 * Processa jobs delayed que enviam mensagens de acompanhamento.
 *
 * IMPORTANTE: Mensagens de follow-up são salvas e publicadas diretamente aqui,
 * sem passar pelo MessageConsumer, evitando loop infinito de follow-ups.
 */
export class FollowUpConsumer {
  private queue: Queue.Queue<FollowUpJob>;
  private concurrency: number = 3;

  constructor() {
    this.queue = new Queue<FollowUpJob>('ai-messages-followup', {
      redis: redisConnection,
      prefix: 'bull',
    });

    this.startProcessing();
    logInfo('✅ Follow-Up Consumer initialized');
  }

  private startProcessing() {
    this.queue.process(this.concurrency, async (job: Job<FollowUpJob>) => {
      return this.processFollowUp(job);
    });

    this.queue.on('error', (error) => {
      logError('Follow-up consumer queue error', error);
    });
  }

  private async processFollowUp(job: Job<FollowUpJob>): Promise<{ success: boolean }> {
    const {
      conversationId,
      agentId,
      stepOrder,
      messageType,
      customMessage,
      channel,
      channelMetadata,
    } = job.data;

    logInfo('🔄 Processing follow-up', {
      jobId: job.id,
      conversationId,
      agentId,
      step: stepOrder,
      messageType,
    });

    // ─── Guard 1: Redis state existe (sequência não foi cancelada) ────
    const redis = getRedisClient();
    const stateKey = `${REDIS_NAMESPACES.FOLLOWUP_STATE}${conversationId}`;
    const stateRaw = await redis.get(stateKey);

    if (!stateRaw) {
      logInfo('Follow-up skipped (sequence cancelled)', { conversationId, step: stepOrder });
      return { success: true };
    }

    // ─── Guard 2: Conversa ainda ativa ───────────────────────────────
    const conversation = await conversationService.getConversation(conversationId);
    if (!conversation || conversation.status !== 'active') {
      await followUpService.cancelSequence(conversationId);
      logInfo('Follow-up skipped (conversation not active)', {
        conversationId,
        status: conversation?.status,
      });
      return { success: true };
    }

    // ─── Guard 3: Agente ainda ativo ─────────────────────────────────
    const agent = await agentService.getAgentByIdForSystem(agentId);
    if (!agent || agent.status !== 'active') {
      await followUpService.cancelSequence(conversationId);
      logInfo('Follow-up skipped (agent not active)', {
        agentId,
        status: agent?.status,
      });
      return { success: true };
    }

    // ─── Guard 4: Usuário não respondeu desde o agendamento ──────────
    // (proteção contra race condition caso cancelSequence no sendMessage falhe)
    const recentMessages = await conversationService.getConversationMessages(
      conversationId,
      { limit: 1, order: 'desc' }
    );

    if (recentMessages.length > 0 && recentMessages[0].type === 'user') {
      await followUpService.cancelSequence(conversationId);
      logInfo('Follow-up skipped (user replied)', { conversationId });
      return { success: true };
    }

    // ─── Avaliação IA: devo enviar? + gerar mensagem ───────────────────
    // Uma única chamada n8n avalia se a conversa está resolvida E gera o texto
    const state: FollowUpState = JSON.parse(stateRaw);
    const evaluation = await followUpService.evaluateAndPrepareFollowUp(
      conversationId,
      agentId,
      stepOrder,
      state.totalSteps,
      messageType,
      customMessage
    );

    if (!evaluation.shouldSend) {
      // IA determinou que a conversa está resolvida — cancelar sequência
      await followUpService.cancelSequence(conversationId);
      logInfo('Follow-up skipped by AI (conversation resolved)', {
        conversationId,
        agentId,
        step: stepOrder,
      });
      return { success: true };
    }

    const messageContent = evaluation.message!;

    // ─── Salvar mensagem no MongoDB ──────────────────────────────────
    const messageId = uuidv4();
    try {
      await conversationService.saveMessage({
        messageId,
        conversationId,
        agentId,
        content: messageContent,
        type: 'assistant',
        direction: 'outbound',
        channel: channel as any,
        channelMetadata,
        status: 'delivered',
        processedAt: new Date(),
        deliveredAt: new Date(),
        metadata: {
          isFollowUp: true,
          followUpStep: stepOrder,
        },
      });
    } catch (error: any) {
      logError('Error saving follow-up message', error, { conversationId, stepOrder });
      // Não falhar o job por erro ao salvar
    }

    // ─── Publicar via PubSub (reusa delivery existente) ──────────────
    try {
      await responsePublisher.publishResponse({
        messageId,
        conversationId,
        agentId,
        messageType: 'assistant',
        response: {
          message: messageContent,
          tokensUsed: 0,
          model: messageType === 'ai_generated' ? 'follow-up-ai' : 'follow-up-custom',
          finishReason: 'follow_up',
        },
        channel: channel as any,
        channelMetadata,
        timestamp: new Date().toISOString(),
        processingTime: 0,
      });
    } catch (error: any) {
      logError('Error publishing follow-up response', error, { conversationId, stepOrder });
    }

    logInfo('✅ Follow-up sent', {
      conversationId,
      agentId,
      step: stepOrder,
      messageType,
      messageId,
    });

    // ─── Avançar para próximo passo (se houver) ──────────────────────
    try {
      await followUpService.advanceSequence(
        conversationId,
        agentId,
        stepOrder,
        channel,
        channelMetadata
      );
    } catch (error: any) {
      logError('Error advancing follow-up sequence', error, { conversationId, stepOrder });
    }

    return { success: true };
  }

  async close() {
    try {
      await this.queue.close();
      logInfo('✅ Follow-Up Consumer closed');
    } catch (error) {
      logError('Error closing follow-up consumer', error as Error);
    }
  }
}

// Singleton
export const followUpConsumer = new FollowUpConsumer();
