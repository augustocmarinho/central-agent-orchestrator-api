import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { creditService } from '../services/credit.service';
import { logError } from '../utils/logger';

/**
 * Controller user-facing para consulta de saldo e uso
 */
export class UsageController {
  /**
   * GET /api/usage/balance
   */
  async getBalance(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.userId;
      const balance = await creditService.getUserBalance(userId);
      return res.json({ success: true, data: balance });
    } catch (error: any) {
      logError('Error getting user balance', error);
      return res.status(500).json({ success: false, error: 'Erro ao buscar saldo' });
    }
  }

  /**
   * GET /api/usage/summary?start=YYYY-MM-DD&end=YYYY-MM-DD
   */
  async getSummary(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.userId;
      const { start, end } = req.query;

      const now = new Date();
      const startDate = start ? new Date(start as string) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = end ? new Date(end as string) : new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const summary = await creditService.getUserUsageSummary(userId, startDate, endDate);
      return res.json({ success: true, data: summary });
    } catch (error: any) {
      logError('Error getting usage summary', error);
      return res.status(500).json({ success: false, error: 'Erro ao buscar resumo de uso' });
    }
  }

  /**
   * GET /api/usage/history?page=1&limit=20
   */
  async getHistory(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const history = await creditService.getTransactionHistory(userId, page, limit);
      return res.json({ success: true, data: history });
    } catch (error: any) {
      logError('Error getting transaction history', error);
      return res.status(500).json({ success: false, error: 'Erro ao buscar histórico' });
    }
  }
}

export const usageController = new UsageController();
