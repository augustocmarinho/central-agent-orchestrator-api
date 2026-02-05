import { Request, Response } from 'express';
import { conversationService } from '../services/conversation.service';
import { logError } from '../utils/logger';

/**
 * Controller para gerenciar conversas e histórico
 */
export class ConversationController {
  /**
   * Busca uma conversa específica
   * GET /api/conversations/:conversationId
   */
  async getConversation(req: Request, res: Response) {
    try {
      const { conversationId } = req.params;

      const conversation = await conversationService.getConversation(conversationId);

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversa não encontrada',
        });
      }

      return res.json({
        success: true,
        data: conversation,
      });
    } catch (error: any) {
      logError('Error getting conversation', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao buscar conversa',
      });
    }
  }

  /**
   * Busca mensagens de uma conversa
   * GET /api/conversations/:conversationId/messages
   */
  async getConversationMessages(req: Request, res: Response) {
    try {
      const { conversationId } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const order = (req.query.order as string) === 'desc' ? 'desc' : 'asc';

      const messages = await conversationService.getConversationMessages(
        conversationId,
        { limit, offset, order }
      );

      return res.json({
        success: true,
        data: messages,
        pagination: {
          limit,
          offset,
          count: messages.length,
        },
      });
    } catch (error: any) {
      logError('Error getting conversation messages', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao buscar mensagens',
      });
    }
  }

  /**
   * Busca conversas de um agente
   * GET /api/agents/:agentId/conversations
   */
  async getAgentConversations(req: Request, res: Response) {
    try {
      const { agentId } = req.params;
      const status = req.query.status as any;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const conversations = await conversationService.getAgentConversations(
        agentId,
        { status, limit, offset }
      );

      return res.json({
        success: true,
        data: {
          conversations,
          pagination: {
            limit,
            offset,
            count: conversations.length,
          },
        },
      });
    } catch (error: any) {
      logError('Error getting agent conversations', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao buscar conversas do agente',
      });
    }
  }

  /**
   * Busca conversas de um usuário
   * GET /api/users/:userId/conversations
   */
  async getUserConversations(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const status = req.query.status as any;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const conversations = await conversationService.getUserConversations(
        userId,
        { status, limit, offset }
      );

      return res.json({
        success: true,
        data: conversations,
        pagination: {
          limit,
          offset,
          count: conversations.length,
        },
      });
    } catch (error: any) {
      logError('Error getting user conversations', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao buscar conversas do usuário',
      });
    }
  }

  /**
   * Busca conversa completa com mensagens
   * GET /api/conversations/:conversationId/full
   */
  async getConversationFull(req: Request, res: Response) {
    try {
      const { conversationId } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;

      const [conversation, messages] = await Promise.all([
        conversationService.getConversation(conversationId),
        conversationService.getConversationMessages(
          conversationId,
          { limit, offset, order: 'asc' }
        ),
      ]);

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversa não encontrada',
        });
      }

      return res.json({
        success: true,
        data: {
          conversation,
          messages,
        },
        pagination: {
          limit,
          offset,
          count: messages.length,
        },
      });
    } catch (error: any) {
      logError('Error getting full conversation', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao buscar conversa completa',
      });
    }
  }

  /**
   * Atualiza status de uma conversa
   * PATCH /api/conversations/:conversationId/status
   */
  async updateConversationStatus(req: Request, res: Response) {
    try {
      const { conversationId } = req.params;
      const { status } = req.body;

      if (!status || !['active', 'closed', 'transferred', 'paused'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Status inválido',
        });
      }

      const conversation = await conversationService.updateConversationStatus(
        conversationId,
        status
      );

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversa não encontrada',
        });
      }

      return res.json({
        success: true,
        data: conversation,
      });
    } catch (error: any) {
      logError('Error updating conversation status', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao atualizar status da conversa',
      });
    }
  }

  /**
   * Busca estatísticas de conversas de um agente
   * GET /api/agents/:agentId/conversations/stats
   */
  async getAgentConversationStats(req: Request, res: Response) {
    try {
      const { agentId } = req.params;
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;

      const period = from && to ? { from, to } : undefined;

      const stats = await conversationService.getConversationStats(agentId, period);

      return res.json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      logError('Error getting agent conversation stats', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao buscar estatísticas',
      });
    }
  }

  /**
   * Busca conversa ativa por origem (útil para WhatsApp/Telegram)
   * POST /api/conversations/find-by-source
   */
  async findConversationBySource(req: Request, res: Response) {
    try {
      const { agentId, sourceType, sourceIdentifier, status } = req.body;

      if (!agentId || !sourceType || !sourceIdentifier) {
        return res.status(400).json({
          success: false,
          error: 'agentId, sourceType e sourceIdentifier são obrigatórios',
        });
      }

      const conversation = await conversationService.getConversationBySource(
        agentId,
        sourceType,
        sourceIdentifier,
        status
      );

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversa não encontrada',
        });
      }

      return res.json({
        success: true,
        data: conversation,
      });
    } catch (error: any) {
      logError('Error finding conversation by source', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao buscar conversa por origem',
      });
    }
  }
}

export const conversationController = new ConversationController();
