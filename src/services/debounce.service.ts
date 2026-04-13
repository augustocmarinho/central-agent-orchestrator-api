import { getRedisClient, REDIS_NAMESPACES } from '../config/redis.config';
import { config } from '../config';
import { debounceProducer } from '../queues/producers/debounce.producer';
import { queueService } from './queue.service';
import { logInfo, logError, logWarn } from '../utils/logger';

export interface BufferMessageData {
  messageId: string;
  conversationId: string;
  agentId: string;
  userId?: string;
  content: string;
  channel: string;
  channelMetadata: any;
}

export interface BufferResult {
  /** true = mensagem adicionada ao buffer, aguardando mais mensagens */
  buffered: boolean;
  /** true = hard cap atingido, flush imediato disparado */
  flushedImmediately: boolean;
  messageCount: number;
}

/**
 * Serviço de debounce de mensagens
 *
 * Agrupa mensagens sequenciais do mesmo remetente em uma única interação
 * antes de enviar à IA. Usa Redis Hash como buffer e Bull delayed jobs
 * como timer de flush.
 *
 * Configuração global via variáveis de ambiente:
 *   DEBOUNCE_MS (default 0 = desabilitado)
 *   DEBOUNCE_MAX_MS (default 30000)
 *   DEBOUNCE_MAX_MESSAGES (default 10)
 */
export class DebounceService {

  /**
   * Verifica se o debounce está habilitado globalmente.
   */
  isEnabled(): boolean {
    return config.debounce.ms > 0;
  }

  /**
   * Adiciona uma mensagem ao buffer de debounce.
   *
   * - Se é a primeira mensagem: cria o buffer e agenda o flush.
   * - Se já existe buffer: append e reagenda (sliding window).
   * - Se atingiu hard cap (mensagens ou tempo): flush imediato.
   */
  async bufferMessage(data: BufferMessageData): Promise<BufferResult> {
    const redis = getRedisClient();
    const key = `${REDIS_NAMESPACES.DEBOUNCE_BUFFER}${data.conversationId}`;
    const now = new Date().toISOString();
    const { ms: debounceMs, maxMs, maxMessages } = config.debounce;

    // Verificar se já existe buffer para esta conversa
    const existing = await redis.hgetall(key);
    const isFirstMessage = !existing || Object.keys(existing).length === 0;

    if (isFirstMessage) {
      // Primeira mensagem — criar buffer
      await redis.hmset(key, {
        messages: JSON.stringify([data.content]),
        messageIds: JSON.stringify([data.messageId]),
        agentId: data.agentId,
        userId: data.userId || '',
        channel: data.channel,
        channelMetadata: JSON.stringify(data.channelMetadata || {}),
        firstMessageAt: now,
        lastMessageAt: now,
        messageCount: '1',
      });

      // TTL de segurança: maxMs + 60s de margem
      const safetyTtl = Math.ceil(maxMs / 1000) + 60;
      await redis.expire(key, safetyTtl);

      // Agendar flush
      await debounceProducer.scheduleFlush(data.conversationId, data.agentId, debounceMs);

      logInfo('📦 Debounce buffer created', {
        conversationId: data.conversationId,
        agentId: data.agentId,
        debounceMs,
      });

      return { buffered: true, flushedImmediately: false, messageCount: 1 };
    }

    // Mensagem subsequente — append ao buffer existente
    const messages: string[] = JSON.parse(existing.messages);
    const messageIds: string[] = JSON.parse(existing.messageIds);
    messages.push(data.content);
    messageIds.push(data.messageId);
    const messageCount = messages.length;

    await redis.hmset(key, {
      messages: JSON.stringify(messages),
      messageIds: JSON.stringify(messageIds),
      lastMessageAt: now,
      messageCount: String(messageCount),
    });

    logInfo('📦 Debounce buffer appended', {
      conversationId: data.conversationId,
      messageCount,
    });

    // Verificar hard caps
    const firstMessageAt = new Date(existing.firstMessageAt).getTime();
    const elapsed = Date.now() - firstMessageAt;
    const hitTimeCap = elapsed >= maxMs;
    const hitMessageCap = messageCount >= maxMessages;

    if (hitTimeCap || hitMessageCap) {
      // Hard cap atingido — flush imediato
      logInfo('⚡ Debounce hard cap reached, flushing immediately', {
        conversationId: data.conversationId,
        messageCount,
        elapsed,
        reason: hitTimeCap ? 'time_cap' : 'message_cap',
      });

      await debounceProducer.cancelFlush(data.conversationId);
      await this.flushBuffer(data.conversationId);
      return { buffered: false, flushedImmediately: true, messageCount };
    }

    // Reagendar flush (sliding window)
    await debounceProducer.rescheduleFlush(data.conversationId, data.agentId, debounceMs);

    return { buffered: true, flushedImmediately: false, messageCount };
  }

  /**
   * Faz flush do buffer: lê e deleta atomicamente, concatena mensagens e enfileira.
   * Usa Lua script para garantir atomicidade entre HGETALL e DEL.
   */
  async flushBuffer(conversationId: string): Promise<void> {
    const redis = getRedisClient();
    const key = `${REDIS_NAMESPACES.DEBOUNCE_BUFFER}${conversationId}`;

    // Lua script: lê todos os campos e deleta a key atomicamente
    const luaScript = `
      local data = redis.call('HGETALL', KEYS[1])
      if #data == 0 then return nil end
      redis.call('DEL', KEYS[1])
      return data
    `;

    const result = await redis.eval(luaScript, 1, key) as string[] | null;

    if (!result || result.length === 0) {
      logInfo('Debounce flush skipped (buffer empty or already flushed)', { conversationId });
      return;
    }

    // Converter array [key1, val1, key2, val2, ...] para objeto
    const buffer: Record<string, string> = {};
    for (let i = 0; i < result.length; i += 2) {
      buffer[result[i]] = result[i + 1];
    }

    const messages: string[] = JSON.parse(buffer.messages);
    const messageIds: string[] = JSON.parse(buffer.messageIds);
    const channelMetadata = JSON.parse(buffer.channelMetadata);

    if (messages.length === 0) {
      logWarn('Debounce flush: buffer had no messages', { conversationId });
      return;
    }

    // Concatenar mensagens com quebra de linha
    const combinedMessage = messages.join('\n');

    logInfo('🔄 Debounce flushing buffer', {
      conversationId,
      agentId: buffer.agentId,
      messageCount: messages.length,
      combinedLength: combinedMessage.length,
    });

    // Enfileirar mensagem combinada na fila principal (ai-messages)
    await queueService.enqueueMessage({
      conversationId,
      agentId: buffer.agentId,
      userId: buffer.userId || undefined,
      message: combinedMessage,
      channel: buffer.channel as any,
      channelMetadata: {
        ...channelMetadata,
        userMessageId: messageIds[messageIds.length - 1], // última mensagem como "trigger"
        debouncedMessageIds: messageIds,
        debounced: true,
        originalMessageCount: messages.length,
      },
    });

    logInfo('✅ Debounce flush complete', {
      conversationId,
      messageCount: messages.length,
    });
  }
}

// Singleton
export const debounceService = new DebounceService();
