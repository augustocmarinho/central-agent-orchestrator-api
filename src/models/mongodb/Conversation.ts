import mongoose, { Schema, Document } from 'mongoose';

/**
 * Interface para Contact (origem e destino)
 * Armazena informações de identificação do contato em cada canal
 */
export interface IContact {
  type: 'websocket' | 'whatsapp' | 'telegram' | 'api' | 'system';
  
  // WebSocket
  socketId?: string;
  
  // WhatsApp
  phoneNumber?: string;
  whatsappChatId?: string;
  
  // Telegram
  telegramChatId?: string;
  telegramUserId?: string;
  telegramUsername?: string;
  
  // API
  apiClientId?: string;
  callbackUrl?: string;
  
  // Sistema (para mensagens internas)
  systemId?: string;
  
  // Informações adicionais
  name?: string;
  metadata?: Record<string, any>;
}

const ContactSchema = new Schema<IContact>({
  type: { 
    type: String, 
    required: true,
    enum: ['websocket', 'whatsapp', 'telegram', 'api', 'system']
  },
  socketId: { type: String },
  phoneNumber: { type: String },
  whatsappChatId: { type: String },
  telegramChatId: { type: String },
  telegramUserId: { type: String },
  telegramUsername: { type: String },
  apiClientId: { type: String },
  callbackUrl: { type: String },
  systemId: { type: String },
  name: { type: String },
  metadata: { type: Schema.Types.Mixed },
}, { _id: false });

export interface IConversation extends Document {
  conversationId: string;          // UUID da conversa
  agentId: string;                 // ID do agente
  userId?: string;                 // ID do usuário autenticado (opcional)
  
  // Origem e Destino
  source: IContact;                // Contato de origem (quem iniciou/envia mensagens)
  destination: IContact;           // Contato de destino (agente/bot)
  
  // Informações do canal
  channel: 'web' | 'whatsapp' | 'telegram' | 'api';
  channelMetadata?: Record<string, any>;
  
  // Status e timestamps
  status: 'active' | 'closed' | 'transferred' | 'paused';
  startedAt: Date;
  lastMessageAt?: Date;
  endedAt?: Date;
  
  // Estatísticas
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  
  // Metadados gerais
  metadata?: Record<string, any>;
}

const ConversationSchema = new Schema<IConversation>({
  conversationId: { type: String, required: true, unique: true, index: true },
  agentId: { type: String, required: true, index: true },
  userId: { type: String, index: true },
  
  source: { type: ContactSchema, required: true },
  destination: { type: ContactSchema, required: true },
  
  channel: { 
    type: String, 
    required: true,
    enum: ['web', 'whatsapp', 'telegram', 'api'],
    index: true
  },
  channelMetadata: { type: Schema.Types.Mixed },
  
  status: { 
    type: String, 
    enum: ['active', 'closed', 'transferred', 'paused'],
    default: 'active',
    index: true
  },
  startedAt: { type: Date, default: Date.now, index: true },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  endedAt: { type: Date },
  
  messageCount: { type: Number, default: 0 },
  userMessageCount: { type: Number, default: 0 },
  assistantMessageCount: { type: Number, default: 0 },
  
  metadata: { type: Schema.Types.Mixed },
}, {
  timestamps: true,
});

// Índices compostos para queries comuns
ConversationSchema.index({ agentId: 1, status: 1, startedAt: -1 });
ConversationSchema.index({ userId: 1, startedAt: -1 });
ConversationSchema.index({ 'source.phoneNumber': 1 }); // Para WhatsApp
ConversationSchema.index({ 'source.telegramChatId': 1 }); // Para Telegram

export const Conversation = mongoose.model<IConversation>('Conversation', ConversationSchema);
