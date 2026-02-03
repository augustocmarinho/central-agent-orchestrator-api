import axios from 'axios';
import { config } from '../config';

export interface N8nAgentContext {
  agentId: string;
  agentName: string;
  prompt: string;
  userMessage: string;
  history: Array<{ role: string; content: string }>;
  plugins: Array<{ id: string; name: string; category: string }>;
  channel: string;
}

export interface N8nResponse {
  response: string;
  pluginsCalled?: string[];
  executionId?: string;
}

export interface GeneratePromptData {
  name: string;
  objective?: string;
  persona?: string;
  audience?: string;
  topics?: string;
  restrictions?: string;
}

export interface GeneratePromptResponse {
  success: boolean;
  finalPrompt?: string;
  error?: string;
}

export class N8nService {
  private baseUrl: string;
  private apiKey: string;
  
  constructor() {
    this.baseUrl = config.n8n.baseUrl;
    this.apiKey = config.n8n.apiKey;
  }
  
  async executeAgent(context: N8nAgentContext): Promise<N8nResponse> {
    try {
      // Se n8n não estiver configurado, retorna resposta simulada
      if (!this.apiKey || this.apiKey === 'your-n8n-api-key') {
        console.warn('⚠️  n8n não configurado, retornando resposta simulada');
        return this.simulateResponse(context);
      }
      
      // Chamar webhook do n8n
      const response = await axios.post(
        `${this.baseUrl}/webhook/agent-chat`,
        {
          agentId: context.agentId,
          agentName: context.agentName,
          systemPrompt: context.prompt,
          message: context.userMessage,
          history: context.history,
          availablePlugins: context.plugins,
          channel: context.channel,
        },
        {
          headers: {
            'X-N8N-API-KEY': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 segundos
        }
      );
      
      return {
        response: response.data.response,
        pluginsCalled: response.data.pluginsCalled || [],
        executionId: response.data.executionId,
      };
    } catch (error: any) {
      console.error('Erro ao chamar n8n:', error.message);
      
      // Fallback para resposta simulada em caso de erro
      return this.simulateResponse(context);
    }
  }
  
  private simulateResponse(context: N8nAgentContext): N8nResponse {
    // Resposta simulada para demonstração
    const responses = [
      `Olá! Sou ${context.agentName}. Recebi sua mensagem: "${context.userMessage}". Como posso ajudar?`,
      `Entendi sua pergunta. Estou processando com base no meu treinamento. Em produção, eu usaria a IA configurada no n8n.`,
      `Sua mensagem foi recebida. No ambiente de produção, eu teria acesso aos plugins: ${context.plugins.map(p => p.name).join(', ')}.`,
    ];
    
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    
    return {
      response: randomResponse,
      pluginsCalled: [],
      executionId: 'simulated-' + Date.now(),
    };
  }
  
  async createWorkflow(workflowData: any): Promise<any> {
    if (!this.apiKey || this.apiKey === 'your-n8n-api-key') {
      console.warn('⚠️  n8n não configurado, workflow não criado');
      return { id: 'simulated-workflow' };
    }
    
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/workflows`,
        workflowData,
        {
          headers: {
            'X-N8N-API-KEY': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );
      
      return response.data;
    } catch (error: any) {
      console.error('Erro ao criar workflow no n8n:', error.message);
      throw error;
    }
  }
  
  async getExecution(executionId: string): Promise<any> {
    if (!this.apiKey || this.apiKey === 'your-n8n-api-key') {
      return { id: executionId, status: 'success' };
    }
    
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/executions/${executionId}`,
        {
          headers: {
            'X-N8N-API-KEY': this.apiKey,
          },
        }
      );
      
      return response.data;
    } catch (error: any) {
      console.error('Erro ao buscar execução no n8n:', error.message);
      throw error;
    }
  }
  
  async generatePrompt(data: GeneratePromptData): Promise<GeneratePromptResponse> {
    try {
      console.log('🤖 Chamando n8n para gerar prompt com OpenAI...');
      
      // Chamar webhook do n8n para geração de prompt
      const response = await axios.post(
        `${this.baseUrl}/webhook/generate-prompt`,
        {
          name: data.name,
          objective: data.objective,
          persona: data.persona,
          audience: data.audience,
          topics: data.topics,
          restrictions: data.restrictions,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 60000, // 60 segundos (OpenAI pode demorar)
        }
      );
      
      console.log('✅ Prompt gerado com sucesso');
      
      return {
        success: response.data.success || true,
        finalPrompt: response.data.finalPrompt,
      };
    } catch (error: any) {
      console.error('❌ Erro ao gerar prompt:', error.message);
      
      // Retornar erro estruturado
      return {
        success: false,
        error: error.message || 'Erro ao comunicar com n8n',
      };
    }
  }

  /**
   * Chama o workflow "OpenAI Chat with Redis" específico
   * Usado pelo sistema de filas
   */
  async callOpenAIChatWorkflow(data: {
    agent_id: string;
    message: string;
    conversation_id: string;
  }): Promise<any> {
    try {
      console.log('🤖 Chamando N8N workflow: OpenAI Chat with Redis');
      
      const response = await axios.post(
        `${this.baseUrl}/webhook/openai-chat`,
        data,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 90000, // 90 segundos (OpenAI pode demorar)
        }
      );
      
      console.log('✅ N8N workflow concluído');
      
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao chamar N8N workflow:', error.message);
      throw error;
    }
  }
}

export const n8nService = new N8nService();
