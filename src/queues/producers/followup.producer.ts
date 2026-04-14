import Queue from 'bull';
import { redisConnection, getRedisClient, REDIS_NAMESPACES } from '../../config/redis.config';
import { FollowUpJob } from '../../types/followup.types';
import { logInfo, logError } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Producer da fila de follow-up
 * Gerencia delayed jobs que disparam o envio de mensagens de acompanhamento.
 *
 * Usa IDs únicos por job (não fixos por conversationId) porque o Bull
 * não permite reutilizar o mesmo jobId após remoção.
 * O jobId atual é armazenado no Redis state (followup:{conversationId}).
 */
export class FollowUpProducer {
  private queue: Queue.Queue<FollowUpJob>;
  private isReady: boolean = false;

  constructor() {
    this.queue = new Queue<FollowUpJob>('ai-messages-followup', {
      redis: redisConnection,
      prefix: 'bull',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 200,
        removeOnFail: 500,
        timeout: 120000, // 2 min (geração de IA pode demorar)
      },
    });

    this.initializeQueue();
  }

  private async initializeQueue() {
    try {
      await this.queue.isReady();
      this.isReady = true;
      logInfo('✅ Follow-Up Queue (Producer) initialized');
    } catch (error) {
      logError('Failed to initialize follow-up queue', error as Error);
      throw error;
    }
  }

  /**
   * Agenda um passo de follow-up com delay em milissegundos.
   * Retorna o jobId para possível cancelamento.
   */
  async scheduleStep(data: FollowUpJob, delayMs: number): Promise<string> {
    if (!this.isReady) {
      throw new Error('Follow-up queue not ready yet');
    }

    const jobId = `fu:${data.conversationId}:${data.stepOrder}:${uuidv4().slice(0, 8)}`;

    await this.queue.add(data, {
      delay: delayMs,
      jobId,
    });

    logInfo('⏱️ Follow-up step scheduled', {
      conversationId: data.conversationId,
      agentId: data.agentId,
      step: data.stepOrder,
      jobId,
      delayMs,
    });

    return jobId;
  }

  /**
   * Cancela um job pendente pelo ID.
   */
  async cancelJob(jobId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'delayed' || state === 'waiting') {
          await job.remove();
          logInfo('🗑️ Follow-up job cancelled', { jobId });
        }
      }
    } catch (error) {
      // Job pode já ter sido processado — não é erro
      logInfo('Follow-up cancel skipped (job may be processed)', { jobId });
    }
  }

  getQueue(): Queue.Queue<FollowUpJob> {
    return this.queue;
  }

  async close() {
    try {
      await this.queue.close();
      logInfo('✅ Follow-Up Queue (Producer) closed');
    } catch (error) {
      logError('Error closing follow-up queue (producer)', error as Error);
    }
  }
}

// Singleton
export const followUpProducer = new FollowUpProducer();
