import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { whatsappSessionManager } from '../plugins/whatsapp_baileys/session-manager';
import { logInfo, logWarn, logError } from '../utils/logger';
import { query } from '../db/postgres';
import { v4 as uuidv4 } from 'uuid';

/**
 * Controller para gerenciar conexões WhatsApp via Baileys
 * 
 * Este controller gerencia especificamente a versão Baileys (não oficial).
 * No futuro, teremos um controller separado para WhatsApp Business API (oficial).
 */
export class WhatsAppBaileysController {
  /**
   * Inicia uma sessão WhatsApp e retorna QR Code
   * POST /api/whatsapp/start/:agentId
   */
  async startSession(req: AuthRequest, res: Response) {
    try {
      const { agentId } = req.params;
      const userId = req.user!.userId;

      // Verificar se o agente pertence ao usuário
      const agentResult = await query(
        'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
        [agentId, userId]
      );

      if (agentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Agente não encontrado'
        });
      }

      // Verificar se o plugin WhatsApp Baileys está instalado
      const pluginResult = await query(
        `SELECT ap.id, ap.is_active 
         FROM agent_plugins ap 
         WHERE ap.agent_id = $1 AND ap.plugin_id = 'plugin.whatsapp_baileys' AND ap.is_active = true`,
        [agentId]
      );

      if (pluginResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Plugin WhatsApp Baileys não instalado neste agente'
        });
      }

      // Obter ou gerar session_id
      let sessionId: string;
      const configResult = await query(
        `SELECT pc.config_value 
         FROM plugin_configs pc
         JOIN agent_plugins ap ON pc.agent_plugin_id = ap.id
         WHERE ap.agent_id = $1 AND ap.plugin_id = 'plugin.whatsapp_baileys' AND pc.config_key = 'session_id'`,
        [agentId]
      );

      if (configResult.rows.length > 0) {
        sessionId = JSON.parse(configResult.rows[0].config_value);
      } else {
        // Gerar novo session_id
        sessionId = `wa_${agentId}_${uuidv4()}`;
        
        // Salvar no banco
        const agentPluginId = pluginResult.rows[0].id;
        await query(
          `INSERT INTO plugin_configs (agent_plugin_id, config_key, config_value)
           VALUES ($1, 'session_id', $2)
           ON CONFLICT (agent_plugin_id, config_key) DO UPDATE SET config_value = EXCLUDED.config_value`,
          [agentPluginId, JSON.stringify(sessionId)]
        );
      }

      logInfo('Starting WhatsApp session for agent', { agentId, sessionId, userId });

      // Iniciar sessão
      const qrCode = await whatsappSessionManager.startSession(agentId, sessionId);

      res.json({
        success: true,
        data: {
          sessionId,
          qrCode,
          message: qrCode ? 'Escaneie o QR Code com o WhatsApp' : 'Conectando...'
        }
      });

    } catch (error: any) {
      logError('Failed to start WhatsApp session', error, {
        agentId: req.params.agentId,
        userId: req.user?.userId
      });
      res.status(500).json({
        success: false,
        error: 'Erro ao iniciar sessão WhatsApp'
      });
    }
  }

  /**
   * Obtém o QR Code atual
   * GET /api/whatsapp/qrcode/:agentId
   */
  async getQRCode(req: AuthRequest, res: Response) {
    try {
      const { agentId } = req.params;
      const userId = req.user!.userId;

      // Verificar se o agente pertence ao usuário
      const agentResult = await query(
        'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
        [agentId, userId]
      );

      if (agentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Agente não encontrado'
        });
      }

      // Obter session_id
      const configResult = await query(
        `SELECT pc.config_value 
         FROM plugin_configs pc
         JOIN agent_plugins ap ON pc.agent_plugin_id = ap.id
         WHERE ap.agent_id = $1 AND ap.plugin_id = 'plugin.whatsapp_baileys' AND pc.config_key = 'session_id'`,
        [agentId]
      );

      if (configResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Sessão WhatsApp Baileys não encontrada. Inicie uma nova sessão.'
        });
      }

      const sessionId = JSON.parse(configResult.rows[0].config_value);
      const qrCode = whatsappSessionManager.getQRCode(agentId, sessionId);

      res.json({
        success: true,
        data: {
          qrCode,
          hasQRCode: !!qrCode
        }
      });

    } catch (error: any) {
      logError('Failed to get QR Code', error, {
        agentId: req.params.agentId,
        userId: req.user?.userId
      });
      res.status(500).json({
        success: false,
        error: 'Erro ao obter QR Code'
      });
    }
  }

  /**
   * Obtém o status da conexão WhatsApp
   * GET /api/whatsapp/status/:agentId
   */
  async getStatus(req: AuthRequest, res: Response) {
    try {
      const { agentId } = req.params;
      const userId = req.user!.userId;

      // Verificar se o agente pertence ao usuário
      const agentResult = await query(
        'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
        [agentId, userId]
      );

      if (agentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Agente não encontrado'
        });
      }

      // Obter session_id
      const configResult = await query(
        `SELECT pc.config_value 
         FROM plugin_configs pc
         JOIN agent_plugins ap ON pc.agent_plugin_id = ap.id
         WHERE ap.agent_id = $1 AND ap.plugin_id = 'plugin.whatsapp_baileys' AND pc.config_key = 'session_id'`,
        [agentId]
      );

      if (configResult.rows.length === 0) {
        return res.json({
          success: true,
          data: {
            status: 'disconnected',
            needsQR: false,
            message: 'Nenhuma sessão iniciada. Clique em "Conectar" para começar.'
          }
        });
      }

      const sessionId = JSON.parse(configResult.rows[0].config_value);
      const status = whatsappSessionManager.getConnectionStatus(agentId, sessionId);

      res.json({
        success: true,
        data: status
      });

    } catch (error: any) {
      logError('Failed to get WhatsApp status', error, {
        agentId: req.params.agentId,
        userId: req.user?.userId
      });
      res.status(500).json({
        success: false,
        error: 'Erro ao obter status'
      });
    }
  }

  /**
   * Desconecta a sessão WhatsApp
   * DELETE /api/whatsapp/disconnect/:agentId
   */
  async disconnectSession(req: AuthRequest, res: Response) {
    try {
      const { agentId } = req.params;
      const userId = req.user!.userId;

      // Verificar se o agente pertence ao usuário
      const agentResult = await query(
        'SELECT id FROM agents WHERE id = $1 AND user_id = $2',
        [agentId, userId]
      );

      if (agentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Agente não encontrado'
        });
      }

      // Obter session_id
      const configResult = await query(
        `SELECT pc.config_value 
         FROM plugin_configs pc
         JOIN agent_plugins ap ON pc.agent_plugin_id = ap.id
         WHERE ap.agent_id = $1 AND ap.plugin_id = 'plugin.whatsapp_baileys' AND pc.config_key = 'session_id'`,
        [agentId]
      );

      if (configResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Sessão WhatsApp Baileys não encontrada'
        });
      }

      const sessionId = JSON.parse(configResult.rows[0].config_value);
      
      logInfo('Disconnecting WhatsApp session', { agentId, sessionId, userId });

      await whatsappSessionManager.disconnectSession(agentId, sessionId);

      res.json({
        success: true,
        message: 'Sessão WhatsApp desconectada'
      });

    } catch (error: any) {
      logError('Failed to disconnect WhatsApp', error, {
        agentId: req.params.agentId,
        userId: req.user?.userId
      });
      res.status(500).json({
        success: false,
        error: 'Erro ao desconectar'
      });
    }
  }
}

export const whatsappBaileysController = new WhatsAppBaileysController();
