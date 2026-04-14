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
  AGENT_CONTEXT: 'agent_ctx:',    // Cache de contexto do agente (agent + tools)
  DEBOUNCE_BUFFER: 'debounce:',   // Buffer de mensagens para debounce
  FOLLOWUP_STATE: 'followup:',   // Estado de sequência de follow-up ativa
  FOLLOWUP_CONFIG_CACHE: 'followup_cfg:', // Cache de configuração de follow-up
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

// ─── Cache de contexto do agente (agent + tools) ────────────────────

const AGENT_CONTEXT_TTL = 120; // 2 minutos — safety net; invalidação ativa garante freshness

export async function getAgentContextCache(agentId: string): Promise<{ agent: any; tools: any[] } | null> {
  try {
    const data = await getRedisClient().get(`${REDIS_NAMESPACES.AGENT_CONTEXT}${agentId}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    logError('Error reading agent context cache', error as Error, { agentId });
    return null;
  }
}

export async function setAgentContextCache(agentId: string, agent: any, tools: any[]): Promise<void> {
  try {
    await getRedisClient().setex(
      `${REDIS_NAMESPACES.AGENT_CONTEXT}${agentId}`,
      AGENT_CONTEXT_TTL,
      JSON.stringify({ agent, tools })
    );
  } catch (error) {
    logError('Error writing agent context cache', error as Error, { agentId });
  }
}

export async function invalidateAgentContextCache(agentId: string): Promise<void> {
  try {
    await getRedisClient().del(`${REDIS_NAMESPACES.AGENT_CONTEXT}${agentId}`);
    logInfo('Agent context cache invalidated', { agentId });
  } catch (error) {
    logError('Error invalidating agent context cache', error as Error, { agentId });
  }
}

// ─── Histórico de chat ──────────────────────────────────────────────

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
