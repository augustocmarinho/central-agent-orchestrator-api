import { Conversation } from '../models/mongodb/Conversation';
import { Message } from '../models/mongodb/Message';
import { Execution } from '../models/mongodb/Execution';
import { agentService } from './agent.service';
import { pluginService } from './plugin.service';
import { n8nService } from './n8n.service';
import { queueService } from './queue.service';
import { conversationService } from './conversation.service';
import { authService } from './auth.service';
import { v4 as uuidv4 } from 'uuid';
import { logInfo, logError } from '../utils/logger';

export interface SendMessageData {
  agentId: string;
  userId?: string;
  content: string;
  conversationId?: string;
  channel?: string;
  channelMetadata?: any;
  scheduledFor?: Date;
}

export class ChatService {
  /**
   * Envia mensagem usando sistema de filas (assíncrono)
   * Retorna imediatamente com status "queued"
   * 
   * Agora COM PERSISTÊNCIA no MongoDB!
   */
  async sendMessage(data: SendMessageData): Promise<any> {
    try {
      // 1. Validar que agente existe
      // Para mensagens de canais externos (WhatsApp, Telegram), usar getAgentByIdForSystem
      const agent = data.userId 
        ? await agentService.getAgentById(data.agentId, data.userId)
        : await agentService.getAgentByIdForSystem(data.agentId);
        
      if (!agent) {
        throw new Error('Agente não encontrado');
      }

      // 2. Gerar conversationId se não foi fornecido
      const conversationId = data.conversationId || uuidv4();

      // 3. Criar/buscar conversa no MongoDB
      try {
        await conversationService.createOrGetConversation({
          conversationId,
          agentId: data.agentId,
          userId: data.userId,
          source: await this.buildSourceContact(data),
          destination: this.buildDestinationContact(data.agentId, agent.name),
          channel: (data.channel as any) || 'web',
          channelMetadata: data.channelMetadata,
        });
      } catch (error: any) {
        logError('Error creating/getting conversation, continuing...', error);
        // Não falhar se der erro ao criar conversa, apenas logar
      }

      // 4. Salvar mensagem do usuário no MongoDB
      const messageId = uuidv4();
      try {
        await conversationService.saveMessage({
          messageId,
          conversationId,
          agentId: data.agentId,
          userId: data.userId,
          content: data.content,
          type: 'user',
          direction: 'inbound',
          channel: (data.channel as any) || 'web',
          channelMetadata: data.channelMetadata,
          status: data.scheduledFor ? 'queued' : 'queued',
          queuedAt: new Date(),
        });
      } catch (error: any) {
        logError('Error saving user message, continuing...', error);
        // Não falhar se der erro ao salvar mensagem, apenas logar
      }

      // 4.1. Notificar clientes WebSocket sobre a nova mensagem do usuário
      // Isso garante que mensagens vindas de canais externos (ex: WhatsApp)
      // apareçam em tempo real no dashboard, sem precisar recarregar a página.
      try {
        const { WebHandler } = await import('../queues/handlers/web.handler');

        WebHandler.broadcast({
          type: 'user_message',
          data: {
            messageId,
            conversationId,
            content: data.content,
            userId: data.userId,
            timestamp: new Date().toISOString(),
            // Para canais externos não há socket específico de origem
            senderSocketId: undefined,
          },
        });
      } catch (error: any) {
        logError('Error broadcasting user message to WebSocket', error);
      }

      // 5. Enfileirar mensagem para processamento assíncrono
      const result = await queueService.enqueueMessage({
        conversationId,
        agentId: data.agentId,
        userId: data.userId, // Pode ser undefined para canais externos
        message: data.content,
        channel: (data.channel as any) || 'web',
        channelMetadata: {
          ...data.channelMetadata,
          userMessageId: messageId, // Passar messageId para o consumer
        },
        scheduledFor: data.scheduledFor,
      });

      // 6. Retornar imediatamente
      return {
        conversationId,
        messageId: result.messageId,
        jobId: result.jobId,
        status: result.status || 'processing',
        scheduledFor: result.scheduledFor,
        message: result.status === 'scheduled' 
          ? `Mensagem agendada para ${result.scheduledFor?.toISOString()}`
          : 'Mensagem recebida e em processamento',
      };
    } catch (error: any) {
      logError('Error enqueuing message', error);
      throw error;
    }
  }

  /**
   * Constrói o contato de origem baseado nos dados da mensagem
   */
  private async buildSourceContact(data: SendMessageData): Promise<any> {
    const channel = data.channel || 'web';
    const metadata = data.channelMetadata || {};

    switch (channel) {
      case 'web':
        // Buscar nome real do usuário se tiver userId
        let userName = 'Anonymous';
        if (data.userId) {
          try {
            const user = await authService.getUserById(data.userId);
            userName =  `Papo entre Agente e ${user?.name}`;
          } catch (error) {
            userName = `Anonymous`;
          }
        }
        
        return {
          type: 'websocket',
          socketId: metadata.websocketId || metadata.socketId,
          name: userName,
          metadata,
        };
      
      case 'whatsapp':
        return {
          type: 'whatsapp',
          phoneNumber: metadata.phoneNumber,
          whatsappChatId: metadata.whatsappChatId,
          name: metadata.name || metadata.phoneNumber,
          metadata,
        };
      
      case 'telegram':
        return {
          type: 'telegram',
          telegramChatId: metadata.telegramChatId,
          telegramUserId: metadata.telegramUserId,
          telegramUsername: metadata.telegramUsername,
          name: metadata.name || metadata.telegramUsername,
          metadata,
        };
      
      case 'api':
      default:
        return {
          type: 'api',
          apiClientId: metadata.apiClientId || data.userId,
          callbackUrl: metadata.callbackUrl,
          name: metadata.name || 'API Client',
          metadata,
        };
    }
  }

  /**
   * Constrói o contato de destino (agente)
   */
  private buildDestinationContact(agentId: string, agentName: string): any {
    return {
      type: 'system',
      systemId: agentId,
      name: agentName,
      metadata: {
        type: 'agent',
      },
    };
  }

  /**
   * Versão síncrona da sendMessage (para compatibilidade/testes)
   * @deprecated Use sendMessage (assíncrono) sempre que possível
   */
  async sendMessageSync(data: SendMessageData): Promise<any> {
    try {
      // 1. Buscar ou criar conversação
      let conversation;
      if (data.conversationId) {
        conversation = await Conversation.findById(data.conversationId);
        if (!conversation) {
          throw new Error('Conversação não encontrada');
        }
      } else {
        conversation = await Conversation.create({
          agentId: data.agentId,
          userId: data.userId,
          channel: data.channel || 'webchat',
          status: 'active',
        });
      }
      
      // 2. Salvar mensagem do usuário
      const userMessage = await Message.create({
        conversationId: conversation._id.toString(),
        role: 'user',
        content: data.content,
      });
      
      // 3. Buscar configuração do agente
      const agent = await agentService.getAgentById(data.agentId, data.userId || '');
      if (!agent) {
        throw new Error('Agente não encontrado');
      }
      
      // 4. Buscar histórico de mensagens
      const history = await Message.find({
        conversationId: conversation._id.toString()
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
      
      // 5. Buscar plugins ativos
      const plugins = await pluginService.getAgentPlugins(data.agentId);
      
      // 6. Criar registro de execução
      const execution = await Execution.create({
        agentId: data.agentId,
        conversationId: conversation._id.toString(),
        messageId: userMessage._id.toString(),
        status: 'pending',
      });
      
      // 7. Preparar contexto para o n8n
      const context = {
        agentId: data.agentId,
        agentName: agent.name,
        prompt: agent.prompt.finalPrompt,
        userMessage: data.content,
        history: history.reverse().map(m => ({
          role: m.role,
          content: m.content,
        })),
        plugins: plugins.map(p => ({
          id: p.plugin_id,
          name: p.name,
          category: p.category,
        })),
        channel: data.channel || 'webchat',
      };
      
      // 8. Chamar n8n
      execution.status = 'running';
      await execution.save();
      
      const n8nResponse = await n8nService.executeAgent(context);
      
      // 9. Salvar resposta do assistente
      const assistantMessage = await Message.create({
        conversationId: conversation._id.toString(),
        role: 'assistant',
        content: n8nResponse.response,
        metadata: {
          executionId: execution._id.toString(),
          pluginsCalled: n8nResponse.pluginsCalled || [],
        },
      });
      
      // 10. Atualizar execução
      execution.status = 'success';
      execution.completedAt = new Date();
      execution.pluginsCalled = n8nResponse.pluginsCalled || [];
      execution.n8nExecutionId = n8nResponse.executionId;
      await execution.save();
      
      return {
        conversationId: conversation._id.toString(),
        message: {
          id: assistantMessage._id.toString(),
          role: 'assistant',
          content: assistantMessage.content,
          createdAt: assistantMessage.createdAt,
        },
        executionId: execution._id.toString(),
      };
    } catch (error: any) {
      console.error('Erro ao processar mensagem (sync):', error);
      throw error;
    }
  }

  /**
   * Busca status de uma mensagem em processamento
   */
  async getMessageStatus(messageId: string): Promise<any> {
    try {
      const status = await queueService.getMessageStatus(messageId);
      return status;
    } catch (error: any) {
      console.error('Erro ao buscar status da mensagem:', error);
      throw error;
    }
  }
  
  async getConversation(conversationId: string): Promise<any> {
    const conversation = await Conversation.findOne({ conversationId });
    if (!conversation) {
      throw new Error('Conversação não encontrada');
    }
    
    const messages = await Message.find({
      conversationId: conversationId
    })
      .sort({ createdAt: 1 })
      .lean();
    
    return {
      conversation,
      messages,
    };
  }
  
  async getConversationsByAgent(agentId: string, limit = 50): Promise<any[]> {
    return Conversation.find({ agentId })
      .sort({ startedAt: -1 })
      .limit(limit)
      .lean();
  }
}

export const chatService = new ChatService();
