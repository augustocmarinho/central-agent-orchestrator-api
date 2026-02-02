import { Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { loginSchema, registerSchema } from '../utils/validators';
import { logInfo, logError, logWarn } from '../utils/logger';
import { ZodError } from 'zod';

export class AuthController {
  async login(req: Request, res: Response) {
    try {
      const validated = loginSchema.parse(req.body);
      const result = await authService.login(validated);
      
      logInfo('User logged in successfully', { 
        email: validated.email,
        userId: result.user.id 
      });
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        logWarn('Login validation failed', { errors: error.errors });
        return res.status(400).json({
          success: false,
          error: 'Dados inválidos',
          details: error.errors,
        });
      }
      
      logWarn('Login failed', { 
        email: req.body?.email,
        error: error.message 
      });
      
      res.status(401).json({
        success: false,
        error: error.message || 'Erro ao fazer login',
      });
    }
  }
  
  async register(req: Request, res: Response) {
    try {
      const validated = registerSchema.parse(req.body);
      const user = await authService.createUser(validated);
      
      logInfo('User registered successfully', { 
        email: validated.email,
        userId: user.id 
      });
      
      res.status(201).json({
        success: true,
        data: { user },
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        logWarn('Registration validation failed', { errors: error.errors });
        return res.status(400).json({
          success: false,
          error: 'Dados inválidos',
          details: error.errors,
        });
      }
      
      // Verificar se é erro de email duplicado
      if (error.message?.includes('duplicate') || error.code === '23505') {
        logWarn('Registration failed - duplicate email', { email: req.body?.email });
        return res.status(409).json({
          success: false,
          error: 'Email já cadastrado',
        });
      }
      
      logError('Registration failed', error, { email: req.body?.email });
      
      res.status(500).json({
        success: false,
        error: error.message || 'Erro ao criar usuário',
      });
    }
  }
  
  async me(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId;
      const user = await authService.getUserById(userId);
      
      if (!user) {
        logWarn('User profile not found', { userId });
        return res.status(404).json({
          success: false,
          error: 'Usuário não encontrado',
        });
      }
      
      res.json({
        success: true,
        data: { user },
      });
    } catch (error: any) {
      logError('Error fetching user profile', error, { userId: (req as any).user?.userId });
      res.status(500).json({
        success: false,
        error: 'Erro ao buscar perfil do usuário',
      });
    }
  }
}

export const authController = new AuthController();
