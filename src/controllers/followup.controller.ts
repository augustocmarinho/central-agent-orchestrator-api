import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { followUpService } from '../services/followup.service';
import { agentService } from '../services/agent.service';
import { logInfo, logError } from '../utils/logger';
import { z, ZodError } from 'zod';

// ─── Validação Zod ────────────────────────────────────────────────────

const followUpStepSchema = z.object({
  stepOrder: z.number().int().min(1).max(3),
  delayMinutes: z.number().int().min(1).max(10080), // Max 7 dias
  messageType: z.enum(['custom', 'ai_generated']),
  customMessage: z.string().max(2000).optional(),
}).refine(
  (data) => data.messageType !== 'custom' || (data.customMessage && data.customMessage.trim().length > 0),
  { message: 'Mensagem personalizada é obrigatória quando o tipo é "custom"' }
);

const followUpConfigSchema = z.object({
  enabled: z.boolean(),
  steps: z.array(followUpStepSchema).max(3),
}).refine(
  (data) => !data.enabled || data.steps.length > 0,
  { message: 'Pelo menos um passo de follow-up é necessário quando habilitado' }
);

// ─── Controller ───────────────────────────────────────────────────────

export class FollowUpController {
  /**
   * GET /api/agents/:agentId/follow-up
   * Retorna configuração de follow-up do agente
   */
  async getConfig(req: AuthRequest, res: Response) {
    try {
      const { agentId } = req.params;
      const userId = req.user?.userId;

      // Validar que o agente existe e pertence ao usuário
      const agent = await agentService.getAgentById(agentId, userId!);
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: 'Agente não encontrado',
        });
      }

      const config = await followUpService.getConfig(agentId);

      return res.json({
        success: true,
        data: { config },
      });
    } catch (error: any) {
      logError('Error getting follow-up config', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao buscar configuração de follow-up',
      });
    }
  }

  /**
   * PUT /api/agents/:agentId/follow-up
   * Atualiza configuração de follow-up do agente
   */
  async updateConfig(req: AuthRequest, res: Response) {
    try {
      const { agentId } = req.params;
      const userId = req.user?.userId;

      // Validar que o agente existe e pertence ao usuário
      const agent = await agentService.getAgentById(agentId, userId!);
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: 'Agente não encontrado',
        });
      }

      // Validar body
      const validated = followUpConfigSchema.parse(req.body);

      const config = await followUpService.saveConfig(agentId, validated);

      logInfo('Follow-up config updated', { agentId, enabled: validated.enabled });

      return res.json({
        success: true,
        data: { config },
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Dados inválidos',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }

      logError('Error updating follow-up config', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Erro ao atualizar configuração de follow-up',
      });
    }
  }
}

export const followUpController = new FollowUpController();
