import { getRedisPublisher, REDIS_NAMESPACES } from '../../config/redis.config';
import { ResponseEvent } from '../../types/queue.types';
import { logInfo, logError } from '../../utils/logger';

/**
 * Publisher de respostas
 * Publica eventos de resposta no Redis PubSub
 */
export class ResponsePublisher {
  private publisher = getRedisPublisher();

  /**
   * Publica uma resposta no canal apropriado
   */
  async publishResponse(event: ResponseEvent): Promise<void> {
    try {
      const eventJson = JSON.stringify(event);

      // 1. Publicar no canal específico do tipo de canal (web, whatsapp, telegram)
      const channelName = `${REDIS_NAMESPACES.PUBSUB_RESPONSE}${event.channel}`;
      await this.publisher.publish(channelName, eventJson);

      logInfo('📤 Response published to channel', { 
        channel: channelName,
        messageId: event.messageId,
        conversationId: event.conversationId 
      });

      // 2. Também publicar no canal específico da conversa (para múltiplos listeners)
      const conversationChannel = `${REDIS_NAMESPACES.PUBSUB_CONVERSATION}${event.conversationId}`;
      await this.publisher.publish(conversationChannel, eventJson);

      logInfo('📤 Response published to conversation', { 
        channel: conversationChannel,
        messageId: event.messageId 
      });

    } catch (error) {
      logError('Error publishing response', error as Error, { 
        messageId: event.messageId,
        channel: event.channel 
      });
      throw error;
    }
  }

  /**
   * Publica múltiplas respostas em batch
   */
  async publishBatch(events: ResponseEvent[]): Promise<void> {
    try {
      const promises = events.map(event => this.publishResponse(event));
      await Promise.all(promises);
      
      logInfo('📤 Batch of responses published', { count: events.length });
    } catch (error) {
      logError('Error publishing batch', error as Error);
      throw error;
    }
  }
}

// Singleton instance
export const responsePublisher = new ResponsePublisher();
