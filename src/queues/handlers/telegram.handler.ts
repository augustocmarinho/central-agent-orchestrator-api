import { ResponseEvent } from '../../types/queue.types';
import { BaseDeliveryHandler } from './delivery.handler';
import { logInfo, logWarn } from '../../utils/logger';

/**
 * Handler para entrega via Telegram
 * TODO: Implementar integração com Telegram Bot API
 */
export class TelegramHandler extends BaseDeliveryHandler {
  getName(): string {
    return 'TelegramHandler';
  }

  async deliver(event: ResponseEvent): Promise<void> {
    const { telegramChatId, telegramUserId } = event.channelMetadata;

    logWarn('Telegram delivery not implemented yet', { 
      messageId: event.messageId,
      telegramChatId,
      telegramUserId 
    });

    // TODO: Implementar integração com Telegram Bot API
    // Exemplo:
    // await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    //   chat_id: telegramChatId,
    //   text: event.response.message,
    //   parse_mode: 'Markdown'
    // });

    logInfo('✈️ Telegram delivery placeholder executed', { 
      messageId: event.messageId 
    });
  }

  canDeliver(event: ResponseEvent): boolean {
    // Validar se tem telegramChatId
    return !!event.channelMetadata.telegramChatId;
  }
}

// Singleton instance
export const telegramHandler = new TelegramHandler();
