import { Conversation } from '../models/mongodb/Conversation';
import { Message } from '../models/mongodb/Message';
import { Execution } from '../models/mongodb/Execution';
import { agentService } from './agent.service';
import { pluginService } from './plugin.service';
import { n8nService } from './n8n.service';
import { queueService } from './queue.service';
import { v4 as uuidv4 } from 'uuid';
import { logInfo } from '../utils/logger';

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
   * IMPORTANTE: Não usa MongoDB! O histórico fica 100% no Redis (gerenciado pelo N8N)
   */
  async sendMessage(data: SendMessageData): Promise<any> {
    try {
      // 1. Validar que agente existe (apenas validação, não precisa buscar dados)
      const agent = await agentService.getAgentById(data.agentId, data.userId || '');
      if (!agent) {
        throw new Error('Agente não encontrado');
      }

      // 2. Gerar conversationId se não foi fornecido
      // O conversationId é apenas um UUID, não precisa estar no MongoDB
      const conversationId = data.conversationId || uuidv4();

      // 3. Enfileirar mensagem para processamento assíncrono (ou agendar)
      const result = await queueService.enqueueMessage({
        conversationId,
        agentId: data.agentId,
        userId: data.userId || '',
        message: data.content,
        channel: (data.channel as any) || 'web',
        channelMetadata: data.channelMetadata || {},
        scheduledFor: data.scheduledFor,
      });

      // 4. Retornar imediatamente (202 Accepted)
      return {
        conversationId,
        messageId: result.messageId,
        jobId: result.jobId,
        status: 'processing',
        message: 'Mensagem recebida e em processamento',
      };
    } catch (error: any) {
      console.error('Erro ao enfileirar mensagem:', error);
      throw error;
    }
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
    const conversation = await Conversation.findById(conversationId);
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
