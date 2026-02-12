import { query } from '../db/postgres';
import { v4 as uuidv4 } from 'uuid';
import { n8nService } from './n8n.service';
import { logInfo, logError, logWarn } from '../utils/logger';

export interface CreateAgentData {
  userId: string;
  name: string;
  creationMode: 'simple' | 'advanced';
  aiModel?: string; // Modelo de IA para o chat (ex: gpt-4o-mini). Padrão: gpt-4o-mini
  aiProvider?: string; // Provedor do modelo de IA (ex: openai, cursor). Padrão: openai
  objective?: string;
  persona?: string;
  audience?: string;
  topics?: string;
  restrictions?: string;
  knowledgeSource?: string;
  finalPrompt?: string;
  useAI?: boolean; // Novo: usar IA para gerar configuração
}

export interface UpdateAgentData {
  name?: string;
  status?: 'active' | 'paused' | 'draft';
  creationMode?: 'simple' | 'advanced';
  objective?: string;
  persona?: string;
  audience?: string;
  topics?: string;
  restrictions?: string;
  knowledgeSource?: string;
  finalPrompt?: string;
}

export interface Agent {
  id: string;
  userId: string;
  name: string;
  status: string;
  aiModel: string;
  aiProvider: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentWithPrompt extends Agent {
  prompt: {
    objective?: string;
    persona?: string;
    audience?: string;
    topics?: string;
    restrictions?: string;
    knowledgeSource?: string;
    finalPrompt: string;
    creationMode: string;
  };
}

export class AgentService {
  private generatePromptFromData(data: CreateAgentData | UpdateAgentData): string {
    // Se o prompt final já foi fornecido (modo avançado), usa ele
    if (data.finalPrompt) {
      return data.finalPrompt;
    }
    
    // Gera prompt a partir dos dados estruturados (modo simplificado)
    const name = (data as CreateAgentData).name || '[Nome do Agente]';
    const objective = data.objective || '[Descreva o objetivo]';
    const persona = data.persona || 'profissional';
    const audience = data.audience || '[Defina o público]';
    const topics = data.topics || '[Liste os tópicos]';
    const restrictions = data.restrictions || '- Não fornecer informações incorretas\n- Não realizar ações fora do escopo definido';
    const knowledgeSource = data.knowledgeSource;
    
    return `Você é ${name}, um assistente virtual com personalidade ${persona}.

## Objetivo Principal
${objective}

## Público-Alvo
${audience}

## Tópicos que Deve Cobrir
${topics}

## Restrições e Limites
${restrictions}

## Base de Conhecimento
${knowledgeSource ? 'Utilize as informações fornecidas na base de conhecimento para responder.' : 'Utilize seu conhecimento geral para auxiliar o usuário.'}

## Instruções Gerais
- Seja sempre educado e prestativo
- Quando não souber uma resposta, ofereça alternativas ou transfira para um atendente humano
- Mantenha as respostas concisas e relevantes`;
  }
  
  async createAgent(data: CreateAgentData): Promise<AgentWithPrompt> {
    const client = await query('BEGIN');
    
    try {
      const agentId = uuidv4();
      
      // Se data.creationMode === 'simple', usar n8n + OpenAI para gerar prompt
      let finalPrompt: string;
      
      if (data.creationMode === 'simple') {
        logInfo('Using AI to generate agent prompt', { userId: data.userId, agentName: data.name });
        
        try {
          // Chamar n8n para gerar apenas o finalPrompt via OpenAI
          const aiResponse = await n8nService.generatePrompt({
            name: data.name,
            objective: data.objective,
            persona: data.persona,
            audience: data.audience,
            topics: data.topics,
            restrictions: data.restrictions,
          });
          
          if (aiResponse.success && aiResponse.finalPrompt) {
            finalPrompt = aiResponse.finalPrompt;
            logInfo('AI prompt generated successfully', { agentId });
          } else {
            // Fallback para geração local
            logWarn('AI not available, using local generation', { agentId });
            finalPrompt = this.generatePromptFromData(data);
          }
        } catch (error) {
          logError('Error using AI, falling back to local generation', error, { agentId });
          finalPrompt = this.generatePromptFromData(data);
        }
      } else {
        // Gerar prompt normalmente (sem IA)
        finalPrompt = this.generatePromptFromData(data);
      }
      
      const aiModel = data.aiModel ?? 'gpt-4o-mini';
      const aiProvider = data.aiProvider ?? 'openai';

      // Criar agente (sempre nasce ativo)
      const agentResult = await query(
        `INSERT INTO agents (id, user_id, name, status, ai_model, ai_provider) 
         VALUES ($1, $2, $3, 'active', $4, $5) 
         RETURNING *`,
        [agentId, data.userId, data.name, aiModel, aiProvider]
      );
      
      const agent = agentResult.rows[0];
      
      // Criar prompt
      const promptResult = await query(
        `INSERT INTO agent_prompts 
         (agent_id, objective, persona, audience, topics, restrictions, knowledge_source, final_prompt, creation_mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          agentId,
          data.objective || null,
          data.persona || null,
          data.audience || null,
          data.topics || null,
          data.restrictions || null,
          data.knowledgeSource || null,
          finalPrompt,
          data.creationMode
        ]
      );
      
      await query('COMMIT');
      
      return {
        ...agent,
        prompt: promptResult.rows[0],
      };
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  }
  
  async getAgentsByUserId(userId: string): Promise<Agent[]> {
    const result = await query(
      'SELECT * FROM agents WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC',
      [userId]
    );
    
    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      status: row.status,
      aiModel: row.ai_model ?? 'gpt-4o-mini',
      aiProvider: row.ai_provider ?? 'openai',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
  
  async getAgentById(agentId: string, userId: string): Promise<AgentWithPrompt | null> {
    const result = await query(
      `SELECT a.*, ap.objective, ap.persona, ap.audience, ap.topics, 
              ap.restrictions, ap.knowledge_source, ap.final_prompt, ap.creation_mode
       FROM agents a
       LEFT JOIN agent_prompts ap ON a.id = ap.agent_id
       WHERE a.id = $1 AND a.user_id = $2 AND a.deleted_at IS NULL`,
      [agentId, userId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row = result.rows[0];
    
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      status: row.status,
      aiModel: row.ai_model ?? 'gpt-4o-mini',
      aiProvider: row.ai_provider ?? 'openai',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      prompt: {
        objective: row.objective,
        persona: row.persona,
        audience: row.audience,
        topics: row.topics,
        restrictions: row.restrictions,
        knowledgeSource: row.knowledge_source,
        finalPrompt: row.final_prompt,
        creationMode: row.creation_mode,
      },
    };
  }
  
  /**
   * Busca um agente pelo ID sem validar userId
   * Usado por sistemas externos (N8N) com System Token
   */
  async getAgentByIdForSystem(agentId: string): Promise<AgentWithPrompt | null> {
    const result = await query(
      `SELECT a.*, ap.objective, ap.persona, ap.audience, ap.topics, 
              ap.restrictions, ap.knowledge_source, ap.final_prompt, ap.creation_mode
       FROM agents a
       LEFT JOIN agent_prompts ap ON a.id = ap.agent_id
       WHERE a.id = $1 AND a.deleted_at IS NULL`,
      [agentId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row = result.rows[0];
    
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      status: row.status,
      aiModel: row.ai_model ?? 'gpt-4o-mini',
      aiProvider: row.ai_provider ?? 'openai',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      prompt: {
        objective: row.objective,
        persona: row.persona,
        audience: row.audience,
        topics: row.topics,
        restrictions: row.restrictions,
        knowledgeSource: row.knowledge_source,
        finalPrompt: row.final_prompt,
        creationMode: row.creation_mode,
      },
    };
  }
  
  async updateAgent(agentId: string, userId: string, data: UpdateAgentData): Promise<AgentWithPrompt | null> {
    const client = await query('BEGIN');
    
    try {
      // Atualizar dados básicos do agente
      if (data.name || data.status) {
        const updates: string[] = [];
        const values: any[] = [];
        let paramCount = 1;
        
        if (data.name) {
          updates.push(`name = $${paramCount++}`);
          values.push(data.name);
        }
        
        if (data.status) {
          updates.push(`status = $${paramCount++}`);
          values.push(data.status);
        }
        
        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(agentId, userId);
        
        await query(
          `UPDATE agents SET ${updates.join(', ')} 
           WHERE id = $${paramCount++} AND user_id = $${paramCount++} AND deleted_at IS NULL`,
          values
        );
      }
      
      // Atualizar prompt se houver mudanças
      const hasPromptChanges = data.objective || data.persona || data.audience || 
                               data.topics || data.restrictions || data.knowledgeSource || 
                               data.finalPrompt || data.creationMode;
      
      if (hasPromptChanges) {
        // Buscar dados atuais do prompt
        const currentPromptResult = await query(
          'SELECT * FROM agent_prompts WHERE agent_id = $1',
          [agentId]
        );
        
        const currentPrompt = currentPromptResult.rows[0] || {};
        
        const mergedData = {
          ...currentPrompt,
          ...data,
        };
        
        const finalPrompt = this.generatePromptFromData(mergedData);
        
        await query(
          `UPDATE agent_prompts 
           SET objective = $1, persona = $2, audience = $3, topics = $4,
               restrictions = $5, knowledge_source = $6, final_prompt = $7,
               creation_mode = $8, updated_at = CURRENT_TIMESTAMP
           WHERE agent_id = $9`,
          [
            data.objective ?? currentPrompt.objective,
            data.persona ?? currentPrompt.persona,
            data.audience ?? currentPrompt.audience,
            data.topics ?? currentPrompt.topics,
            data.restrictions ?? currentPrompt.restrictions,
            data.knowledgeSource ?? currentPrompt.knowledge_source,
            finalPrompt,
            data.creationMode ?? currentPrompt.creation_mode,
            agentId
          ]
        );
      }
      
      await query('COMMIT');
      
      return this.getAgentById(agentId, userId);
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  }
  
  async deleteAgent(agentId: string, userId: string): Promise<boolean> {
    const result = await query(
      'UPDATE agents SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [agentId, userId]
    );
    
    return (result.rowCount ?? 0) > 0;
  }
}

export const agentService = new AgentService();
