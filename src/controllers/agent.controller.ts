import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { SystemAuthRequest } from '../middleware/systemAuth';
import { agentService } from '../services/agent.service';
import { createAgentSchema, updateAgentSchema } from '../utils/validators';
import { logInfo, logError, logWarn } from '../utils/logger';
import { ZodError } from 'zod';

export class AgentController {
  async create(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.userId;
      const validated = createAgentSchema.parse(req.body);

      logInfo('Creating agent', { userId, validated });
      
      const agent = await agentService.createAgent({
        userId,
        ...validated,
      });
      
      logInfo('Agent created successfully', { 
        userId, 
        agentId: agent.id,
        agentName: agent.name 
      });
      
      res.status(201).json({
        success: true,
        data: { agent },
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        logWarn('Agent creation validation failed', { 
          userId: req.user?.userId,
          errors: error.errors 
        });
        return res.status(400).json({
          success: false,
          error: 'Dados inválidos',
          details: error.errors,
        });
      }
      
      logError('Agent creation failed', error, { userId: req.user?.userId });
      res.status(500).json({
        success: false,
        error: error.message || 'Erro ao criar agente',
      });
    }
  }
  
  async list(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.userId;
      const agents = await agentService.getAgentsByUserId(userId);
      
      res.json({
        success: true,
        data: { agents },
      });
    } catch (error: any) {
      logError('Error listing agents', error, { userId: req.user?.userId });
      res.status(500).json({
        success: false,
        error: 'Erro ao listar agentes',
      });
    }
  }
  
  async getOne(req: AuthRequest & SystemAuthRequest, res: Response) {
    try {
      const { id } = req.params;
      
      // Se é uma requisição de sistema (N8N), não precisa validar userId
      const isSystemRequest = (req as SystemAuthRequest).isSystemRequest;
      
      let agent;
      
      if (isSystemRequest) {
        // Sistema tem acesso a todos os agentes
        agent = await agentService.getAgentByIdForSystem(id);
        logInfo('Agent fetched by system', { 
          agentId: id,
          tokenName: (req as SystemAuthRequest).systemToken?.name 
        });
      } else {
        // Usuário só pode ver seus próprios agentes
        const userId = req.user!.userId;
        agent = await agentService.getAgentById(id, userId);
        logInfo('Agent fetched by user', { userId, agentId: id });
      }
      
      if (!agent) {
        logWarn('Agent not found', { 
          agentId: id,
          isSystemRequest 
        });
        return res.status(404).json({
          success: false,
          error: 'Agente não encontrado',
        });
      }
      
      res.json({
        success: true,
        data: { agent },
      });
    } catch (error: any) {
      logError('Error fetching agent', error, { 
        userId: req.user?.userId, 
        agentId: req.params.id,
        isSystemRequest: (req as SystemAuthRequest).isSystemRequest
      });
      res.status(500).json({
        success: false,
        error: 'Erro ao buscar agente',
      });
    }
  }
  
  async update(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      const validated = updateAgentSchema.parse(req.body);
      
      const agent = await agentService.updateAgent(id, userId, validated);
      
      if (!agent) {
        logWarn('Agent not found for update', { userId, agentId: id });
        return res.status(404).json({
          success: false,
          error: 'Agente não encontrado',
        });
      }
      
      logInfo('Agent updated successfully', { userId, agentId: id });
      
      res.json({
        success: true,
        data: { agent },
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        logWarn('Agent update validation failed', { 
          userId: req.user?.userId,
          agentId: req.params.id,
          errors: error.errors 
        });
        return res.status(400).json({
          success: false,
          error: 'Dados inválidos',
          details: error.errors,
        });
      }
      
      logError('Agent update failed', error, { userId: req.user?.userId, agentId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Erro ao atualizar agente',
      });
    }
  }
  
  async delete(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      
      const deleted = await agentService.deleteAgent(id, userId);
      
      if (!deleted) {
        logWarn('Agent not found for deletion', { userId, agentId: id });
        return res.status(404).json({
          success: false,
          error: 'Agente não encontrado',
        });
      }
      
      logInfo('Agent deleted successfully', { userId, agentId: id });
      
      res.json({
        success: true,
        message: 'Agente excluído com sucesso',
      });
    } catch (error: any) {
      logError('Agent deletion failed', error, { userId: req.user?.userId, agentId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Erro ao excluir agente',
      });
    }
  }
}

export const agentController = new AgentController();
