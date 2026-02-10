import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { chatService } from '../services/chat.service';
import { logInfo, logError, logWarn } from '../utils/logger';

export class ChatController {
  async sendMessage(req: AuthRequest, res: Response) {
    try {
      const { agentId, content, conversationId, channel } = req.body;
      const userId = req.user!.userId;
      
      if (!agentId || !content) {
        logWarn('Send message validation failed', { userId, agentId });
        return res.status(400).json({
          success: false,
          error: 'agentId e content são obrigatórios',
        });
      }
      
      const result = await chatService.sendMessage({
        agentId,
        userId,
        content,
        conversationId,
        channel,
      });
      
      logInfo('Message sent successfully', { 
        userId, 
        agentId, 
        conversationId: result.conversationId,
        messageLength: content.length 
      });
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      logError('Failed to send message', error, { 
        userId: req.user?.userId,
        agentId: req.body?.agentId 
      });
      res.status(500).json({
        success: false,
        error: 'Erro ao enviar mensagem',
      });
    }
  }
  
  async getConversation(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const conversation = await chatService.getConversation(id);
      
      if (!conversation) {
        logWarn('Conversation not found', { conversationId: id });
        return res.status(404).json({
          success: false,
          error: 'Conversa não encontrada',
        });
      }
      
      res.json({
        success: true,
        data: conversation,
      });
    } catch (error: any) {
      logError('Failed to get conversation', error, { conversationId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Erro ao buscar conversa',
      });
    }
  }
  
  async listConversations(req: AuthRequest, res: Response) {
    try {
      const { agentId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      
      const conversations = await chatService.getConversationsByAgent(agentId, limit);
      
      res.json({
        success: true,
        data: { conversations },
      });
    } catch (error: any) {
      logError('Failed to list conversations', error, { 
        agentId: req.params.agentId,
        limit: req.query.limit 
      });
      res.status(500).json({
        success: false,
        error: 'Erro ao listar conversas',
      });
    }
  }

  /**
   * Cria uma nova conversa web para o agente (usado por "Teste o agente").
   * POST /api/agents/:agentId/conversations
   */
  async createConversation(req: AuthRequest, res: Response) {
    try {
      const { agentId } = req.params;
      const userId = req.user!.userId;
      const conversation = await chatService.startWebConversation(agentId, userId);
      logInfo('Conversation created for agent', { userId, agentId, conversationId: conversation.conversationId });
      res.status(201).json({
        success: true,
        data: conversation,
      });
    } catch (error: any) {
      logError('Failed to create conversation', error, {
        userId: req.user?.userId,
        agentId: req.params.agentId,
      });
      const status = error.message === 'Agente não encontrado' ? 404 : 500;
      res.status(status).json({
        success: false,
        error: error.message || 'Erro ao criar conversa',
      });
    }
  }
}

export const chatController = new ChatController();
