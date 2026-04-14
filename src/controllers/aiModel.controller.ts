import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { aiModelService } from '../services/aiModel.service';
import { logError } from '../utils/logger';
import { z, ZodError } from 'zod';

const createModelSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.string().min(1).max(50),
  displayName: z.string().min(1).max(255),
  creditMultiplier: z.number().min(0.01).max(100),
  description: z.string().max(500).optional(),
});

const updateModelSchema = createModelSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export class AiModelController {
  /** GET /api/models — user-facing, modelos ativos */
  async listActive(req: AuthRequest, res: Response) {
    try {
      const models = await aiModelService.listModels(true);
      return res.json({ success: true, data: { models } });
    } catch (error: any) {
      logError('Error listing active models', error);
      return res.status(500).json({ success: false, error: 'Erro ao listar modelos' });
    }
  }

  /** GET /api/admin/models — admin, todos os modelos */
  async list(req: AuthRequest, res: Response) {
    try {
      const models = await aiModelService.listModels(false);
      return res.json({ success: true, data: { models } });
    } catch (error: any) {
      logError('Error listing models', error);
      return res.status(500).json({ success: false, error: 'Erro ao listar modelos' });
    }
  }

  /** POST /api/admin/models */
  async create(req: AuthRequest, res: Response) {
    try {
      const validated = createModelSchema.parse(req.body);
      const model = await aiModelService.createModel(validated);
      return res.status(201).json({ success: true, data: { model } });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Dados inválidos', details: error.errors });
      }
      logError('Error creating model', error);
      return res.status(500).json({ success: false, error: 'Erro ao criar modelo' });
    }
  }

  /** PUT /api/admin/models/:id */
  async update(req: AuthRequest, res: Response) {
    try {
      const validated = updateModelSchema.parse(req.body);
      const model = await aiModelService.updateModel(req.params.id, validated);
      if (!model) return res.status(404).json({ success: false, error: 'Modelo não encontrado' });
      return res.json({ success: true, data: { model } });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Dados inválidos', details: error.errors });
      }
      logError('Error updating model', error);
      return res.status(500).json({ success: false, error: 'Erro ao atualizar modelo' });
    }
  }

  /** DELETE /api/admin/models/:id */
  async delete(req: AuthRequest, res: Response) {
    try {
      const deleted = await aiModelService.deleteModel(req.params.id);
      if (!deleted) return res.status(404).json({ success: false, error: 'Modelo não encontrado' });
      return res.json({ success: true, message: 'Modelo desativado' });
    } catch (error: any) {
      logError('Error deleting model', error);
      return res.status(500).json({ success: false, error: 'Erro ao desativar modelo' });
    }
  }
}

export const aiModelController = new AiModelController();
