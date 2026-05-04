import { getRedisClient, REDIS_NAMESPACES } from '../config/redis.config';
import { chatHistoryConfig } from '../config/chat.config';
import { n8nService } from './n8n.service';
import { logInfo, logError, logWarn } from '../utils/logger';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatHistoryMessage {
  role: ChatRole;
  content: string;
  ts: string;
}

export interface ChatHistory {
  summary: string | null;
  messages: ChatHistoryMessage[];
}

interface LegacyMessage {
  role?: string;
  content?: string;
  timestamp?: string;
  [key: string]: any;
}

/**
 * Service que centraliza leitura/escrita do histórico de chat no Redis.
 * Implementa estratégia summary buffer: janela recente verbatim + resumo das mensagens antigas.
 *
 * Antes desta refatoração, o workflow n8n gravava direto no Redis com campos extras
 * (timestamp, tokens, finish_reason). Agora o backend é o dono dessa chave;
 * o n8n apenas lê via payload do webhook.
 */
class ChatHistoryService {
  private key(conversationId: string): string {
    return `${REDIS_NAMESPACES.CHAT_HISTORY}${conversationId}`;
  }

  /**
   * Lê o histórico do Redis. Retorna estrutura vazia se não existir.
   * Faz fallback para o formato antigo (array puro de mensagens) durante a transição.
   */
  async getHistory(conversationId: string): Promise<ChatHistory> {
    const redis = getRedisClient();
    try {
      const raw = await redis.get(this.key(conversationId));
      if (!raw) return { summary: null, messages: [] };

      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return {
          summary: null,
          messages: parsed.map(this.normalizeLegacyMessage).filter(Boolean) as ChatHistoryMessage[],
        };
      }

      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.messages)) {
        return {
          summary: typeof parsed.summary === 'string' ? parsed.summary : null,
          messages: parsed.messages
            .map(this.normalizeLegacyMessage)
            .filter(Boolean) as ChatHistoryMessage[],
        };
      }

      return { summary: null, messages: [] };
    } catch (error) {
      logError('Error reading chat history', error as Error, { conversationId });
      return { summary: null, messages: [] };
    }
  }

  /**
   * Monta o que será enviado ao n8n: resumo + janela recente.
   * A mensagem atual do usuário NÃO é incluída — n8n adiciona como turno corrente.
   */
  async buildN8nPayload(conversationId: string): Promise<{
    summary: string | null;
    recentMessages: ChatHistoryMessage[];
  }> {
    const history = await this.getHistory(conversationId);
    return {
      summary: history.summary,
      recentMessages: history.messages.slice(-chatHistoryConfig.recentWindow),
    };
  }

  /**
   * Adiciona mensagens ao histórico. Dispara sumarização se ultrapassar o trigger.
   */
  async appendMessages(
    conversationId: string,
    agentId: string | null,
    msgs: Array<{ role: ChatRole; content: string }>
  ): Promise<void> {
    if (!msgs.length) return;

    const history = await this.getHistory(conversationId);
    const ts = new Date().toISOString();

    for (const m of msgs) {
      history.messages.push({ role: m.role, content: m.content, ts });
    }

    let mutated = history;
    if (mutated.messages.length > chatHistoryConfig.summaryTrigger) {
      mutated = await this.compactIfNeeded(mutated, agentId, conversationId);
    }

    // Hard cap defensivo (caso a sumarização falhe persistentemente)
    if (mutated.messages.length > chatHistoryConfig.hardCap) {
      const overflow = mutated.messages.length - chatHistoryConfig.hardCap;
      logWarn('Chat history exceeded hardCap, truncating oldest', {
        conversationId,
        overflow,
        hardCap: chatHistoryConfig.hardCap,
      });
      mutated = { ...mutated, messages: mutated.messages.slice(overflow) };
    }

    await this.save(conversationId, mutated);
  }

  /**
   * Atalho para gravar uma nota interna do sistema (ex.: marcação de follow-up enviado).
   * Usa role='system' para que a IA veja como contexto, não como mensagem do usuário.
   */
  async appendSystemNote(conversationId: string, content: string): Promise<void> {
    await this.appendMessages(conversationId, null, [{ role: 'system', content }]);
  }

  // ─── Internos ──────────────────────────────────────────────────────

  private normalizeLegacyMessage(m: LegacyMessage): ChatHistoryMessage | null {
    if (!m || typeof m !== 'object') return null;
    if (typeof m.role !== 'string' || typeof m.content !== 'string') return null;
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') return null;
    return {
      role: m.role,
      content: m.content,
      ts: typeof m.ts === 'string' ? m.ts : (typeof m.timestamp === 'string' ? m.timestamp : new Date().toISOString()),
    };
  }

  private async compactIfNeeded(
    history: ChatHistory,
    agentId: string | null,
    conversationId: string
  ): Promise<ChatHistory> {
    const { recentWindow } = chatHistoryConfig;
    const oldestCount = history.messages.length - recentWindow;
    if (oldestCount <= 0) return history;

    const oldest = history.messages.slice(0, oldestCount);
    const recent = history.messages.slice(oldestCount);

    try {
      const { summary } = await n8nService.callSummarizationWorkflow({
        agent_id: agentId || 'unknown',
        conversation_id: conversationId,
        messages: oldest.map((m) => ({ role: m.role, content: m.content })),
        previous_summary: history.summary,
      });

      if (!summary) {
        logWarn('Summarization returned empty, keeping history as-is', { conversationId });
        return history;
      }

      logInfo('Chat history summarized', {
        conversationId,
        compactedMessages: oldest.length,
        newSummaryLength: summary.length,
      });

      return { summary, messages: recent };
    } catch (error) {
      logError('Summarization failed, keeping history', error as Error, { conversationId });
      return history;
    }
  }

  private async save(conversationId: string, history: ChatHistory): Promise<void> {
    const redis = getRedisClient();
    try {
      await redis.setex(
        this.key(conversationId),
        chatHistoryConfig.ttlSeconds,
        JSON.stringify(history)
      );
    } catch (error) {
      logError('Error saving chat history', error as Error, { conversationId });
      throw error;
    }
  }
}

export const chatHistoryService = new ChatHistoryService();
