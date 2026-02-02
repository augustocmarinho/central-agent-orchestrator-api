import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config';
import routes from './routes';
import { logHttp, logError, logWarn } from './utils/logger';

const app = express();

// CORS
app.use(cors({
  origin: config.cors.allowedOrigins,
  credentials: true,
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    logHttp(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  });
  
  next();
});

// Routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'AI Agents Backend',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  logWarn('Endpoint not found', { 
    method: req.method, 
    path: req.path,
    ip: req.ip 
  });
  
  res.status(404).json({
    success: false,
    error: 'Endpoint não encontrado',
  });
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logError('Unhandled error in request', err, {
    method: req.method,
    path: req.path,
    body: req.body,
    ip: req.ip,
  });
  
  res.status(err.status || 500).json({
    success: false,
    error: config.nodeEnv === 'production' 
      ? 'Erro interno do servidor' 
      : err.message || 'Erro interno do servidor',
  });
});

export default app;
