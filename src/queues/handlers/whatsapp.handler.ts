import { ResponseEvent } from '../../types/queue.types';
import { BaseDeliveryHandler } from './delivery.handler';
import { logInfo, logWarn, logError } from '../../utils/logger';

/**
 * Handler para entrega via WhatsApp
 * 
 * Este handler é responsável por:
 * 1. Receber respostas da IA e enviá-las para o WhatsApp
 * 2. Integrar com WhatsApp Business API, Twilio, ou Evolution API
 * 
 * Fluxo completo:
 * - Mensagem recebida no WhatsApp → Webhook → Backend cria mensagem
 * - IA processa → Publica resposta → WhatsAppHandler envia de volta
 * - WebHandler TAMBÉM recebe (multi-canal) → Frontend atualizado
 * 
 * TODO: Implementar integração com API do WhatsApp
 */
export class WhatsAppHandler extends BaseDeliveryHandler {
  getName(): string {
    return 'WhatsAppHandler';
  }

  async deliver(event: ResponseEvent): Promise<void> {
    const { phoneNumber, whatsappChatId, websocketId } = event.channelMetadata;

    // Validar dados necessários
    if (!phoneNumber && !whatsappChatId) {
      logError('WhatsApp delivery failed: missing phoneNumber or whatsappChatId', new Error('Missing contact info'), {
        messageId: event.messageId,
        conversationId: event.conversationId
      });
      return;
    }

    logInfo('📱 Delivering message to WhatsApp', { 
      messageId: event.messageId,
      conversationId: event.conversationId,
      phoneNumber: phoneNumber ? `***${phoneNumber.slice(-4)}` : undefined,
      whatsappChatId,
      hasWebSocketConnection: !!websocketId
    });

    try {
      // TODO: Escolher e implementar uma das opções abaixo:
      
      // OPÇÃO 1: Twilio WhatsApp API
      // await this.deliverViaTwilio(event, phoneNumber);
      
      // OPÇÃO 2: WhatsApp Business Cloud API (Meta)
      // await this.deliverViaWhatsAppBusinessAPI(event, phoneNumber);
      
      // OPÇÃO 3: Evolution API (solução brasileira popular)
      // await this.deliverViaEvolutionAPI(event, phoneNumber, whatsappChatId);
      
      // OPÇÃO 4: Baileys/WPPConnect (self-hosted)
      // await this.deliverViaSelfHosted(event, phoneNumber);

      logWarn('⚠️ WhatsApp delivery not implemented yet - message queued', { 
        messageId: event.messageId,
        phoneNumber: phoneNumber ? `***${phoneNumber.slice(-4)}` : undefined
      });

      // Temporariamente: apenas logar que a mensagem seria enviada
      logInfo('💬 WhatsApp message content (would be sent):', {
        to: phoneNumber,
        message: event.response.message.substring(0, 100) + '...',
        conversationId: event.conversationId
      });

    } catch (error) {
      logError('Error delivering to WhatsApp', error as Error, {
        messageId: event.messageId,
        phoneNumber
      });
      throw error;
    }
  }

  canDeliver(event: ResponseEvent): boolean {
    // Validar se tem phoneNumber ou whatsappChatId
    return !!(event.channelMetadata?.phoneNumber || event.channelMetadata?.whatsappChatId);
  }

  // ============================================================================
  // MÉTODOS DE INTEGRAÇÃO (implementar conforme necessidade)
  // ============================================================================

  /**
   * OPÇÃO 1: Twilio WhatsApp API
   * Prós: Fácil de usar, confiável, bem documentado
   * Contras: Pago, precisa de aprovação para templates
   * 
   * Instalação: npm install twilio
   * Docs: https://www.twilio.com/docs/whatsapp
   */
  private async deliverViaTwilio(event: ResponseEvent, phoneNumber: string): Promise<void> {
    // const twilio = require('twilio');
    // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    // 
    // await client.messages.create({
    //   body: event.response.message,
    //   from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    //   to: `whatsapp:${phoneNumber}`
    // });
    
    throw new Error('Twilio integration not implemented');
  }

  /**
   * OPÇÃO 2: WhatsApp Business Cloud API (Meta)
   * Prós: Oficial, gratuito (até 1000 conversas/mês), escalável
   * Contras: Processo de aprovação complexo, requer Facebook Business
   * 
   * Instalação: npm install axios
   * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
   */
  private async deliverViaWhatsAppBusinessAPI(event: ResponseEvent, phoneNumber: string): Promise<void> {
    // const axios = require('axios');
    // const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    // 
    // await axios.post(
    //   WHATSAPP_API_URL,
    //   {
    //     messaging_product: 'whatsapp',
    //     to: phoneNumber,
    //     type: 'text',
    //     text: { body: event.response.message }
    //   },
    //   {
    //     headers: {
    //       'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    //       'Content-Type': 'application/json'
    //     }
    //   }
    // );
    
    throw new Error('WhatsApp Business API integration not implemented');
  }

  /**
   * OPÇÃO 3: Evolution API
   * Prós: Solução brasileira, fácil setup, suporta múltiplas instâncias
   * Contras: Self-hosted, precisa de servidor dedicado
   * 
   * Instalação: npm install axios
   * Docs: https://doc.evolution-api.com/
   */
  private async deliverViaEvolutionAPI(
    event: ResponseEvent, 
    phoneNumber: string, 
    chatId?: string
  ): Promise<void> {
    // const axios = require('axios');
    // const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
    // const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME;
    // 
    // await axios.post(
    //   `${EVOLUTION_API_URL}/message/sendText/${INSTANCE_NAME}`,
    //   {
    //     number: phoneNumber,
    //     textMessage: {
    //       text: event.response.message
    //     }
    //   },
    //   {
    //     headers: {
    //       'apikey': process.env.EVOLUTION_API_KEY,
    //       'Content-Type': 'application/json'
    //     }
    //   }
    // );
    
    throw new Error('Evolution API integration not implemented');
  }

  /**
   * OPÇÃO 4: Self-hosted (Baileys/WPPConnect)
   * Prós: Gratuito, controle total
   * Contras: Complexo, pode violar ToS do WhatsApp, instável
   * 
   * Não recomendado para produção!
   */
  private async deliverViaSelfHosted(event: ResponseEvent, phoneNumber: string): Promise<void> {
    throw new Error('Self-hosted integration not recommended for production');
  }
}

// Singleton instance
export const whatsappHandler = new WhatsAppHandler();
