import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { logWarn } from '../utils/logger';

/**
 * Middleware de autorização admin.
 * Deve ser usado APÓS authMiddleware nas rotas.
 */
export const adminMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    logWarn('Non-admin access attempt', {
      userId: req.user?.userId,
      path: req.path,
      method: req.method,
    });
    return res.status(403).json({
      success: false,
      error: 'Acesso restrito a administradores',
    });
  }
  next();
};
