import mongoose, { Schema, Document } from 'mongoose';

/**
 * Direção da mensagem
 * - inbound: mensagem recebida (entrada no sistema)
 * - outbound: mensagem enviada (saída do sistema)
 */
export type MessageDirection = 'inbound' | 'outbound';

/**
 * Tipo/origem da mensagem
 * - user: mensagem enviada pelo usuário/cliente
 * - assistant: mensagem gerada pela IA
 * - system: mensagem do sistema (notificações, avisos, etc)
 * - external: mensagem de fonte externa (webhooks, integrações)
 */
export type MessageType = 'user' | 'assistant' | 'system' | 'external';

/**
 * Status de processamento da mensagem
 */
export type MessageStatus = 'queued' | 'processing' | 'delivered' | 'failed' | 'cancelled';

export interface IMessage extends Document {
  messageId: string;               // UUID da mensagem
  conversationId: string;          // UUID da conversa
  
  // Identificação básica
  agentId: string;                 // ID do agente
  userId?: string;                 // ID do usuário (se autenticado)
  
  // Conteúdo
  content: string;                 // Conteúdo da mensagem
  
  // Classificação
  type: MessageType;               // Tipo da mensagem
  direction: MessageDirection;     // Direção (entrada/saída)
  role: 'user' | 'assistant' | 'system'; // Role (compatibilidade com IA)
  
  // Status
  status: MessageStatus;           // Status de processamento
  
  // Timestamps
  queuedAt?: Date;                 // Quando foi enfileirada
  processedAt?: Date;              // Quando começou a ser processada
  deliveredAt?: Date;              // Quando foi entregue
  createdAt: Date;                 // Quando foi criada
  
  // Informações de processamento (para mensagens do assistente)
  processingTime?: number;         // Tempo de processamento (ms)
  tokensUsed?: number;             // Tokens consumidos
  model?: string;                  // Modelo de IA usado
  finishReason?: string;           // Motivo de finalização
  
  // Informações do canal
  channel: 'web' | 'whatsapp' | 'telegram' | 'api';
  channelMetadata?: Record<string, any>;
  
  // Referências
  replyToMessageId?: string;       // ID da mensagem sendo respondida
  executionId?: string;            // ID da execução (se houver)
  jobId?: string;                  // ID do job na fila
  
  // Erros (se houver)
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  
  // Metadados gerais
  metadata?: Record<string, any>;
}

const MessageSchema = new Schema<IMessage>({
  messageId: { type: String, required: true, unique: true, index: true },
  conversationId: { type: String, required: true, index: true },
  
  agentId: { type: String, required: true, index: true },
  userId: { type: String, index: true },
  
  content: { type: String, required: true },
  
  type: { 
    type: String, 
    required: true,
    enum: ['user', 'assistant', 'system', 'external'],
    index: true
  },
  direction: { 
    type: String, 
    required: true,
    enum: ['inbound', 'outbound']
  },
  role: { 
    type: String, 
    required: true,
    enum: ['user', 'assistant', 'system']
  },
  
  status: { 
    type: String, 
    required: true,
    enum: ['queued', 'processing', 'delivered', 'failed', 'cancelled'],
    default: 'queued',
    index: true
  },
  
  queuedAt: { type: Date },
  processedAt: { type: Date },
  deliveredAt: { type: Date },
  createdAt: { type: Date, default: Date.now, index: true },
  
  processingTime: { type: Number },
  tokensUsed: { type: Number },
  model: { type: String },
  finishReason: { type: String },
  
  channel: { 
    type: String, 
    required: true,
    enum: ['web', 'whatsapp', 'telegram', 'api']
  },
  channelMetadata: { type: Schema.Types.Mixed },
  
  replyToMessageId: { type: String, index: true },
  executionId: { type: String, index: true },
  jobId: { type: String, index: true },
  
  error: {
    message: { type: String },
    code: { type: String },
    details: { type: Schema.Types.Mixed }
  },
  
  metadata: { type: Schema.Types.Mixed },
}, {
  timestamps: false, // Gerenciamos manualmente os timestamps
});

// Índices compostos para queries comuns
MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index({ agentId: 1, createdAt: -1 });
MessageSchema.index({ userId: 1, createdAt: -1 });
MessageSchema.index({ type: 1, status: 1, createdAt: -1 });

export const Message = mongoose.model<IMessage>('Message', MessageSchema);
