import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../auth/jwt';
import { logWarn } from '../utils/logger';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
  };
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logWarn('Auth attempt without Bearer token', { 
        path: req.path,
        ip: req.ip 
      });
      return res.status(401).json({ 
        success: false,
        error: 'Token não fornecido' 
      });
    }
    
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    
    req.user = payload;
    next();
  } catch (error) {
    logWarn('Auth attempt with invalid token', { 
      path: req.path,
      ip: req.ip,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return res.status(401).json({ 
      success: false,
      error: 'Token inválido ou expirado' 
    });
  }
};
