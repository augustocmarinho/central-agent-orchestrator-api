import { query } from '../db/postgres';
import { getRedisClient, REDIS_NAMESPACES } from '../config/redis.config';
import { conversationService } from './conversation.service';
import { agentService } from './agent.service';
import { n8nService } from './n8n.service';
import { logInfo, logError, logWarn } from '../utils/logger';
import {
  FollowUpConfig,
  FollowUpStep,
  FollowUpState,
  FollowUpJob,
} from '../types/followup.types';

const CONFIG_CACHE_TTL = 120; // 2 minutos

/**
 * Service principal do sistema de follow-up automático.
 * Gerencia configuração (PostgreSQL), agendamento (Bull + Redis) e geração de mensagens (n8n).
 */
export class FollowUpService {

  // ─── Configuração CRUD (PostgreSQL) ──────────────────────────────────

  /**
   * Busca configuração de follow-up do agente.
   * Retorna config padrão (desabilitada) se não existe.
   */
  async getConfig(agentId: string): Promise<FollowUpConfig> {
    // Tentar cache primeiro
    const cached = await this.getCachedConfig(agentId);
    if (cached) return cached;

    const configResult = await query(
      `SELECT id, agent_id, enabled FROM agent_follow_up_config WHERE agent_id = $1`,
      [agentId]
    );

    if (configResult.rows.length === 0) {
      return { agentId, enabled: false, steps: [] };
    }

    const config = configResult.rows[0];

    const stepsResult = await query(
      `SELECT id, step_order, delay_minutes, message_type, custom_message
       FROM agent_follow_up_steps
       WHERE config_id = $1
       ORDER BY step_order ASC`,
      [config.id]
    );

    const result: FollowUpConfig = {
      id: config.id,
      agentId: config.agent_id,
      enabled: config.enabled,
      steps: stepsResult.rows.map((row: any) => ({
        id: row.id,
        stepOrder: row.step_order,
        delayMinutes: row.delay_minutes,
        messageType: row.message_type,
        customMessage: row.custom_message || undefined,
      })),
    };

    // Salvar no cache
    await this.setCachedConfig(agentId, result);
    return result;
  }

  /**
   * Salva/atualiza configuração de follow-up do agente.
   * Usa transaction para garantir consistência.
   */
  async saveConfig(
    agentId: string,
    data: { enabled: boolean; steps: FollowUpStep[] }
  ): Promise<FollowUpConfig> {
    const client = (await import('../db/postgres')).pool;
    const conn = await client.connect();

    try {
      await conn.query('BEGIN');

      // UPSERT config
      const configResult = await conn.query(
        `INSERT INTO agent_follow_up_config (agent_id, enabled, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (agent_id)
         DO UPDATE SET enabled = $2, updated_at = NOW()
         RETURNING id`,
        [agentId, data.enabled]
      );
      const configId = configResult.rows[0].id;

      // Deletar steps existentes
      await conn.query(
        `DELETE FROM agent_follow_up_steps WHERE config_id = $1`,
        [configId]
      );

      // Inserir novos steps
      for (const step of data.steps) {
        await conn.query(
          `INSERT INTO agent_follow_up_steps (config_id, step_order, delay_minutes, message_type, custom_message)
           VALUES ($1, $2, $3, $4, $5)`,
          [configId, step.stepOrder, step.delayMinutes, step.messageType, step.customMessage || null]
        );
      }

      await conn.query('COMMIT');

      // Invalidar cache
      await this.invalidateConfigCache(agentId);

      // Se desabilitado, cancelar todas as sequências ativas do agente
      if (!data.enabled) {
        try {
          await this.cancelAllForAgent(agentId);
        } catch (error: any) {
          logError('Error cancelling follow-up sequences after disabling', error);
        }
      }

      logInfo('Follow-up config saved', { agentId, enabled: data.enabled, stepsCount: data.steps.length });

      return this.getConfig(agentId);
    } catch (error: any) {
      await conn.query('ROLLBACK');
      throw error;
    } finally {
      conn.release();
    }
  }

  // ─── Ciclo de vida da sequência (Redis + Bull) ──────────────────────

  /**
   * Agenda sequência de follow-up após uma resposta do assistente.
   * Idempotente: cancela sequência existente antes de agendar nova.
   */
  async scheduleSequence(
    conversationId: string,
    agentId: string,
    channel: string,
    channelMetadata: any
  ): Promise<void> {
    const config = await this.getConfig(agentId);

    if (!config.enabled || config.steps.length === 0) {
      return; // Follow-up não configurado
    }

    // Cancelar sequência existente (idempotente)
    await this.cancelSequence(conversationId);

    const firstStep = config.steps[0];
    const delayMs = firstStep.delayMinutes * 60 * 1000;

    // Importar producer dinamicamente para evitar dependência circular
    const { followUpProducer } = await import('../queues/producers/followup.producer');

    const jobData: FollowUpJob = {
      conversationId,
      agentId,
      stepOrder: firstStep.stepOrder,
      messageType: firstStep.messageType,
      customMessage: firstStep.customMessage,
      channel: channel as any,
      channelMetadata: channelMetadata || {},
      scheduledAt: new Date().toISOString(),
    };

    const jobId = await followUpProducer.scheduleStep(jobData, delayMs);

    // Salvar estado no Redis
    const state: FollowUpState = {
      agentId,
      currentStep: firstStep.stepOrder,
      totalSteps: config.steps.length,
      lastAssistantMessageAt: new Date().toISOString(),
      jobId,
      channel,
      channelMetadata: channelMetadata || {},
    };

    const redis = getRedisClient();
    const stateKey = `${REDIS_NAMESPACES.FOLLOWUP_STATE}${conversationId}`;
    // TTL: soma de todos os delays + 1 hora de margem
    const totalDelayMinutes = config.steps.reduce((sum, s) => sum + s.delayMinutes, 0);
    const ttlSeconds = (totalDelayMinutes * 60) + 3600;

    await redis.setex(stateKey, ttlSeconds, JSON.stringify(state));

    logInfo('Follow-up sequence scheduled', {
      conversationId,
      agentId,
      step: firstStep.stepOrder,
      delayMinutes: firstStep.delayMinutes,
      totalSteps: config.steps.length,
    });
  }

  /**
   * Cancela sequência ativa de follow-up de uma conversa.
   */
  async cancelSequence(conversationId: string): Promise<void> {
    const redis = getRedisClient();
    const stateKey = `${REDIS_NAMESPACES.FOLLOWUP_STATE}${conversationId}`;
    const stateRaw = await redis.get(stateKey);

    if (!stateRaw) return; // Nenhuma sequência ativa

    try {
      const state: FollowUpState = JSON.parse(stateRaw);
      const { followUpProducer } = await import('../queues/producers/followup.producer');
      await followUpProducer.cancelJob(state.jobId);
    } catch (error: any) {
      // Job pode já ter sido processado
      logInfo('Follow-up cancel: job may already be processed', { conversationId });
    }

    await redis.del(stateKey);
    logInfo('Follow-up sequence cancelled', { conversationId });
  }

  /**
   * Avança para o próximo passo da sequência após envio com sucesso.
   */
  async advanceSequence(
    conversationId: string,
    agentId: string,
    completedStep: number,
    channel: string,
    channelMetadata: any
  ): Promise<void> {
    const config = await this.getConfig(agentId);

    // Buscar próximo step
    const nextStep = config.steps.find(s => s.stepOrder > completedStep);

    if (!nextStep) {
      // Último step — limpar estado
      const redis = getRedisClient();
      await redis.del(`${REDIS_NAMESPACES.FOLLOWUP_STATE}${conversationId}`);
      logInfo('Follow-up sequence completed (all steps sent)', { conversationId, agentId });
      return;
    }

    const delayMs = nextStep.delayMinutes * 60 * 1000;
    const { followUpProducer } = await import('../queues/producers/followup.producer');

    const jobData: FollowUpJob = {
      conversationId,
      agentId,
      stepOrder: nextStep.stepOrder,
      messageType: nextStep.messageType,
      customMessage: nextStep.customMessage,
      channel: channel as any,
      channelMetadata: channelMetadata || {},
      scheduledAt: new Date().toISOString(),
    };

    const jobId = await followUpProducer.scheduleStep(jobData, delayMs);

    // Atualizar estado Redis
    const state: FollowUpState = {
      agentId,
      currentStep: nextStep.stepOrder,
      totalSteps: config.steps.length,
      lastAssistantMessageAt: new Date().toISOString(),
      jobId,
      channel,
      channelMetadata: channelMetadata || {},
    };

    const redis = getRedisClient();
    const stateKey = `${REDIS_NAMESPACES.FOLLOWUP_STATE}${conversationId}`;
    const remainingDelayMinutes = config.steps
      .filter(s => s.stepOrder >= nextStep.stepOrder)
      .reduce((sum, s) => sum + s.delayMinutes, 0);
    const ttlSeconds = (remainingDelayMinutes * 60) + 3600;

    await redis.setex(stateKey, ttlSeconds, JSON.stringify(state));

    logInfo('Follow-up sequence advanced', {
      conversationId,
      agentId,
      nextStep: nextStep.stepOrder,
      delayMinutes: nextStep.delayMinutes,
    });
  }

  /**
   * Cancela todas as sequências ativas de um agente.
   * Usado quando follow-up é desabilitado na configuração.
   */
  async cancelAllForAgent(agentId: string): Promise<void> {
    try {
      const { Conversation } = await import('../models/mongodb/Conversation');
      const activeConversations = await Conversation.find(
        { agentId, status: 'active' },
        { conversationId: 1 }
      ).lean();

      let cancelled = 0;
      for (const conv of activeConversations) {
        try {
          await this.cancelSequence(conv.conversationId);
          cancelled++;
        } catch (error: any) {
          // Continuar mesmo com erros individuais
        }
      }

      logInfo('Cancelled all follow-up sequences for agent', { agentId, cancelled, total: activeConversations.length });
    } catch (error: any) {
      logError('Error cancelling all follow-up sequences for agent', error, { agentId });
    }
  }

  // ─── Avaliação + Geração de mensagem por IA ──────────────────────────

  /**
   * Resultado da avaliação pré-envio do follow-up.
   */
  // (tipo inline — shouldSend indica se deve enviar, message é o conteúdo)

  /**
   * Avalia se o follow-up deve ser enviado E gera a mensagem (se ai_generated).
   * Chamado apenas no momento do disparo (lazy evaluation).
   *
   * Para ai_generated: uma única chamada n8n faz avaliação + geração.
   * Para custom: uma chamada leve n8n avalia se a conversa precisa de follow-up.
   *
   * Retorna { shouldSend: true, message } ou { shouldSend: false }.
   */
  async evaluateAndPrepareFollowUp(
    conversationId: string,
    agentId: string,
    stepOrder: number,
    totalSteps: number,
    messageType: 'custom' | 'ai_generated',
    customMessage?: string
  ): Promise<{ shouldSend: boolean; message?: string }> {
    // Salvar histórico Redis ANTES da chamada n8n (para restaurar depois)
    const redis = getRedisClient();
    const historyKey = `${REDIS_NAMESPACES.CHAT_HISTORY}${conversationId}`;
    const historyBackup = await redis.get(historyKey);

    try {
      const agent = await agentService.getAgentByIdForSystem(agentId);
      const agentName = agent?.name || 'Assistente';

      const SKIP_TOKEN = '[FOLLOW_UP_DESNECESSARIO]';

      let syntheticMessage: string;

      if (messageType === 'ai_generated') {
        // Chamada única: avalia + gera
        syntheticMessage = [
          `[SISTEMA - AVALIAÇÃO E GERAÇÃO DE FOLLOW-UP - NÃO EXIBIR AO CLIENTE]`,
          `Você é o agente "${agentName}". O cliente não respondeu à sua última mensagem.`,
          ``,
          `Analise o histórico e decida se um follow-up é apropriado.`,
          `O follow-up NÃO é apropriado SOMENTE quando:`,
          `- O cliente explicitamente confirmou que sua dúvida foi resolvida (disse "obrigado", "era só isso", "ok, entendi")`,
          `- Uma ação concreta foi concluída (consulta agendada, compra finalizada, cadastro feito)`,
          ``,
          `O follow-up É apropriado quando:`,
          `- O cliente fez uma saudação mas não disse o que precisa`,
          `- O assistente fez uma pergunta que ficou sem resposta`,
          `- A conversa terminou com o assistente oferecendo ajuda ("posso ajudar?", "precisa de algo?")`,
          `- Não há evidência clara de que o objetivo foi atingido`,
          `- Na dúvida, SEMPRE envie o follow-up`,
          ``,
          `Se NÃO deve enviar (objetivo claramente atingido):`,
          `→ Responda EXATAMENTE: ${SKIP_TOKEN}`,
          ``,
          `Se DEVE enviar:`,
          `→ Gere uma mensagem de follow-up breve e natural (passo ${stepOrder} de ${totalSteps})`,
          `  Regras:`,
          `  - Máximo 2 frases`,
          `  - Não repita informações já fornecidas`,
          `  - Seja cordial sem ser invasivo`,
          `  - Contextualize com base na última interação`,
          `  - Responda APENAS com a mensagem, nada mais`,
        ].join('\n');
      } else {
        // Avaliação leve: apenas decide se envia ou não
        syntheticMessage = [
          `[SISTEMA - AVALIAÇÃO DE FOLLOW-UP - NÃO EXIBIR AO CLIENTE]`,
          `Você é o agente "${agentName}". O cliente não respondeu à sua última mensagem.`,
          ``,
          `Decida se um follow-up é apropriado.`,
          `NÃO enviar SOMENTE quando:`,
          `- O cliente explicitamente confirmou que sua dúvida foi resolvida`,
          `- Uma ação concreta foi concluída (consulta agendada, compra finalizada)`,
          ``,
          `ENVIAR quando:`,
          `- O cliente fez saudação mas não disse o que precisa`,
          `- O assistente fez pergunta sem resposta`,
          `- Não há evidência clara de objetivo atingido`,
          `- Na dúvida, SEMPRE envie`,
          ``,
          `Se NÃO deve enviar: responda EXATAMENTE: ${SKIP_TOKEN}`,
          `Se DEVE enviar: responda EXATAMENTE: [ENVIAR_FOLLOW_UP]`,
        ].join('\n');
      }

      const n8nResponse = await n8nService.callOpenAIChatWorkflow({
        agent_id: agentId,
        message: syntheticMessage,
        conversation_id: conversationId,
      });

      // CRÍTICO: Restaurar histórico Redis para não poluir a conversa
      // A chamada n8n salva a instrução sintética + resposta no Redis — precisamos reverter
      await this.restoreRedisHistory(historyKey, historyBackup);

      const responseText =
        (n8nResponse && typeof n8nResponse.message === 'string' && n8nResponse.message) ||
        (n8nResponse && typeof n8nResponse.response === 'string' && n8nResponse.response) ||
        (n8nResponse && typeof n8nResponse === 'string' && n8nResponse);

      if (!responseText || typeof responseText !== 'string') {
        logWarn('Invalid n8n response for follow-up evaluation, sending anyway', { conversationId });
        return {
          shouldSend: true,
          message: messageType === 'custom' ? customMessage : undefined,
        };
      }

      // Verificar se a IA decidiu que não deve enviar
      if (responseText.includes(SKIP_TOKEN)) {
        logInfo('Follow-up skipped by AI evaluation (conversation resolved)', {
          conversationId,
          agentId,
          step: stepOrder,
          messageType,
        });
        return { shouldSend: false };
      }

      if (messageType === 'ai_generated') {
        const cleanMessage = responseText
          .replace('[ENVIAR_FOLLOW_UP]', '')
          .trim();
        return { shouldSend: true, message: cleanMessage };
      } else {
        return { shouldSend: true, message: customMessage };
      }
    } catch (error: any) {
      // Restaurar histórico mesmo em caso de erro
      await this.restoreRedisHistory(historyKey, historyBackup);

      logError('Error in follow-up evaluation', error, { conversationId, agentId, stepOrder });
      if (messageType === 'custom') {
        return { shouldSend: true, message: customMessage };
      }
      return {
        shouldSend: true,
        message: 'Olá! Notei que ainda não respondeu. Posso ajudar com mais alguma coisa?',
      };
    }
  }

  /**
   * Restaura o histórico Redis da conversa ao estado anterior à chamada de avaliação.
   * Impede que a instrução sintética e a resposta da IA poluam o contexto da conversa.
   */
  private async restoreRedisHistory(historyKey: string, backup: string | null): Promise<void> {
    try {
      const redis = getRedisClient();
      if (backup) {
        await redis.setex(historyKey, 604800, backup); // 7 dias TTL (mesmo do n8n)
      } else {
        await redis.del(historyKey);
      }
      logInfo('Redis history restored after follow-up evaluation', { historyKey });
    } catch (error: any) {
      logError('Error restoring Redis history after follow-up evaluation', error);
    }
  }

  // ─── Cache helpers ──────────────────────────────────────────────────

  private async getCachedConfig(agentId: string): Promise<FollowUpConfig | null> {
    try {
      const redis = getRedisClient();
      const data = await redis.get(`${REDIS_NAMESPACES.FOLLOWUP_CONFIG_CACHE}${agentId}`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  private async setCachedConfig(agentId: string, config: FollowUpConfig): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.setex(
        `${REDIS_NAMESPACES.FOLLOWUP_CONFIG_CACHE}${agentId}`,
        CONFIG_CACHE_TTL,
        JSON.stringify(config)
      );
    } catch (error: any) {
      logError('Error caching follow-up config', error);
    }
  }

  private async invalidateConfigCache(agentId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(`${REDIS_NAMESPACES.FOLLOWUP_CONFIG_CACHE}${agentId}`);
    } catch (error: any) {
      logError('Error invalidating follow-up config cache', error);
    }
  }
}

export const followUpService = new FollowUpService();
