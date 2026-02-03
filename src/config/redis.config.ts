import Redis from 'ioredis';
import { config } from './index';
import { logInfo, logError } from '../utils/logger';

// Configuração base do Redis
export const redisConnection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

// Namespaces para evitar conflitos
export const REDIS_NAMESPACES = {
  CHAT_HISTORY: 'chat:',           // Usado pelo N8N (não tocar!)
  BULL_QUEUE: 'bull',              // Usado pelo Bull (automático)
  PUBSUB_RESPONSE: 'pubsub:response:', // Canais de resposta
  PUBSUB_CONVERSATION: 'pubsub:conversation:', // Canais por conversa
} as const;

// Cliente Redis para operações gerais (histórico, cache, etc)
let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(redisConnection);
    
    redisClient.on('connect', () => {
      logInfo('✅ Redis client connected');
    });
    
    redisClient.on('error', (err) => {
      logError('❌ Redis client error', err);
    });
  }
  
  return redisClient;
}

// Cliente Redis para Publisher (PubSub)
let redisPublisher: Redis | null = null;

export function getRedisPublisher(): Redis {
  if (!redisPublisher) {
    redisPublisher = new Redis(redisConnection);
    
    redisPublisher.on('connect', () => {
      logInfo('✅ Redis publisher connected');
    });
    
    redisPublisher.on('error', (err) => {
      logError('❌ Redis publisher error', err);
    });
  }
  
  return redisPublisher;
}

// Cliente Redis para Subscriber (PubSub)
let redisSubscriber: Redis | null = null;

export function getRedisSubscriber(): Redis {
  if (!redisSubscriber) {
    redisSubscriber = new Redis(redisConnection);
    
    redisSubscriber.on('connect', () => {
      logInfo('✅ Redis subscriber connected');
    });
    
    redisSubscriber.on('error', (err) => {
      logError('❌ Redis subscriber error', err);
    });
  }
  
  return redisSubscriber;
}

// Função para fechar todas as conexões Redis (graceful shutdown)
export async function closeRedisConnections() {
  const promises = [];
  
  if (redisClient) {
    promises.push(redisClient.quit());
    logInfo('Closing Redis client...');
  }
  
  if (redisPublisher) {
    promises.push(redisPublisher.quit());
    logInfo('Closing Redis publisher...');
  }
  
  if (redisSubscriber) {
    promises.push(redisSubscriber.quit());
    logInfo('Closing Redis subscriber...');
  }
  
  await Promise.all(promises);
  logInfo('✅ All Redis connections closed');
}

// Helper: Buscar histórico de chat (compatível com N8N)
export async function getChatHistory(conversationId: string): Promise<any[]> {
  const client = getRedisClient();
  const key = `${REDIS_NAMESPACES.CHAT_HISTORY}${conversationId}`;
  
  try {
    const data = await client.get(key);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    logError('Error getting chat history from Redis', error as Error);
    return [];
  }
}

// Helper: Salvar histórico de chat (compatível com N8N)
export async function saveChatHistory(
  conversationId: string,
  history: any[],
  ttl: number = 604800 // 7 dias (mesmo TTL do N8N)
): Promise<void> {
  const client = getRedisClient();
  const key = `${REDIS_NAMESPACES.CHAT_HISTORY}${conversationId}`;
  
  try {
    await client.setex(key, ttl, JSON.stringify(history));
  } catch (error) {
    logError('Error saving chat history to Redis', error as Error);
    throw error;
  }
}
