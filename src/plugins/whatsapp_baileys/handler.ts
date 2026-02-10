import { whatsappSessionManager } from './session-manager';
import { logInfo, logError } from '../../utils/logger';

/**
 * Handler do plugin WhatsApp Baileys (API não oficial)
 * Fornece capabilities para o agente interagir com WhatsApp via Baileys
 * 
 * Para uso em produção, recomendamos o plugin.whatsapp_business (API oficial)
 */
export const whatsappBaileysPlugin = {
  id: 'plugin.whatsapp_baileys',
  
  /**
   * Envia uma mensagem via WhatsApp
   */
  async sendMessage(data: {
    agentId: string;
    sessionId: string;
    to: string;
    message: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      logInfo('WhatsApp plugin: sending message', {
        agentId: data.agentId,
        to: data.to,
        messageLength: data.message.length
      });

      await whatsappSessionManager.sendMessage(
        data.agentId,
        data.sessionId,
        data.to,
        data.message
      );

      return { success: true };
    } catch (error: any) {
      logError('WhatsApp plugin: send message failed', error);
      return {
        success: false,
        error: error.message || 'Failed to send message'
      };
    }
  },

  /**
   * Verifica o status da conexão
   */
  async getStatus(data: {
    agentId: string;
    sessionId: string;
  }): Promise<{ success: boolean; status?: any; error?: string }> {
    try {
      const status = whatsappSessionManager.getConnectionStatus(
        data.agentId,
        data.sessionId
      );

      return {
        success: true,
        status
      };
    } catch (error: any) {
      logError('WhatsApp plugin: get status failed', error);
      return {
        success: false,
        error: error.message
      };
    }
  },
};

export default whatsappBaileysPlugin;
