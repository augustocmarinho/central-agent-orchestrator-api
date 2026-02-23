import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { SystemAuthRequest } from '../middleware/systemAuth';
import { toolService } from '../services/tool.service';
import { logError, logWarn } from '../utils/logger';

export class ToolController {
  async getTools(req: AuthRequest & SystemAuthRequest, res: Response) {
    try {
      const { agentId } = req.params;
      const tools = await toolService.getToolsForAgent(agentId);

      res.json({
        success: true,
        data: { tools },
      });
    } catch (err: unknown) {
      logError('Failed to get tools for agent', err as Error, { agentId: req.params.agentId });
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao listar tools do agente',
      });
    }
  }

  async executeTool(req: AuthRequest & SystemAuthRequest, res: Response) {
    try {
      const { agentId } = req.params;
      const body = req.body as { call_id?: string; name?: string; arguments?: string };

      if (!body.name || typeof body.name !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Campo "name" é obrigatório e deve ser uma string',
        });
      }

      const result = await toolService.executeTool(agentId, {
        call_id: typeof body.call_id === 'string' ? body.call_id : '',
        name: body.name,
        arguments: typeof body.arguments === 'string' ? body.arguments : '{}',
      });

      // A API Responses espera string em function_call_output.output; call_id para o n8n montar o loop
      res.json({
        success: true,
        output: result,
        call_id: body.call_id,
      });
    } catch (err: unknown) {
      logError('Tool execution failed', err as Error, {
        agentId: req.params.agentId,
        name: (req.body as { name?: string })?.name,
      });
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao executar tool',
      });
    }
  }
}

export const toolController = new ToolController();
