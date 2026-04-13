import Queue, { Job } from 'bull';
import { redisConnection } from '../../config/redis.config';
import { DebounceFlushJob } from '../../types/queue.types';
import { debounceService } from '../../services/debounce.service';
import { logInfo, logError } from '../../utils/logger';

/**
 * Consumer da fila de debounce
 * Processa jobs de flush quando a janela de debounce expira
 */
export class DebounceConsumer {
  private queue: Queue.Queue<DebounceFlushJob>;
  private concurrency: number = 5;

  constructor() {
    this.queue = new Queue<DebounceFlushJob>('ai-messages-debounce', {
      redis: redisConnection,
      prefix: 'bull',
    });

    this.startProcessing();
    logInfo('✅ Debounce Consumer initialized');
  }

  private startProcessing() {
    this.queue.process(this.concurrency, async (job: Job<DebounceFlushJob>) => {
      return this.processFlush(job);
    });

    this.queue.on('error', (error) => {
      logError('Debounce consumer queue error', error);
    });
  }

  private async processFlush(job: Job<DebounceFlushJob>): Promise<{ success: boolean }> {
    const { conversationId, agentId } = job.data;

    logInfo('⏱️ Debounce flush triggered', { conversationId, agentId });

    try {
      await debounceService.flushBuffer(conversationId);
      return { success: true };
    } catch (error: any) {
      logError('❌ Debounce flush failed', error, { conversationId, agentId });
      throw error; // Bull fará retry automaticamente
    }
  }

  async close() {
    try {
      await this.queue.close();
      logInfo('✅ Debounce Consumer closed');
    } catch (error) {
      logError('Error closing debounce consumer', error as Error);
    }
  }
}

// Singleton
export const debounceConsumer = new DebounceConsumer();
