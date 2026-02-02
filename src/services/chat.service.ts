import { Conversation } from '../models/mongodb/Conversation';
import { Message } from '../models/mongodb/Message';
import { Execution } from '../models/mongodb/Execution';
import { agentService } from './agent.service';
import { pluginService } from './plugin.service';
import { n8nService } from './n8n.service';

export interface SendMessageData {
  agentId: string;
  userId?: string;
  content: string;
  conversationId?: string;
  channel?: string;
}

export class ChatService {
  async sendMessage(data: SendMessageData): Promise<any> {
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
      console.error('Erro ao processar mensagem:', error);
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
