import dotenv from 'dotenv';
import type { StringValue } from 'ms';

dotenv.config();

// Validar configurações críticas em produção
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-key') {
    throw new Error('JWT_SECRET must be set in production environment');
  }
  if (!process.env.POSTGRES_PASSWORD || process.env.POSTGRES_PASSWORD === 'postgres') {
    console.warn('⚠️  WARNING: Using default PostgreSQL password in production');
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'ai_agents',
  },
  
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_agents',
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-key',
    expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as StringValue,
  },
  
  n8n: {
    baseUrl: process.env.N8N_BASE_URL || 'http://localhost:5678',
    apiKey: process.env.N8N_API_KEY || '',
  },
  
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(','),
  },
  
  // System API Keys para integração com N8N e outros sistemas
  systemApiKeys: (process.env.SYSTEM_API_KEYS || '').split(',').filter(k => k.trim()),
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    toFile: process.env.LOG_TO_FILE === 'true',
  },
};
