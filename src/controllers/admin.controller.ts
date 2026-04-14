import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { adminBillingService } from '../services/adminBilling.service';
import { planService } from '../services/plan.service';
import { creditService } from '../services/credit.service';
import { logError, logInfo } from '../utils/logger';
import { z, ZodError } from 'zod';

const createUserSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  role: z.enum(['user', 'admin']).default('user'),
});

const assignPlanSchema = z.object({
  planId: z.string().uuid(),
});

const assignPackageSchema = z.object({
  packageId: z.string().uuid(),
});

const adjustCreditsSchema = z.object({
  amount: z.number().int(),
  description: z.string().min(1).max(500),
});

/**
 * Controller para área administrativa
 */
export class AdminController {
  /** GET /api/admin/stats */
  async getStats(req: AuthRequest, res: Response) {
    try {
      const stats = await adminBillingService.getGlobalStats();
      return res.json({ success: true, data: stats });
    } catch (error: any) {
      logError('Error getting admin stats', error);
      return res.status(500).json({ success: false, error: 'Erro ao buscar estatísticas' });
    }
  }

  /** GET /api/admin/users */
  async listUsers(req: AuthRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const search = req.query.search as string | undefined;

      const result = await adminBillingService.listUsers(page, limit, search);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logError('Error listing users', error);
      return res.status(500).json({ success: false, error: 'Erro ao listar usuários' });
    }
  }

  /** GET /api/admin/users/:id */
  async getUserDetail(req: AuthRequest, res: Response) {
    try {
      const user = await adminBillingService.getUserDetail(req.params.id);
      if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
      return res.json({ success: true, data: user });
    } catch (error: any) {
      logError('Error getting user detail', error);
      return res.status(500).json({ success: false, error: 'Erro ao buscar detalhes do usuário' });
    }
  }

  /** POST /api/admin/users */
  async createUser(req: AuthRequest, res: Response) {
    try {
      const validated = createUserSchema.parse(req.body);
      const user = await adminBillingService.createUser(validated);
      return res.status(201).json({ success: true, data: { user } });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Dados inválidos', details: error.errors });
      }
      if (error.code === '23505') {
        return res.status(409).json({ success: false, error: 'Email já cadastrado' });
      }
      logError('Error creating user', error);
      return res.status(500).json({ success: false, error: 'Erro ao criar usuário' });
    }
  }

  /** PUT /api/admin/users/:id/role */
  async updateUserRole(req: AuthRequest, res: Response) {
    try {
      const { role } = z.object({ role: z.enum(['user', 'admin']) }).parse(req.body);
      await adminBillingService.updateUserRole(req.params.id, role);
      return res.json({ success: true, message: 'Role atualizado' });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Role inválido' });
      }
      logError('Error updating user role', error);
      return res.status(500).json({ success: false, error: 'Erro ao atualizar role' });
    }
  }

  /** POST /api/admin/users/:id/plan */
  async assignPlanToUser(req: AuthRequest, res: Response) {
    try {
      const { planId } = assignPlanSchema.parse(req.body);
      const userPlan = await planService.assignPlanToUser(req.params.id, planId, req.user!.userId);
      return res.json({ success: true, data: { userPlan } });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Dados inválidos', details: error.errors });
      }
      logError('Error assigning plan', error);
      return res.status(500).json({ success: false, error: error.message || 'Erro ao atribuir plano' });
    }
  }

  /** POST /api/admin/users/:id/packages */
  async assignPackageToUser(req: AuthRequest, res: Response) {
    try {
      const { packageId } = assignPackageSchema.parse(req.body);
      const pkg = await creditService.assignPackage(req.params.id, packageId, req.user!.userId);
      return res.json({ success: true, data: { package: pkg } });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Dados inválidos', details: error.errors });
      }
      logError('Error assigning package', error);
      return res.status(500).json({ success: false, error: error.message || 'Erro ao atribuir pacote' });
    }
  }

  /** POST /api/admin/users/:id/credits/adjust */
  async adjustCredits(req: AuthRequest, res: Response) {
    try {
      const validated = adjustCreditsSchema.parse(req.body);
      const tx = await creditService.adminAdjust(req.params.id, validated.amount, validated.description, req.user!.userId);
      return res.json({ success: true, data: { transaction: tx } });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Dados inválidos', details: error.errors });
      }
      logError('Error adjusting credits', error);
      return res.status(500).json({ success: false, error: 'Erro ao ajustar créditos' });
    }
  }

  /** GET /api/admin/users/:id/usage */
  async getUserUsage(req: AuthRequest, res: Response) {
    try {
      const { start, end } = req.query;
      const now = new Date();
      const startDate = start ? new Date(start as string) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = end ? new Date(end as string) : new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const summary = await creditService.getUserUsageSummary(req.params.id, startDate, endDate);
      return res.json({ success: true, data: summary });
    } catch (error: any) {
      logError('Error getting user usage', error);
      return res.status(500).json({ success: false, error: 'Erro ao buscar uso' });
    }
  }
}

export const adminController = new AdminController();
