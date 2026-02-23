import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logWarn, logInfo } from '../utils/logger';
import { systemTokenService, SystemToken } from '../services/systemToken.service';

export interface SystemAuthRequest extends Request {
  isSystemRequest?: boolean;
  systemApiKey?: string;
  systemToken?: SystemToken;
}

/**
 * Middleware para autenticação de sistemas externos (como N8N)
 * Suporta header X-System-API-Key (system token, não Bearer).
 * 1. Tokens do banco de dados - com validação de IP e expiração
 * 2. API Keys de ambiente (legado, para compatibilidade)
 */
export const systemAuthMiddleware = async (req: SystemAuthRequest, res: Response, next: NextFunction) => {
  try {
    const apiKey = req.headers['x-system-api-key'] as string;
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || 
                     req.ip || 
                     req.socket.remoteAddress || 
                     'unknown';
    
    if (!apiKey) {
      logWarn('System API request without API key', { 
        path: req.path, 
        ip: clientIp 
      });
      return res.status(401).json({ 
        success: false,
        error: 'API Key não fornecida (use X-System-API-Key)' 
      });
    }
    
    // Primeiro, tentar validar como token do banco de dados
    const systemToken = await systemTokenService.validateToken(apiKey, clientIp);
    
    if (systemToken) {
      // Token válido do banco
      req.isSystemRequest = true;
      req.systemApiKey = apiKey;
      req.systemToken = systemToken;
      
      logInfo('System API request authenticated (database token)', { 
        tokenId: systemToken.id,
        tokenName: systemToken.name,
        path: req.path,
        method: req.method,
        ip: clientIp
      });
      
      // Registrar uso do token
      await systemTokenService.logTokenUsage({
        system_token_id: systemToken.id,
        ip_address: clientIp,
        path: req.path,
        method: req.method,
        success: true
      });
      
      return next();
    }
    
    // Fallback: verificar API Keys de ambiente (legado)
    if (config.systemApiKeys.includes(apiKey)) {
      req.isSystemRequest = true;
      req.systemApiKey = apiKey;
      
      logInfo('System API request authenticated (environment key)', { 
        path: req.path,
        method: req.method,
        ip: clientIp
      });
      
      return next();
    }
    
    // Token inválido
    logWarn('System API request with invalid API key', { 
      path: req.path, 
      ip: clientIp 
    });
    
    return res.status(401).json({ 
      success: false,
      error: 'API Key inválida' 
    });
    
  } catch (error) {
    logWarn('Error in system auth middleware', { error });
    return res.status(500).json({ 
      success: false,
      error: 'Erro na autenticação do sistema' 
    });
  }
};

/**
 * Middleware que aceita tanto autenticação de usuário quanto de sistema
 * Útil para endpoints que podem ser acessados por ambos
 */
export const flexibleAuthMiddleware = async (
  req: SystemAuthRequest, 
  res: Response, 
  next: NextFunction
) => {
  const apiKey = req.headers['x-system-api-key'] as string;
  const authHeader = req.headers.authorization;
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || 
                   req.ip || 
                   req.socket.remoteAddress || 
                   'unknown';
  
  // Tentar autenticação de sistema primeiro
  if (apiKey) {
    // Tentar token do banco
    const systemToken = await systemTokenService.validateToken(apiKey, clientIp);
    
    if (systemToken) {
      req.isSystemRequest = true;
      req.systemApiKey = apiKey;
      req.systemToken = systemToken;
      logInfo('Request authenticated as system (database token)', { 
        tokenId: systemToken.id,
        path: req.path 
      });
      
      await systemTokenService.logTokenUsage({
        system_token_id: systemToken.id,
        ip_address: clientIp,
        path: req.path,
        method: req.method,
        success: true
      });
      
      return next();
    }
    
    // Fallback: API Keys de ambiente
    if (config.systemApiKeys.includes(apiKey)) {
      req.isSystemRequest = true;
      req.systemApiKey = apiKey;
      logInfo('Request authenticated as system (environment key)', { path: req.path });
      return next();
    }
  }
  
  // Tentar autenticação de usuário JWT
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Importar dinamicamente para evitar dependência circular
    const { authMiddleware } = await import('./auth');
    return authMiddleware(req, res, next);
  }
  
  return res.status(401).json({ 
    success: false,
    error: 'Autenticação necessária (Bearer token ou X-System-API-Key)' 
  });
};
