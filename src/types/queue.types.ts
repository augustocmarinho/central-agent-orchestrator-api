/**
 * Types para o sistema de mensageria assíncrona
 */

// Canais suportados
export type MessageChannel = 'web' | 'whatsapp' | 'telegram' | 'api';

// Status de processamento
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

// Job de mensagem que entra na fila
export interface MessageJob {
  id: string;                     // UUID único da mensagem
  conversationId: string;          // ID da conversa
  agentId: string;                 // ID do agente
  userId: string;                  // ID do usuário
  message: string;                 // Conteúdo da mensagem
  channel: MessageChannel;         // Canal de origem
  channelMetadata: ChannelMetadata; // Metadados específicos do canal
  priority: number;                // Prioridade (1-10, menor = maior prioridade)
  timestamp: string;               // ISO timestamp
  retries: number;                 // Número de tentativas
}

// Metadados específicos por canal
export interface ChannelMetadata {
  // Web/WebSocket
  websocketId?: string;            // ID da conexão WebSocket
  
  // WhatsApp
  phoneNumber?: string;            // Número do WhatsApp
  whatsappChatId?: string;         // ID do chat WhatsApp
  
  // Telegram
  telegramChatId?: string;         // ID do chat Telegram
  telegramUserId?: string;         // ID do usuário Telegram
  
  // API
  callbackUrl?: string;            // URL de callback
  callbackHeaders?: Record<string, string>; // Headers para callback
  
  // Genérico
  [key: string]: any;              // Outros metadados customizados
}

// Evento de resposta publicado no PubSub
export interface ResponseEvent {
  messageId: string;               // ID da mensagem original
  conversationId: string;          // ID da conversa
  agentId: string;                 // ID do agente
  response: {
    message: string;               // Resposta da IA
    tokensUsed: number;            // Tokens consumidos
    model: string;                 // Modelo usado
    finishReason: string;          // Motivo de finalização
  };
  channel: MessageChannel;         // Canal de destino
  channelMetadata: ChannelMetadata; // Metadados do canal
  timestamp: string;               // ISO timestamp
  processingTime: number;          // Tempo de processamento (ms)
}

// Status de um job
export interface JobStatusResponse {
  id: string;
  messageId: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused' | 'stuck';
  progress: number | object;
  data: MessageJob;
  failedReason?: string;
  finishedOn?: number;
  processedOn?: number;
  response?: ResponseEvent;
}

// Resultado do processamento de mensagem
export interface MessageProcessingResult {
  success: boolean;
  messageId: string;
  conversationId: string;
  response?: string;
  error?: string;
  processingTime: number;
}

// Configuração de retry
export interface RetryConfig {
  attempts: number;
  backoff: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
}

// Estatísticas da fila
export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}
