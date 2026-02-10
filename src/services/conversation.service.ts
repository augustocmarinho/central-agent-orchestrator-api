import { Conversation, IConversation, IContact } from '../models/mongodb/Conversation';
import { Message, IMessage, MessageType, MessageDirection, MessageStatus } from '../models/mongodb/Message';
import { logInfo, logError } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Interface para criar uma nova conversa
 */
export interface CreateConversationData {
  conversationId?: string;
  agentId: string;
  userId?: string;
  source: IContact;
  destination: IContact;
  channel: 'web' | 'whatsapp' | 'telegram' | 'api';
  channelMetadata?: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * Interface para salvar uma mensagem
 */
export interface SaveMessageData {
  messageId?: string;
  conversationId: string;
  agentId: string;
  userId?: string;
  content: string;
  type: MessageType;
  direction: MessageDirection;
  channel: 'web' | 'whatsapp' | 'telegram' | 'api';
  channelMetadata?: Record<string, any>;
  status?: MessageStatus;
  queuedAt?: Date;
  processedAt?: Date;
  deliveredAt?: Date;
  processingTime?: number;
  tokensUsed?: number;
  model?: string;
  finishReason?: string;
  replyToMessageId?: string;
  executionId?: string;
  jobId?: string;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  metadata?: Record<string, any>;
}

/**
 * Serviço para gerenciar conversas e mensagens no MongoDB
 */
export class ConversationService {
  /**
   * Cria ou busca uma conversa existente
   */
  async createOrGetConversation(data: CreateConversationData): Promise<IConversation> {
    try {
      const conversationId = data.conversationId || uuidv4();

      // Verificar se já existe
      let conversation = await Conversation.findOne({ conversationId });

      if (conversation) {
        logInfo('Conversation found', { conversationId });
        return conversation;
      }

      // Criar nova conversa
      conversation = await Conversation.create({
        conversationId,
        agentId: data.agentId,
        userId: data.userId,
        source: data.source,
        destination: data.destination,
        channel: data.channel,
        channelMetadata: data.channelMetadata,
        status: 'active',
        startedAt: new Date(),
        lastMessageAt: new Date(),
        messageCount: 0,
        userMessageCount: 0,
        assistantMessageCount: 0,
        metadata: data.metadata,
      });

      logInfo('Conversation created', { 
        conversationId: conversation.conversationId,
        agentId: conversation.agentId,
        channel: conversation.channel
      });

      return conversation;
    } catch (error: any) {
      logError('Error creating/getting conversation', error);
      throw error;
    }
  }

  /**
   * Busca conversa por número de telefone WhatsApp e agente
   * Útil para canais externos que identificam usuários por número
   */
  async findConversationByPhoneAndAgent(
    phoneNumber: string,
    agentId: string,
    channel: 'whatsapp' | 'telegram' = 'whatsapp'
  ): Promise<IConversation | null> {
    try {
      const conversation = await Conversation.findOne({
        agentId,
        channel,
        status: 'active',
        // Importante: o campo correto é source.phoneNumber (ver ConversationSchema)
        'source.phoneNumber': phoneNumber,
      }).sort({ lastMessageAt: -1 }); // Pegar a mais recente

      if (conversation) {
        logInfo('Conversation found by phone', { 
          conversationId: conversation.conversationId,
          phoneNumber,
          agentId 
        });
      }

      return conversation;
    } catch (error: any) {
      logError('Error finding conversation by phone', error);
      return null;
    }
  }

  /**
   * Salva uma mensagem no MongoDB
   */
  async saveMessage(data: SaveMessageData): Promise<IMessage> {
    try {
      const messageId = data.messageId || uuidv4();

      // Determinar role baseado no type
      let role: 'user' | 'assistant' | 'system' = 'user';
      if (data.type === 'assistant') role = 'assistant';
      else if (data.type === 'system') role = 'system';

      // Criar mensagem
      const message = await Message.create({
        messageId,
        conversationId: data.conversationId,
        agentId: data.agentId,
        userId: data.userId,
        content: data.content,
        type: data.type,
        direction: data.direction,
        role,
        status: data.status || 'queued',
        queuedAt: data.queuedAt,
        processedAt: data.processedAt,
        deliveredAt: data.deliveredAt,
        createdAt: new Date(),
        processingTime: data.processingTime,
        tokensUsed: data.tokensUsed,
        model: data.model,
        finishReason: data.finishReason,
        channel: data.channel,
        channelMetadata: data.channelMetadata,
        replyToMessageId: data.replyToMessageId,
        executionId: data.executionId,
        jobId: data.jobId,
        error: data.error,
        metadata: data.metadata,
      });

      // Atualizar estatísticas da conversa
      await this.updateConversationStats(data.conversationId, data.type);

      logInfo('Message saved', { 
        messageId: message.messageId,
        conversationId: message.conversationId,
        type: message.type,
        direction: message.direction
      });

      return message;
    } catch (error: any) {
      logError('Error saving message', error);
      throw error;
    }
  }

  /**
   * Atualiza o status de uma mensagem
   */
  async updateMessageStatus(
    messageId: string,
    status: MessageStatus,
    extraData?: {
      processedAt?: Date;
      deliveredAt?: Date;
      processingTime?: number;
      error?: {
        message: string;
        code?: string;
        details?: any;
      };
    }
  ): Promise<IMessage | null> {
    try {
      const updateData: any = { status };

      if (extraData?.processedAt) updateData.processedAt = extraData.processedAt;
      if (extraData?.deliveredAt) updateData.deliveredAt = extraData.deliveredAt;
      if (extraData?.processingTime) updateData.processingTime = extraData.processingTime;
      if (extraData?.error) updateData.error = extraData.error;

      const message = await Message.findOneAndUpdate(
        { messageId },
        updateData,
        { new: true }
      );

      if (message) {
        logInfo('Message status updated', { messageId, status });
      }

      return message;
    } catch (error: any) {
      logError('Error updating message status', error);
      throw error;
    }
  }

  /**
   * Atualiza estatísticas da conversa
   */
  private async updateConversationStats(conversationId: string, messageType: MessageType): Promise<void> {
    try {
      const updateData: any = {
        $inc: { messageCount: 1 },
        lastMessageAt: new Date(),
      };

      if (messageType === 'user') {
        updateData.$inc.userMessageCount = 1;
      } else if (messageType === 'assistant') {
        updateData.$inc.assistantMessageCount = 1;
      }

      await Conversation.findOneAndUpdate(
        { conversationId },
        updateData
      );
    } catch (error: any) {
      logError('Error updating conversation stats', error);
      // Não lançar erro, apenas logar
    }
  }

  /**
   * Atualiza status da conversa
   */
  async updateConversationStatus(
    conversationId: string,
    status: 'active' | 'closed' | 'transferred' | 'paused'
  ): Promise<IConversation | null> {
    try {
      const updateData: any = { status };

      if (status === 'closed') {
        updateData.endedAt = new Date();
      }

      const conversation = await Conversation.findOneAndUpdate(
        { conversationId },
        updateData,
        { new: true }
      );

      if (conversation) {
        logInfo('Conversation status updated', { conversationId, status });
      }

      return conversation;
    } catch (error: any) {
      logError('Error updating conversation status', error);
      throw error;
    }
  }

  /**
   * Busca uma conversa pelo ID
   */
  async getConversation(conversationId: string): Promise<IConversation | null> {
    try {
      return await Conversation.findOne({ conversationId });
    } catch (error: any) {
      logError('Error getting conversation', error);
      throw error;
    }
  }

  /**
   * Busca mensagens de uma conversa
   */
  async getConversationMessages(
    conversationId: string,
    options?: {
      limit?: number;
      offset?: number;
      order?: 'asc' | 'desc';
    }
  ): Promise<any[]> {
    try {
      const limit = options?.limit || 100;
      const offset = options?.offset || 0;
      const order = options?.order === 'desc' ? -1 : 1;

      return await Message.find({ conversationId })
        .sort({ createdAt: order })
        .skip(offset)
        .limit(limit)
        .lean();
    } catch (error: any) {
      logError('Error getting conversation messages', error);
      throw error;
    }
  }

  /**
   * Busca conversas de um agente
   */
  async getAgentConversations(
    agentId: string,
    options?: {
      status?: 'active' | 'closed' | 'transferred' | 'paused';
      limit?: number;
      offset?: number;
    }
  ): Promise<any[]> {
    try {
      const limit = options?.limit || 50;
      const offset = options?.offset || 0;
      const query: any = { agentId };

      if (options?.status) {
        query.status = options.status;
      }

      return await Conversation.find(query)
        .sort({ lastMessageAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean();
    } catch (error: any) {
      logError('Error getting agent conversations', error);
      throw error;
    }
  }

  /**
   * Busca conversas de um usuário
   */
  async getUserConversations(
    userId: string,
    options?: {
      status?: 'active' | 'closed' | 'transferred' | 'paused';
      limit?: number;
      offset?: number;
    }
  ): Promise<any[]> {
    try {
      const limit = options?.limit || 50;
      const offset = options?.offset || 0;
      const query: any = { userId };

      if (options?.status) {
        query.status = options.status;
      }

      return await Conversation.find(query)
        .sort({ lastMessageAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean();
    } catch (error: any) {
      logError('Error getting user conversations', error);
      throw error;
    }
  }

  /**
   * Busca conversa por origem (útil para WhatsApp/Telegram)
   */
  async getConversationBySource(
    agentId: string,
    sourceType: string,
    sourceIdentifier: Record<string, any>,
    status?: 'active' | 'closed' | 'transferred' | 'paused'
  ): Promise<IConversation | null> {
    try {
      const query: any = {
        agentId,
        'source.type': sourceType,
      };

      // Adicionar identificadores específicos do canal
      Object.keys(sourceIdentifier).forEach(key => {
        query[`source.${key}`] = sourceIdentifier[key];
      });

      if (status) {
        query.status = status;
      } else {
        query.status = 'active'; // Por padrão buscar apenas conversas ativas
      }

      return await Conversation.findOne(query).sort({ lastMessageAt: -1 });
    } catch (error: any) {
      logError('Error getting conversation by source', error);
      throw error;
    }
  }

  /**
   * Busca estatísticas de conversas
   */
  async getConversationStats(agentId: string, period?: { from: Date; to: Date }): Promise<any> {
    try {
      const query: any = { agentId };

      if (period) {
        query.startedAt = {
          $gte: period.from,
          $lte: period.to,
        };
      }

      const [totalConversations, activeConversations, totalMessages] = await Promise.all([
        Conversation.countDocuments(query),
        Conversation.countDocuments({ ...query, status: 'active' }),
        Conversation.aggregate([
          { $match: query },
          { $group: { _id: null, total: { $sum: '$messageCount' } } }
        ])
      ]);

      return {
        totalConversations,
        activeConversations,
        closedConversations: totalConversations - activeConversations,
        totalMessages: totalMessages[0]?.total || 0,
      };
    } catch (error: any) {
      logError('Error getting conversation stats', error);
      throw error;
    }
  }
}

// Singleton instance
export const conversationService = new ConversationService();
