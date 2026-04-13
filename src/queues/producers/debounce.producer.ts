import Queue from 'bull';
import { redisConnection, getRedisClient, REDIS_NAMESPACES } from '../../config/redis.config';
import { DebounceFlushJob } from '../../types/queue.types';
import { logInfo, logError } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Producer da fila de debounce
 * Gerencia delayed jobs que disparam o flush do buffer de mensagens agrupadas.
 *
 * Usa IDs únicos por job (não fixos por conversationId) porque o Bull
 * não permite reutilizar o mesmo jobId após remoção.
 * O jobId atual é armazenado no campo 'flushJobId' do Redis hash do buffer.
 */
export class DebounceProducer {
  private queue: Queue.Queue<DebounceFlushJob>;
  private isReady: boolean = false;

  constructor() {
    this.queue = new Queue<DebounceFlushJob>('ai-messages-debounce', {
      redis: redisConnection,
      prefix: 'bull',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
        timeout: 30000,
      },
    });

    this.initializeQueue();
  }

  private async initializeQueue() {
    try {
      await this.queue.isReady();
      this.isReady = true;
      logInfo('✅ Debounce Queue (Producer) initialized');
    } catch (error) {
      logError('Failed to initialize debounce queue', error as Error);
      throw error;
    }
  }

  /**
   * Agenda um flush para uma conversa após o delay de debounce.
   * Gera um jobId único e armazena no Redis hash do buffer.
   */
  async scheduleFlush(conversationId: string, agentId: string, delayMs: number): Promise<string> {
    if (!this.isReady) {
      throw new Error('Debounce queue not ready yet');
    }

    const jobId = `df:${conversationId}:${uuidv4().slice(0, 8)}`;

    await this.queue.add(
      { conversationId, agentId },
      { delay: delayMs, jobId }
    );

    // Salvar o jobId no hash do buffer para poder cancelar depois
    const bufferKey = `${REDIS_NAMESPACES.DEBOUNCE_BUFFER}${conversationId}`;
    await getRedisClient().hset(bufferKey, 'flushJobId', jobId);

    logInfo('⏱️ Debounce flush scheduled', { conversationId, jobId, delayMs });
    return jobId;
  }

  /**
   * Cancela o job pendente de flush lendo o jobId atual do Redis hash.
   */
  async cancelFlush(conversationId: string): Promise<void> {
    const bufferKey = `${REDIS_NAMESPACES.DEBOUNCE_BUFFER}${conversationId}`;
    const jobId = await getRedisClient().hget(bufferKey, 'flushJobId');

    if (!jobId) return;

    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'delayed' || state === 'waiting') {
          await job.remove();
          logInfo('🗑️ Debounce flush cancelled', { conversationId, jobId });
        }
      }
    } catch (error) {
      // Job pode já ter sido processado — não é erro
      logInfo('Debounce flush cancel skipped', { conversationId, jobId });
    }
  }

  /**
   * Reagenda o flush: cancela o atual e cria um novo com delay atualizado (sliding window).
   */
  async rescheduleFlush(conversationId: string, agentId: string, delayMs: number): Promise<void> {
    await this.cancelFlush(conversationId);
    await this.scheduleFlush(conversationId, agentId, delayMs);
  }

  getQueue(): Queue.Queue<DebounceFlushJob> {
    return this.queue;
  }

  async close() {
    try {
      await this.queue.close();
      logInfo('✅ Debounce Queue (Producer) closed');
    } catch (error) {
      logError('Error closing debounce queue', error as Error);
    }
  }
}

// Singleton
export const debounceProducer = new DebounceProducer();
