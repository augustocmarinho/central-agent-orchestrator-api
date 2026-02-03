import Queue from 'bull';
import { redisConnection } from '../../config/redis.config';
import { MessageJob, JobStatusResponse } from '../../types/queue.types';
import { logInfo, logError, logWarn } from '../../utils/logger';

/**
 * Producer de mensagens
 * Responsável por adicionar jobs na fila de processamento
 */
export class MessageProducer {
  private queue: Queue.Queue<MessageJob>;
  private isReady: boolean = false;

  constructor() {
    this.queue = new Queue<MessageJob>('ai-messages', {
      redis: redisConnection,
      prefix: 'bull',
      defaultJobOptions: {
        attempts: 3,                    // 3 tentativas em caso de falha
        backoff: {
          type: 'exponential',          // Delay exponencial entre tentativas
          delay: 2000,                  // 2s, 4s, 8s
        },
        removeOnComplete: 100,          // Mantém últimos 100 jobs completos
        removeOnFail: 500,              // Mantém últimos 500 jobs falhos
        timeout: 120000,                // Timeout de 2 minutos
      },
    });

    this.setupEventListeners();
    this.initializeQueue();
  }

  /**
   * Inicializa a fila
   */
  private async initializeQueue() {
    try {
      await this.queue.isReady();
      this.isReady = true;
      logInfo('✅ Message Queue (Producer) initialized');
    } catch (error) {
      logError('Failed to initialize message queue', error as Error);
      throw error;
    }
  }

  /**
   * Configura listeners de eventos da fila
   */
  private setupEventListeners() {
    this.queue.on('error', (error) => {
      logError('Queue error', error);
    });

    this.queue.on('completed', (job, result) => {
      logInfo('✅ Job completed', { 
        jobId: job.id, 
        messageId: job.data.id,
        processingTime: result.processingTime 
      });
    });

    this.queue.on('failed', (job, err) => {
      logError('❌ Job failed', err, { 
        jobId: job?.id, 
        messageId: job?.data?.id,
        attempts: job?.attemptsMade,
        maxAttempts: job?.opts?.attempts 
      });
    });

    this.queue.on('stalled', (job) => {
      logWarn('⚠️ Job stalled (possibly crashed worker)', { 
        jobId: job.id, 
        messageId: job.data.id 
      });
    });

    this.queue.on('active', (job) => {
      logInfo('▶️ Job started processing', { 
        jobId: job.id, 
        messageId: job.data.id 
      });
    });
  }

  /**
   * Adiciona uma mensagem na fila
   */
  async addMessage(data: MessageJob, priority?: number, scheduledFor?: Date): Promise<{ jobId: string; messageId: string; status: string; scheduledFor?: Date }> {
    if (!this.isReady) {
      throw new Error('Queue not ready yet');
    }

    try {
      // Calcular delay se scheduledFor foi fornecido
      let delay: number | undefined;
      if (scheduledFor) {
        const now = new Date();
        delay = scheduledFor.getTime() - now.getTime();
        
        if (delay < 0) {
          throw new Error('scheduledFor must be in the future');
        }
      }

      const job = await this.queue.add(data, {
        priority: priority || data.priority || 5,
        jobId: data.id, // Usa messageId como jobId para idempotência
        delay, // undefined = executa imediatamente, número = aguarda
      });

      const status = delay ? 'scheduled' : 'queued';

      logInfo(delay ? '📅 Message scheduled' : '📥 Message added to queue', { 
        jobId: job.id, 
        messageId: data.id,
        priority: job.opts.priority,
        channel: data.channel,
        scheduledFor: scheduledFor?.toISOString(),
        delayMs: delay
      });

      return {
        jobId: job.id as string,
        messageId: data.id,
        status,
        scheduledFor,
      };
    } catch (error: any) {
      logError('Error adding message to queue', error);
      throw error;
    }
  }

  /**
   * Agenda uma mensagem para ser enviada em um horário específico
   */
  async scheduleMessage(data: MessageJob, scheduledFor: Date, priority?: number): Promise<{ jobId: string; messageId: string; status: string; scheduledFor?: Date }> {
    return this.addMessage(data, priority, scheduledFor);
  }

  /**
   * Busca o status de um job
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse | null> {
    try {
      const job = await this.queue.getJob(jobId);
      
      if (!job) {
        return null;
      }

      const state = await job.getState();
      const progress = job.progress();

      return {
        id: job.id as string,
        messageId: job.data.id,
        state: state as any, // Bull retorna tipos adicionais como 'stuck'
        progress,
        data: job.data,
        failedReason: job.failedReason,
        finishedOn: job.finishedOn,
        processedOn: job.processedOn,
      };
    } catch (error) {
      logError('Error getting job status', error as Error, { jobId });
      return null;
    }
  }

  /**
   * Obtém estatísticas da fila
   */
  async getQueueStats() {
    try {
      const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
        this.queue.getPausedCount(),
      ]);

      return {
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused,
        total: waiting + active + completed + failed + delayed + paused,
      };
    } catch (error) {
      logError('Error getting queue stats', error as Error);
      throw error;
    }
  }

  /**
   * Limpa jobs antigos completados/falhos
   */
  async cleanOldJobs() {
    try {
      await this.queue.clean(3600000, 'completed'); // Remove completados após 1h
      await this.queue.clean(86400000, 'failed');   // Remove falhos após 24h
      logInfo('🧹 Old jobs cleaned');
    } catch (error) {
      logError('Error cleaning old jobs', error as Error);
    }
  }

  /**
   * Fecha a fila (graceful shutdown)
   */
  async close() {
    try {
      await this.queue.close();
      logInfo('✅ Message Queue (Producer) closed');
    } catch (error) {
      logError('Error closing message queue', error as Error);
    }
  }

  /**
   * Getter para a instância da fila (para testes/debug)
   */
  getQueue(): Queue.Queue<MessageJob> {
    return this.queue;
  }
}

// Singleton instance
export const messageProducer = new MessageProducer();
