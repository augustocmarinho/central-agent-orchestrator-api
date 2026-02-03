import { messageProducer } from '../queues/producers/message.producer';
import { MessageJob, JobStatusResponse, QueueStats } from '../types/queue.types';
import { v4 as uuidv4 } from 'uuid';
import { logInfo, logError } from '../utils/logger';

/**
 * Serviço de orquestração de filas
 * Camada de abstração entre controllers e sistema de filas
 */
export class QueueService {
  /**
   * Enfileira uma mensagem para processamento
   */
  async enqueueMessage(data: {
    conversationId: string;
    agentId: string;
    userId: string;
    message: string;
    channel?: 'web' | 'whatsapp' | 'telegram' | 'api';
    channelMetadata?: any;
    priority?: number;
    scheduledFor?: Date;
  }): Promise<{ messageId: string; jobId: string; status: string; scheduledFor?: Date }> {
    try {
      const messageId = uuidv4();

      const job: MessageJob = {
        id: messageId,
        conversationId: data.conversationId,
        agentId: data.agentId,
        userId: data.userId,
        message: data.message,
        channel: data.channel || 'web',
        channelMetadata: data.channelMetadata || {},
        priority: data.priority || 5,
        timestamp: new Date().toISOString(),
        retries: 0,
      };

      const result = await messageProducer.addMessage(job, data.priority, data.scheduledFor);

      logInfo(data.scheduledFor ? 'Message scheduled' : 'Message enqueued', { 
        messageId,
        jobId: result.jobId,
        agentId: data.agentId,
        channel: job.channel,
        scheduledFor: data.scheduledFor?.toISOString()
      });

      return {
        messageId,
        jobId: result.jobId,
        status: result.status,
        scheduledFor: result.scheduledFor,
      };
    } catch (error) {
      logError('Error enqueuing message', error as Error, { 
        agentId: data.agentId 
      });
      throw error;
    }
  }

  /**
   * Agenda uma mensagem para ser enviada em um horário específico
   */
  async scheduleMessage(data: {
    conversationId: string;
    agentId: string;
    userId: string;
    message: string;
    scheduledFor: Date;
    channel?: 'web' | 'whatsapp' | 'telegram' | 'api';
    channelMetadata?: any;
    priority?: number;
  }): Promise<{ messageId: string; jobId: string; status: string; scheduledFor?: Date }> {
    return this.enqueueMessage(data);
  }

  /**
   * Busca o status de uma mensagem
   */
  async getMessageStatus(messageId: string): Promise<JobStatusResponse | null> {
    try {
      return await messageProducer.getJobStatus(messageId);
    } catch (error) {
      logError('Error getting message status', error as Error, { messageId });
      return null;
    }
  }

  /**
   * Obtém estatísticas da fila
   */
  async getQueueStatistics(): Promise<QueueStats> {
    try {
      return await messageProducer.getQueueStats();
    } catch (error) {
      logError('Error getting queue statistics', error as Error);
      throw error;
    }
  }

  /**
   * Limpa jobs antigos
   */
  async cleanOldJobs(): Promise<void> {
    try {
      await messageProducer.cleanOldJobs();
      logInfo('Old jobs cleaned successfully');
    } catch (error) {
      logError('Error cleaning old jobs', error as Error);
    }
  }

  /**
   * Verifica saúde do sistema de filas
   */
  async healthCheck(): Promise<{ healthy: boolean; stats?: QueueStats; error?: string }> {
    try {
      const stats = await this.getQueueStatistics();
      
      // Considera não saudável se:
      // - Fila de espera > 1000 mensagens
      // - Taxa de falha > 50%
      const healthy = stats.waiting < 1000 && 
                     (stats.failed / (stats.completed + stats.failed) < 0.5);

      return { healthy, stats };
    } catch (error: any) {
      return { 
        healthy: false, 
        error: error.message 
      };
    }
  }
}

// Singleton instance
export const queueService = new QueueService();
