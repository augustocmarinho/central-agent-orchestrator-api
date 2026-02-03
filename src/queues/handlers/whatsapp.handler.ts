import { ResponseEvent } from '../../types/queue.types';
import { BaseDeliveryHandler } from './delivery.handler';
import { logInfo, logWarn } from '../../utils/logger';

/**
 * Handler para entrega via WhatsApp
 * TODO: Implementar integração com API do WhatsApp (Twilio, WhatsApp Business API, etc)
 */
export class WhatsAppHandler extends BaseDeliveryHandler {
  getName(): string {
    return 'WhatsAppHandler';
  }

  async deliver(event: ResponseEvent): Promise<void> {
    const { phoneNumber, whatsappChatId } = event.channelMetadata;

    logWarn('WhatsApp delivery not implemented yet', { 
      messageId: event.messageId,
      phoneNumber,
      whatsappChatId 
    });

    // TODO: Implementar integração com WhatsApp
    // Exemplo com Twilio:
    // await twilioClient.messages.create({
    //   body: event.response.message,
    //   from: 'whatsapp:+14155238886',
    //   to: `whatsapp:${phoneNumber}`
    // });

    // Exemplo com WhatsApp Business API:
    // await axios.post(`${whatsappApiUrl}/messages`, {
    //   to: phoneNumber,
    //   type: 'text',
    //   text: { body: event.response.message }
    // });

    logInfo('📱 WhatsApp delivery placeholder executed', { 
      messageId: event.messageId 
    });
  }

  canDeliver(event: ResponseEvent): boolean {
    // Validar se tem phoneNumber ou whatsappChatId
    return !!(event.channelMetadata.phoneNumber || event.channelMetadata.whatsappChatId);
  }
}

// Singleton instance
export const whatsappHandler = new WhatsAppHandler();
