import { ResponseEvent } from '../../types/queue.types';
import { BaseDeliveryHandler } from './delivery.handler';
import { logInfo, logWarn, logError } from '../../utils/logger';
import { query } from '../../db/postgres';

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
      // Verificar se o plugin Baileys está instalado e obter session_id
      const pluginResult = await query(
        `SELECT ap.id 
         FROM agent_plugins ap 
         WHERE ap.agent_id = $1 AND ap.plugin_id = 'plugin.whatsapp_baileys' AND ap.is_active = true`,
        [event.agentId]
      );

      if (pluginResult.rows.length === 0) {
        logWarn('WhatsApp Baileys plugin not installed for agent', { 
          agentId: event.agentId,
          messageId: event.messageId 
        });
        return;
      }

      // Obter session_id
      const configResult = await query(
        `SELECT pc.config_value 
         FROM plugin_configs pc
         JOIN agent_plugins ap ON pc.agent_plugin_id = ap.id
         WHERE ap.agent_id = $1 AND ap.plugin_id = 'plugin.whatsapp_baileys' AND pc.config_key = 'session_id'`,
        [event.agentId]
      );

      if (configResult.rows.length === 0) {
        logWarn('WhatsApp session not found for agent', { 
          agentId: event.agentId,
          messageId: event.messageId 
        });
        return;
      }

      const sessionId = JSON.parse(configResult.rows[0].config_value);

      // Enviar via Baileys
      await this.deliverViaBaileys(event, phoneNumber || '', whatsappChatId, sessionId);

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
   * Baileys - Implementação usando session-manager
   * Envia mensagem via WhatsApp usando Baileys (API não oficial)
   */
  private async deliverViaBaileys(
    event: ResponseEvent, 
    phoneNumber: string,
    whatsappChatId: string | undefined,
    sessionId: string
  ): Promise<void> {
    try {
      // Importar session manager dinamicamente
      const { whatsappSessionManager } = await import('../../plugins/whatsapp_baileys/session-manager');
      
      // Determinar número de destino
      const to = whatsappChatId || phoneNumber;
      
      if (!to) {
        throw new Error('No destination (phoneNumber or whatsappChatId) provided');
      }

      // Enviar mensagem
      await whatsappSessionManager.sendMessage(
        event.agentId,
        sessionId,
        to,
        event.response.message
      );

      logInfo('✅ WhatsApp message sent via Baileys', {
        messageId: event.messageId,
        agentId: event.agentId,
        to: phoneNumber ? `***${phoneNumber.slice(-4)}` : undefined
      });

    } catch (error) {
      logError('Failed to send WhatsApp message via Baileys', error as Error, {
        messageId: event.messageId,
        agentId: event.agentId
      });
      throw error;
    }
  }
}

// Singleton instance
export const whatsappHandler = new WhatsAppHandler();
