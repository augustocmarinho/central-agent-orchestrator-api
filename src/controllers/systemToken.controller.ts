import { Response } from 'express';
import { systemTokenService } from '../services/systemToken.service';
import { AuthRequest } from '../middleware/auth';
import { logInfo, logError, logWarn } from '../utils/logger';
import { ZodError, z } from 'zod';

// Schemas de validação
const createSystemTokenSchema = z.object({
  name: z.string().min(3, 'Nome deve ter no mínimo 3 caracteres'),
  description: z.string().optional(),
  allowed_ips: z.array(z.string()).optional(),
  expires_at: z.string().datetime().optional(),
});

const updateAllowedIpsSchema = z.object({
  allowed_ips: z.array(z.string()),
});

export class SystemTokenController {
  /**
   * Cria um novo token de sistema
   * POST /api/system-tokens
   * Requer autenticação de usuário admin
   */
  async create(req: AuthRequest, res: Response) {
    try {
      // Verificar se o usuário é admin
      if (req.user?.role !== 'admin') {
        logWarn('Non-admin user attempted to create system token', {
          userId: req.user?.userId,
          email: req.user?.email
        });
        return res.status(403).json({
          success: false,
          error: 'Apenas administradores podem criar tokens de sistema'
        });
      }

      const validated = createSystemTokenSchema.parse(req.body);
      
      const token = await systemTokenService.createToken({
        name: validated.name,
        description: validated.description,
        allowed_ips: validated.allowed_ips,
        expires_at: validated.expires_at ? new Date(validated.expires_at) : undefined,
        created_by: req.user.userId
      });

      logInfo('System token created', {
        tokenId: token.id,
        name: token.name,
        createdBy: req.user.userId
      });

      res.status(201).json({
        success: true,
        data: {
          token: {
            id: token.id,
            name: token.name,
            token: token.token, // Retorna o token apenas na criação
            description: token.description,
            allowed_ips: token.allowed_ips,
            expires_at: token.expires_at,
            created_at: token.created_at
          },
          warning: 'Guarde este token em local seguro. Ele não será exibido novamente.'
        }
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        logWarn('System token creation validation failed', { errors: error.errors });
        return res.status(400).json({
          success: false,
          error: 'Dados inválidos',
          details: error.errors
        });
      }

      logError('Error creating system token', error, { userId: req.user?.userId });
      res.status(500).json({
        success: false,
        error: 'Erro ao criar token de sistema'
      });
    }
  }

  /**
   * Lista todos os tokens de sistema
   * GET /api/system-tokens
   * Requer autenticação de usuário admin
   */
  async list(req: AuthRequest, res: Response) {
    try {
      // Verificar se o usuário é admin
      if (req.user?.role !== 'admin') {
        logWarn('Non-admin user attempted to list system tokens', {
          userId: req.user?.userId
        });
        return res.status(403).json({
          success: false,
          error: 'Apenas administradores podem listar tokens de sistema'
        });
      }

      const tokens = await systemTokenService.listTokens();

      res.json({
        success: true,
        data: { tokens }
      });
    } catch (error: any) {
      logError('Error listing system tokens', error);
      res.status(500).json({
        success: false,
        error: 'Erro ao listar tokens de sistema'
      });
    }
  }

  /**
   * Busca um token específico
   * GET /api/system-tokens/:id
   * Requer autenticação de usuário admin
   */
  async getById(req: AuthRequest, res: Response) {
    try {
      // Verificar se o usuário é admin
      if (req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Apenas administradores podem visualizar tokens de sistema'
        });
      }

      const token = await systemTokenService.getTokenById(req.params.id);

      if (!token) {
        return res.status(404).json({
          success: false,
          error: 'Token não encontrado'
        });
      }

      res.json({
        success: true,
        data: { token }
      });
    } catch (error: any) {
      logError('Error fetching system token', error, { tokenId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Erro ao buscar token'
      });
    }
  }

  /**
   * Revoga um token de sistema
   * DELETE /api/system-tokens/:id
   * Requer autenticação de usuário admin
   */
  async revoke(req: AuthRequest, res: Response) {
    try {
      // Verificar se o usuário é admin
      if (req.user?.role !== 'admin') {
        logWarn('Non-admin user attempted to revoke system token', {
          userId: req.user?.userId
        });
        return res.status(403).json({
          success: false,
          error: 'Apenas administradores podem revogar tokens de sistema'
        });
      }

      await systemTokenService.revokeToken(req.params.id);

      logInfo('System token revoked', {
        tokenId: req.params.id,
        revokedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Token revogado com sucesso'
      });
    } catch (error: any) {
      logError('Error revoking system token', error, { tokenId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Erro ao revogar token'
      });
    }
  }

  /**
   * Atualiza IPs permitidos de um token
   * PUT /api/system-tokens/:id/allowed-ips
   * Requer autenticação de usuário admin
   */
  async updateAllowedIps(req: AuthRequest, res: Response) {
    try {
      // Verificar se o usuário é admin
      if (req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Apenas administradores podem atualizar tokens de sistema'
        });
      }

      const validated = updateAllowedIpsSchema.parse(req.body);
      
      await systemTokenService.updateAllowedIps(req.params.id, validated.allowed_ips);

      logInfo('System token IPs updated', {
        tokenId: req.params.id,
        updatedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'IPs permitidos atualizados com sucesso'
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Dados inválidos',
          details: error.errors
        });
      }

      logError('Error updating system token IPs', error, { tokenId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Erro ao atualizar IPs permitidos'
      });
    }
  }

  /**
   * Obtém logs de uso de um token
   * GET /api/system-tokens/:id/logs
   * Requer autenticação de usuário admin
   */
  async getLogs(req: AuthRequest, res: Response) {
    try {
      // Verificar se o usuário é admin
      if (req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Apenas administradores podem visualizar logs'
        });
      }

      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await systemTokenService.getTokenLogs(req.params.id, limit);

      res.json({
        success: true,
        data: { logs }
      });
    } catch (error: any) {
      logError('Error fetching system token logs', error, { tokenId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Erro ao buscar logs'
      });
    }
  }
}

export const systemTokenController = new SystemTokenController();
