import { getRedisSubscriber, REDIS_NAMESPACES } from '../../config/redis.config';
import { ResponseEvent } from '../../types/queue.types';
import { logInfo, logError, logWarn } from '../../utils/logger';
import { webHandler, whatsappHandler, telegramHandler } from '../handlers';

/**
 * Subscriber de respostas
 * Subscreve aos canais de resposta e roteia para os handlers apropriados
 */
export class ResponseSubscriber {
  private subscriber = getRedisSubscriber();
  private handlers: Map<string, (event: ResponseEvent) => Promise<void>> = new Map();
  private isSubscribed: boolean = false;

  constructor() {
    this.setupSubscription();
  }

  /**
   * Configura subscrição aos canais
   */
  private async setupSubscription() {
    try {
      // Subscrever a todos os canais de resposta usando pattern matching
      // Isso pega: pubsub:response:web, pubsub:response:whatsapp, pubsub:response:telegram, etc
      const pattern = `${REDIS_NAMESPACES.PUBSUB_RESPONSE}*`;
      
      await this.subscriber.psubscribe(pattern);
      this.isSubscribed = true;
      
      logInfo('✅ Subscribed to response channels', { pattern });

      // Handler de mensagens
      this.subscriber.on('pmessage', async (pattern: string, channel: string, message: string) => {
        await this.handleMessage(channel, message);
      });

      // Handler de erros
      this.subscriber.on('error', (error) => {
        logError('Subscriber error', error);
      });

      // Handler de reconexão
      this.subscriber.on('reconnecting', () => {
        logWarn('Subscriber reconnecting...');
      });

    } catch (error) {
      logError('Error setting up subscription', error as Error);
      throw error;
    }
  }

  /**
   * Processa uma mensagem recebida
   */
  private async handleMessage(channel: string, message: string) {
    try {
      const event: ResponseEvent = JSON.parse(message);
      
      logInfo('📥 Response received', { 
        channel,
        messageId: event.messageId,
        eventChannel: event.channel 
      });

      // Rotear para o handler apropriado
      await this.routeResponse(event);

    } catch (error) {
      logError('Error handling message', error as Error, { channel });
    }
  }

  /**
   * Roteia a resposta para múltiplos handlers (multi-canal)
   * SEMPRE entrega via WebSocket (para dashboard/frontend) + canal de origem
   */
  private async routeResponse(event: ResponseEvent) {
    try {
      logInfo('🔀 Routing response (multi-channel)', { 
        messageId: event.messageId, 
        channel: event.channel,
        conversationId: event.conversationId
      });

      const deliveries: Array<{
        handler: string;
        promise: Promise<void>;
      }> = [];

      // 1. SEMPRE fazer broadcast via WebSocket (para dashboard/frontend)
      // Isso garante que qualquer pessoa conectada na conversa veja a mensagem
      deliveries.push({
        handler: 'WebSocket',
        promise: webHandler.deliver(event)
      });

      // 2. Entregar no canal de origem (WhatsApp, Telegram, etc)
      switch (event.channel) {
        case 'whatsapp':
          deliveries.push({
            handler: 'WhatsApp',
            promise: whatsappHandler.deliver(event)
          });
          break;
        
        case 'telegram':
          deliveries.push({
            handler: 'Telegram',
            promise: telegramHandler.deliver(event)
          });
          break;
        
        case 'api':
          // TODO: Handler para callbacks API
          logWarn('API channel not implemented yet', { messageId: event.messageId });
          break;
        
        case 'web':
          // Já coberto pelo WebSocket acima
          break;
        
        default:
          logWarn('Unknown channel', { channel: event.channel, messageId: event.messageId });
      }

      // 3. Executar todas as entregas em paralelo
      const results = await Promise.allSettled(
        deliveries.map(d => d.promise)
      );

      // 4. Logar resultados
      results.forEach((result, index) => {
        const handler = deliveries[index].handler;
        if (result.status === 'fulfilled') {
          logInfo(`✅ Delivery successful: ${handler}`, { 
            messageId: event.messageId,
            handler 
          });
        } else {
          logError(`❌ Delivery failed: ${handler}`, result.reason, { 
            messageId: event.messageId,
            handler 
          });
        }
      });

      logInfo('📤 Response published to conversation', {
        messageId: event.messageId,
        conversationId: event.conversationId,
        totalDeliveries: deliveries.length,
        successCount: results.filter(r => r.status === 'fulfilled').length
      });

    } catch (error) {
      logError('Error routing response', error as Error, { 
        messageId: event.messageId,
        channel: event.channel 
      });
    }
  }

  /**
   * Registra um handler customizado para um canal específico
   */
  registerHandler(channel: string, handler: (event: ResponseEvent) => Promise<void>) {
    this.handlers.set(channel, handler);
    logInfo('Handler registered', { channel });
  }

  /**
   * Verifica se está subscrito
   */
  isActive(): boolean {
    return this.isSubscribed;
  }

  /**
   * Fecha o subscriber (graceful shutdown)
   */
  async close() {
    try {
      await this.subscriber.punsubscribe();
      this.isSubscribed = false;
      logInfo('✅ Response Subscriber closed');
    } catch (error) {
      logError('Error closing subscriber', error as Error);
    }
  }
}

// Singleton instance
export const responseSubscriber = new ResponseSubscriber();
