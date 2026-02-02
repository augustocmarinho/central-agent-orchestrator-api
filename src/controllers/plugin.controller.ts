import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pluginService } from '../services/plugin.service';
import { installPluginSchema } from '../utils/validators';
import { logInfo, logError, logWarn } from '../utils/logger';
import { ZodError } from 'zod';

export class PluginController {
  async list(req: AuthRequest, res: Response) {
    try {
      const plugins = await pluginService.getAllPlugins();
      
      res.json({
        success: true,
        data: { plugins },
      });
    } catch (error: any) {
      logError('Failed to list plugins', error);
      res.status(500).json({
        success: false,
        error: 'Erro ao listar plugins',
      });
    }
  }
  
  async getOne(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const plugin = await pluginService.getPluginById(id);
      
      if (!plugin) {
        logWarn('Plugin not found', { pluginId: id });
        return res.status(404).json({
          success: false,
          error: 'Plugin não encontrado',
        });
      }
      
      res.json({
        success: true,
        data: { plugin },
      });
    } catch (error: any) {
      logError('Failed to get plugin', error, { pluginId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Erro ao buscar plugin',
      });
    }
  }
  
  async install(req: AuthRequest, res: Response) {
    try {
      const { agentId } = req.params;
      const validated = installPluginSchema.parse(req.body);
      
      const installation = await pluginService.installPlugin({
        agentId,
        ...validated,
      });
      
      logInfo('Plugin installed successfully', { 
        agentId, 
        pluginId: validated.pluginId,
        userId: req.user?.userId 
      });
      
      res.status(201).json({
        success: true,
        data: { installation },
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        logWarn('Plugin installation validation failed', { 
          agentId: req.params.agentId,
          errors: error.errors 
        });
        return res.status(400).json({
          success: false,
          error: 'Dados inválidos',
          details: error.errors,
        });
      }
      
      logError('Plugin installation failed', error, { 
        agentId: req.params.agentId,
        pluginId: req.body?.pluginId 
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Erro ao instalar plugin',
      });
    }
  }
  
  async listAgentPlugins(req: AuthRequest, res: Response) {
    try {
      const { agentId } = req.params;
      const plugins = await pluginService.getAgentPlugins(agentId);
      
      res.json({
        success: true,
        data: { plugins },
      });
    } catch (error: any) {
      logError('Failed to list agent plugins', error, { agentId: req.params.agentId });
      res.status(500).json({
        success: false,
        error: 'Erro ao listar plugins do agente',
      });
    }
  }
  
  async uninstall(req: AuthRequest, res: Response) {
    try {
      const { agentId, pluginId } = req.params;
      const uninstalled = await pluginService.uninstallPlugin(agentId, pluginId);
      
      if (!uninstalled) {
        logWarn('Plugin not found for uninstall', { agentId, pluginId });
        return res.status(404).json({
          success: false,
          error: 'Plugin não encontrado no agente',
        });
      }
      
      logInfo('Plugin uninstalled successfully', { 
        agentId, 
        pluginId,
        userId: req.user?.userId 
      });
      
      res.json({
        success: true,
        message: 'Plugin desinstalado com sucesso',
      });
    } catch (error: any) {
      logError('Plugin uninstall failed', error, { 
        agentId: req.params.agentId,
        pluginId: req.params.pluginId 
      });
      res.status(500).json({
        success: false,
        error: 'Erro ao desinstalar plugin',
      });
    }
  }
}

export const pluginController = new PluginController();
