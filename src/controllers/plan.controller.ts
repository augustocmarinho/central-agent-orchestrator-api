import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { planService } from '../services/plan.service';
import { logError } from '../utils/logger';
import { z, ZodError } from 'zod';

const createPlanSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(255),
  monthlyCredits: z.number().int().min(0),
  priceBrl: z.number().min(0).default(0),
  features: z.array(z.string()).default([]),
  hardLimit: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const updatePlanSchema = createPlanSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export class PlanController {
  /** GET /api/admin/plans */
  async list(req: AuthRequest, res: Response) {
    try {
      const plans = await planService.listPlans(false);
      return res.json({ success: true, data: { plans } });
    } catch (error: any) {
      logError('Error listing plans', error);
      return res.status(500).json({ success: false, error: 'Erro ao listar planos' });
    }
  }

  /** POST /api/admin/plans */
  async create(req: AuthRequest, res: Response) {
    try {
      const validated = createPlanSchema.parse(req.body);
      const plan = await planService.createPlan(validated);
      return res.status(201).json({ success: true, data: { plan } });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Dados inválidos', details: error.errors });
      }
      logError('Error creating plan', error);
      return res.status(500).json({ success: false, error: 'Erro ao criar plano' });
    }
  }

  /** PUT /api/admin/plans/:id */
  async update(req: AuthRequest, res: Response) {
    try {
      const validated = updatePlanSchema.parse(req.body);
      const plan = await planService.updatePlan(req.params.id, validated);
      if (!plan) return res.status(404).json({ success: false, error: 'Plano não encontrado' });
      return res.json({ success: true, data: { plan } });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Dados inválidos', details: error.errors });
      }
      logError('Error updating plan', error);
      return res.status(500).json({ success: false, error: 'Erro ao atualizar plano' });
    }
  }

  /** DELETE /api/admin/plans/:id */
  async delete(req: AuthRequest, res: Response) {
    try {
      const deleted = await planService.deletePlan(req.params.id);
      if (!deleted) return res.status(404).json({ success: false, error: 'Plano não encontrado' });
      return res.json({ success: true, message: 'Plano desativado' });
    } catch (error: any) {
      logError('Error deleting plan', error);
      return res.status(500).json({ success: false, error: 'Erro ao desativar plano' });
    }
  }
}

export const planController = new PlanController();
