import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { queueService } from '../services/queue.service';
import { chatService } from '../services/chat.service';
import { logInfo, logError } from '../utils/logger';

/**
 * Controller para mensagens assíncronas
 */
export class MessageController {
  /**
   * Envia uma mensagem (assíncrono)
   * POST /api/messages
   */
  async sendMessage(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.userId;
      const { 
        agentId, 
        message, 
        conversationId, 
        channel = 'web',
        channelMetadata = {},
        priority,
        scheduledFor  // Nova opção: ISO 8601 string ou timestamp
      } = req.body;

      // Validações
      if (!agentId || !message) {
        return res.status(400).json({
          success: false,
          error: 'agentId e message são obrigatórios',
        });
      }

      if (message.length > 10000) {
        return res.status(400).json({
          success: false,
          error: 'Mensagem muito longa (máximo 10.000 caracteres)',
        });
      }

      // Validar scheduledFor se fornecido
      let scheduledDate: Date | undefined;
      if (scheduledFor) {
        scheduledDate = new Date(scheduledFor);
        if (isNaN(scheduledDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: 'scheduledFor deve ser uma data válida (ISO 8601)',
          });
        }
        if (scheduledDate < new Date()) {
          return res.status(400).json({
            success: false,
            error: 'scheduledFor deve ser uma data futura',
          });
        }
      }

      // Enviar mensagem (enfileira ou agenda)
      const result = await chatService.sendMessage({
        agentId,
        userId,
        content: message,
        conversationId,
        channel,
        channelMetadata,
        scheduledFor: scheduledDate,
      });

      logInfo(scheduledDate ? 'Message scheduled via API' : 'Message enqueued via API', { 
        userId,
        messageId: result.messageId,
        agentId,
        channel,
        scheduledFor: scheduledDate?.toISOString()
      });

      // Retorna 202 Accepted (processando em background)
      res.status(202).json({
        success: true,
        message: scheduledDate 
          ? `Mensagem agendada para ${scheduledDate.toISOString()}`
          : 'Mensagem recebida e em processamento',
        data: {
          messageId: result.messageId,
          conversationId: result.conversationId,
          jobId: result.jobId,
          status: result.status,
          scheduledFor: scheduledDate?.toISOString(),
          estimatedTime: scheduledDate ? 'Será processada no horário agendado' : '5-30 segundos',
        },
      });
    } catch (error: any) {
      logError('Error sending message', error, { userId: req.user?.userId });
      res.status(500).json({
        success: false,
        error: error.message || 'Erro ao enviar mensagem',
      });
    }
  }

  /**
   * Busca status de uma mensagem
   * GET /api/messages/:messageId/status
   */
  async getMessageStatus(req: AuthRequest, res: Response) {
    try {
      const { messageId } = req.params;
      
      const status = await chatService.getMessageStatus(messageId);

      if (!status) {
        return res.status(404).json({
          success: false,
          error: 'Mensagem não encontrada',
        });
      }

      res.json({
        success: true,
        data: {
          messageId: status.messageId,
          state: status.state,
          progress: status.progress,
          failedReason: status.failedReason,
          finishedOn: status.finishedOn,
          processedOn: status.processedOn,
        },
      });
    } catch (error: any) {
      logError('Error getting message status', error, { 
        userId: req.user?.userId,
        messageId: req.params.messageId 
      });
      res.status(500).json({
        success: false,
        error: 'Erro ao buscar status da mensagem',
      });
    }
  }

  /**
   * Obtém estatísticas da fila
   * GET /api/messages/queue/stats
   */
  async getQueueStats(req: AuthRequest, res: Response) {
    try {
      const stats = await queueService.getQueueStatistics();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      logError('Error getting queue stats', error);
      res.status(500).json({
        success: false,
        error: 'Erro ao buscar estatísticas da fila',
      });
    }
  }

  /**
   * Health check do sistema de filas
   * GET /api/messages/queue/health
   */
  async queueHealthCheck(req: AuthRequest, res: Response) {
    try {
      const health = await queueService.healthCheck();

      const statusCode = health.healthy ? 200 : 503;

      res.status(statusCode).json({
        success: health.healthy,
        data: health,
      });
    } catch (error: any) {
      logError('Error checking queue health', error);
      res.status(503).json({
        success: false,
        error: 'Erro ao verificar saúde da fila',
      });
    }
  }
}

export const messageController = new MessageController();
