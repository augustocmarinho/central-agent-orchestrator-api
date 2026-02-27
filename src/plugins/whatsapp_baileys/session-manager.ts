import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { logInfo, logWarn, logError, logDebug } from '../../utils/logger';
import { WhatsAppSession, ConnectionStatus } from './types';
import {
  extractNormalizedPhoneFromJid,
  normalizePhoneNumber,
  isLidJid,
  isPnJid,
  extractJidUser,
} from '../../utils/whatsapp-jid';

/** Delay inicial para reconexão (ms). */
const INITIAL_RECONNECT_DELAY_MS = 3000;
/** Delay máximo para reconexão (5 min). */
const MAX_RECONNECT_DELAY_MS = 300_000;
/** Número máximo de tentativas de reconexão antes de desistir. */
const MAX_RECONNECT_ATTEMPTS = 10;
/** TTL do cache da versão do WhatsApp (24h). */
const VERSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Cache da versão do Baileys para evitar fetch em todo reconnect. */
let versionCache: { version: [number, number, number]; at: number } | null = null;

/** Mapeia statusCode para nome legível do DisconnectReason. */
function disconnectReasonName(statusCode: number | undefined): string {
  if (statusCode === undefined) return 'unknown';
  const names: Record<number, string> = {
    [DisconnectReason.connectionClosed]: 'connectionClosed',
    [DisconnectReason.connectionLost]: 'connectionLost',
    [DisconnectReason.loggedOut]: 'loggedOut',
    [DisconnectReason.badSession]: 'badSession',
    [DisconnectReason.restartRequired]: 'restartRequired',
    [DisconnectReason.connectionReplaced]: 'connectionReplaced',
    [DisconnectReason.multideviceMismatch]: 'multideviceMismatch',
    [DisconnectReason.forbidden]: 'forbidden',
    [DisconnectReason.unavailableService]: 'unavailableService',
  };
  return names[statusCode] ?? `unknown(${statusCode})`;
}

/** Remove todos os listeners que registramos no socket (evita vazamento e duplo handler). */
function removeSocketListeners(socket: WASocket): void {
  socket.ev.removeAllListeners('connection.update');
  socket.ev.removeAllListeners('creds.update');
  socket.ev.removeAllListeners('messages.upsert');
}

/**
 * Cria um logger compatível com Baileys (ILogger/pino-like) que encaminha
 * para o winston do app com contexto agentId/sessionId.
 */
function createBaileysLogger(agentId: string, sessionId: string): {
  level: string;
  child(obj: Record<string, unknown>): ReturnType<typeof createBaileysLogger>;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
} {
  const context = { agentId, sessionId, source: 'baileys' };
  const log = (level: 'trace' | 'debug' | 'info' | 'warn' | 'error', obj: unknown, msg?: string) => {
    const message = typeof msg === 'string' ? msg : (typeof obj === 'string' ? obj : '');
    const meta = typeof obj === 'object' && obj !== null && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
    const fullMeta = { ...context, ...meta };
    if (level === 'trace') logDebug(message || 'trace', fullMeta);
    else if (level === 'debug') logDebug(message || 'debug', fullMeta);
    else if (level === 'info') logInfo(message || 'info', fullMeta);
    else if (level === 'warn') logWarn(message || 'warn', fullMeta);
    else logError(message || 'error', undefined, fullMeta);
  };
  return {
    level: 'trace',
    child(bindings: Record<string, unknown>) {
      return createBaileysLogger(
        (bindings.agentId as string) ?? agentId,
        (bindings.sessionId as string) ?? sessionId
      );
    },
    trace(obj: unknown, msg?: string) { log('trace', obj, msg); },
    debug(obj: unknown, msg?: string) { log('debug', obj, msg); },
    info(obj: unknown, msg?: string) { log('info', obj, msg); },
    warn(obj: unknown, msg?: string) { log('warn', obj, msg); },
    error(obj: unknown, msg?: string) { log('error', obj, msg); },
  };
}

/**
 * Gerenciador de sessões WhatsApp usando Baileys.
 * Em produção com muitas sessões, considere migrar para auth state customizado (SQL/Redis).
 */
class WhatsAppSessionManager {
  private sessions: Map<string, WhatsAppSession> = new Map();
  private authDir: string;

  constructor() {
    // Diretório para armazenar credenciais de autenticação
    // Novo nome com prefixo "whatsapp_baileys" para deixar claro que é a API não-oficial
    const newDir = path.join(process.cwd(), 'whatsapp_baileys_sessions');
    const oldDir = path.join(process.cwd(), 'whatsapp_sessions');

    // Migração simples: se o diretório antigo existir e o novo não, renomear
    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      try {
        fs.renameSync(oldDir, newDir);
        logInfo('Migrated WhatsApp session directory to whatsapp_baileys_sessions', {
          from: oldDir,
          to: newDir,
        });
      } catch (error) {
        logError('Failed to migrate WhatsApp session directory', error as Error, {
          from: oldDir,
          to: newDir,
        });
      }
    }

    this.authDir = newDir;
    
    // Criar diretório se não existir
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
    
    logInfo('WhatsApp Session Manager initialized', { authDir: this.authDir });
  }

  /** Obtém versão do WhatsApp com cache (evita fetch em todo reconnect). */
  private async getCachedVersion(): Promise<[number, number, number]> {
    const now = Date.now();
    if (versionCache && now - versionCache.at < VERSION_CACHE_TTL_MS) {
      return versionCache.version;
    }
    const { version } = await fetchLatestBaileysVersion();
    versionCache = { version, at: now };
    return version;
  }

  /** Cancela o timeout de reconexão agendado para a sessão, se existir. */
  private cancelReconnectTimeout(session: WhatsAppSession): void {
    if (session.reconnectTimeoutId != null) {
      clearTimeout(session.reconnectTimeoutId);
      session.reconnectTimeoutId = null;
    }
  }

  /**
   * Limpa uma sessão: cancela reconexão, remove listeners do socket, opcionalmente remove credenciais do disco.
   * @param clearCreds - se true, remove pasta de auth (ex.: badSession)
   */
  private clearSession(key: string, clearCreds: boolean): void {
    const session = this.sessions.get(key);
    if (!session) return;
    this.cancelReconnectTimeout(session);
    if (session.socket) {
      try {
        removeSocketListeners(session.socket);
      } catch (_) { /* ignore */ }
      session.socket = null;
    }
    session.status = 'disconnected';
    session.qrCode = null;
    this.sessions.delete(key);
    if (clearCreds) {
      const authPath = path.join(this.authDir, session.sessionId);
      if (fs.existsSync(authPath)) {
        try {
          fs.rmSync(authPath, { recursive: true, force: true });
        } catch (e) {
          logError('Failed to remove auth folder for session', e as Error, { agentId: session.agentId, sessionId: session.sessionId });
        }
      }
    }
  }

  /**
   * Agenda uma única reconexão com backoff exponencial e jitter.
   * Garante que só existe um timeout por sessão.
   */
  private scheduleReconnect(agentId: string, sessionId: string): void {
    const key = `${agentId}_${sessionId}`;
    const session = this.sessions.get(key);
    if (!session) return;

    const attempts = session.reconnectAttempts ?? 0;
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      logWarn('Reconnection aborted: max attempts reached', {
        agentId,
        sessionId,
        reconnectAttempt: attempts,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
        status: session.status,
      });
      this.clearSession(key, false);
      return;
    }

    session.reconnectAttempts = attempts + 1;
    this.cancelReconnectTimeout(session);
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, session.reconnectAttempts - 1)
    );
    const jitter = delay * 0.3 * Math.random();
    const actualDelay = Math.round(delay + jitter);
    session.status = 'reconnecting';

    logInfo('Reconnection scheduled', {
      agentId,
      sessionId,
      reconnectAttempt: session.reconnectAttempts,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      delayMs: actualDelay,
    });

    session.reconnectTimeoutId = setTimeout(() => {
      session.reconnectTimeoutId = null;
      this.startSession(agentId, sessionId);
    }, actualDelay);
  }

  /**
   * Restaura sessões existentes do diretório de auth na inicialização
   * - Não força reconexão imediata de todas (para não sobrecarregar),
   *   mas reconecta as que já estavam conectadas anteriormente.
   */
  async restoreSessionsFromDisk(): Promise<void> {
    try {
      const dirs = fs.readdirSync(this.authDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      if (dirs.length === 0) {
        logInfo('No WhatsApp sessions found to restore', { authDir: this.authDir });
        return;
      }

      logInfo('Restoring WhatsApp sessions from disk', { count: dirs.length });

      // Importante: não forçamos reconexão aqui, apenas garantimos que o diretório
      // de sessões existe. A reconexão automática é feita via Postgres (plugin_configs)
      // no bootstrap do servidor.
    } catch (error) {
      logError('Error while restoring WhatsApp sessions from disk', error as Error, {
        authDir: this.authDir,
      });
    }
  }

  /** Chave normalizada (trim) para evitar diferenças de encoding/espacos entre DB e memoria. */
  private sessionKey(agentId: string, sessionId: string): string {
    return `${String(agentId).trim()}_${String(sessionId).trim()}`;
  }

  /**
   * Obtém ou cria uma sessão para um agente
   */
  async getOrCreateSession(agentId: string, sessionId: string): Promise<WhatsAppSession> {
    agentId = String(agentId).trim();
    sessionId = String(sessionId).trim();
    const key = this.sessionKey(agentId, sessionId);

    if (this.sessions.has(key)) {
      return this.sessions.get(key)!;
    }

    const session: WhatsAppSession = {
      agentId,
      sessionId,
      socket: null,
      qrCode: null,
      status: 'disconnected',
      reconnectAttempts: 0,
      reconnectTimeoutId: null,
    };

    this.sessions.set(key, session);
    return session;
  }

  /**
   * Cria o socket e anexa todos os handlers (connection.update, creds.update, messages.upsert).
   * Usado por startSession e pelo fluxo restartRequired.
   */
  private async connectWithAuth(
    agentId: string,
    sessionId: string,
    session: WhatsAppSession,
    state: Awaited<ReturnType<typeof useMultiFileAuthState>>['state'],
    saveCreds: () => Promise<void>,
    version: [number, number, number]
  ): Promise<void> {
    const key = `${agentId}_${sessionId}`;
    const authPath = path.join(this.authDir, sessionId);

    const socket = makeWASocket({
      auth: state,
      logger: createBaileysLogger(agentId, sessionId),
      getMessage: async (_key) => undefined,
      markOnlineOnConnect: false,
      printQRInTerminal: false,
      browser: ['Chrome (Linux)', 'Chrome', '120.0.0'],
      defaultQueryTimeoutMs: undefined,
      version,
    });

    session.socket = socket;
    session.status = 'connecting';

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (connection === 'connecting') {
        logInfo('Connection state: connecting', { agentId, sessionId, status: session.status });
      }

      if (qr) {
        logInfo('QR Code generated (expires in ~60s)', { agentId, sessionId });
        const qrCodeData = await QRCode.toDataURL(qr);
        session.qrCode = qrCodeData;
        session.status = 'qr_ready';
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const reasonName = disconnectReasonName(statusCode);
        logWarn('Connection closed', {
          agentId,
          sessionId,
          disconnectReason: reasonName,
          statusCode,
          reconnectAttempt: session.reconnectAttempts ?? 0,
        });

        if (statusCode === DisconnectReason.restartRequired) {
          logInfo('Restart required: creating new socket', { agentId, sessionId });
          try {
            if (session.socket) {
              removeSocketListeners(session.socket);
              session.socket = null;
            }
            const { state: newState, saveCreds: newSaveCreds } = await useMultiFileAuthState(authPath);
            const newVersion = await this.getCachedVersion();
            await this.connectWithAuth(agentId, sessionId, session, newState, newSaveCreds, newVersion);
          } catch (err) {
            logError('Failed to create new socket after restartRequired', err as Error, { agentId, sessionId });
            session.status = 'disconnected';
            this.scheduleReconnect(agentId, sessionId);
          }
          return;
        }

        if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.connectionReplaced) {
          logInfo('Reconnection aborted: session ended', {
            agentId,
            sessionId,
            disconnectReason: reasonName,
          });
          this.clearSession(key, false);
          return;
        }

        if (statusCode === DisconnectReason.badSession) {
          logWarn('Reconnection aborted: bad session, credentials cleared', { agentId, sessionId, disconnectReason: reasonName });
          this.clearSession(key, true);
          return;
        }

        if (
          statusCode === DisconnectReason.forbidden ||
          statusCode === DisconnectReason.multideviceMismatch
        ) {
          logWarn('Reconnection aborted: no auto-reconnect for this reason', {
            agentId,
            sessionId,
            disconnectReason: reasonName,
          });
          this.clearSession(key, false);
          return;
        }

        if (
          statusCode === DisconnectReason.connectionClosed ||
          statusCode === DisconnectReason.connectionLost ||
          statusCode === DisconnectReason.timedOut ||
          statusCode === DisconnectReason.unavailableService
        ) {
          this.scheduleReconnect(agentId, sessionId);
          return;
        }

        logWarn('Connection closed with unknown reason, scheduling reconnect', {
          agentId,
          sessionId,
          statusCode,
          disconnectReason: reasonName,
        });
        this.scheduleReconnect(agentId, sessionId);
      }

      if (connection === 'open') {
        session.reconnectAttempts = 0;
        session.status = 'connected';
        session.qrCode = null;
        session.lastConnected = new Date();
        logInfo('WhatsApp connected successfully', {
          agentId,
          sessionId,
          status: 'connected',
          phoneNumber: session.phoneNumber,
        });
        try {
          const user = socket.user;
          if (user?.id) {
            session.phoneNumber = user.id.split(':')[0];
            logInfo('Phone number identified', { agentId, sessionId, phoneNumber: session.phoneNumber });
          }
        } catch (err) {
          logWarn('Could not identify phone number', { agentId, sessionId, err });
        }
      }
    });

    socket.ev.on('creds.update', () => {
      saveCreds().then(() => {
        logDebug('Credentials persisted', { agentId, sessionId });
      }).catch((err) => {
        logError('Failed to persist credentials', err as Error, { agentId, sessionId });
      });
    });

    socket.ev.on('messages.upsert', async (messageUpdate) => {
      await this.handleIncomingMessages(agentId, sessionId, messageUpdate);
    });
  }

  /**
   * Inicia uma conexão WhatsApp e gera QR Code (ou reconecta com credenciais em disco).
   */
  async startSession(agentId: string, sessionId: string): Promise<string | null> {
    logInfo('Starting WhatsApp session', { agentId, sessionId });

    const session = await this.getOrCreateSession(agentId, sessionId);

    if (session.status === 'connected') {
      logWarn('Session already connected', { agentId, sessionId });
      return null;
    }

    this.cancelReconnectTimeout(session);
    if (session.socket) {
      try {
        removeSocketListeners(session.socket);
      } catch (_) { /* ignore */ }
      session.socket = null;
    }

    try {
      const authPath = path.join(this.authDir, sessionId);
      const { state, saveCreds } = await useMultiFileAuthState(authPath);
      const version = await this.getCachedVersion();
      await this.connectWithAuth(agentId, sessionId, session, state, saveCreds, version);
      return session.qrCode;
    } catch (error) {
      logError('Error starting WhatsApp session', error as Error, { agentId, sessionId });
      session.status = 'disconnected';
      throw error;
    }
  }

  /**
   * Resolve o número de telefone real a partir de um remoteJid.
   *
   * Prioridade correta:
   * 1. Se remoteJid é @s.whatsapp.net → usar o número do próprio remoteJid (já temos o PN)
   * 2. Se remoteJid é @lid → usar remoteJidAlt (PN) ou getPNForLID; NUNCA usar valor do LID
   *
   * IMPORTANTE: remoteJidAlt pode ser LID quando remoteJid é PN - não priorizar remoteJidAlt
   * cegamente, pois retornaria o LID em vez do número real.
   */
  private async resolvePhoneNumberFromJid(
    socket: WASocket | null,
    remoteJid: string,
    remoteJidAlt?: string
  ): Promise<string> {
    // 1. Se remoteJid já é PN (@s.whatsapp.net), usar diretamente - é o número real
    if (isPnJid(remoteJid)) {
      const pn = extractNormalizedPhoneFromJid(remoteJid);
      if (pn) return pn;
    }
    // 2. Se é @lid: remoteJidAlt contém o PN quando disponível (Baileys 6.8+)
    if (isLidJid(remoteJid) && remoteJidAlt && isPnJid(remoteJidAlt)) {
      const pn = extractNormalizedPhoneFromJid(remoteJidAlt);
      if (pn) return pn;
    }
    // 3. Se é @lid, tentar getPNForLID do Baileys (mapeamento oficial)
    if (socket && isLidJid(remoteJid)) {
      try {
        const pnJid = await socket.signalRepository?.lidMapping?.getPNForLID?.(remoteJid);
        if (pnJid) {
          const pn = extractNormalizedPhoneFromJid(pnJid);
          if (pn) return pn;
        }
      } catch (err) {
        logDebug('getPNForLID failed', { remoteJid, err });
      }
      // @lid sem mapeamento: NUNCA usar o valor do LID como phoneNumber
      return '';
    }
    // 4. Fallback para outros formatos (ex: @g.us)
    return extractNormalizedPhoneFromJid(remoteJid);
  }

  /**
   * Extrai texto de uma mensagem Baileys (proto.IMessage)
   * Cobre: conversation, extendedTextMessage, caption de mídia
   */
  private extractMessageText(msg: any): string {
    if (!msg?.message) return '';
    const m = msg.message;
    if (typeof m?.conversation === 'string') return m.conversation;
    if (typeof m?.extendedTextMessage?.text === 'string') return m.extendedTextMessage.text;
    if (typeof m?.imageMessage?.caption === 'string') return m.imageMessage.caption;
    if (typeof m?.videoMessage?.caption === 'string') return m.videoMessage.caption;
    if (typeof m?.documentMessage?.caption === 'string') return m.documentMessage.caption;
    if (typeof m?.buttonsResponseMessage?.selectedButtonId === 'string') return m.buttonsResponseMessage.selectedButtonId;
    if (typeof m?.listResponseMessage?.title === 'string') return m.listResponseMessage.title;
    return '';
  }

  /**
   * Processa mensagens recebidas (inbound = do contato) e enviadas pelo app (fromMe = do número conectado)
   * Usa normalização @lid/@s.whatsapp.net para evitar chats duplicados do mesmo contato.
   */
  private async handleIncomingMessages(
    agentId: string,
    sessionId: string,
    messageUpdate: any
  ): Promise<void> {
    const { messages, type } = messageUpdate;
    
    if (type !== 'notify') return;

    const key = this.sessionKey(agentId, sessionId);
    const session = this.sessions.get(key);
    const socket = session?.socket ?? null;

    for (const message of messages) {
      try {
        const from = message.key?.remoteJid || '';
        const remoteJidAlt = (message.key as any)?.remoteJidAlt;
        const messageText = this.extractMessageText(message);

        if (!messageText.trim()) continue;

        // Resolver phoneNumber de forma unificada (@lid e @s.whatsapp.net)
        const phoneNumber = await this.resolvePhoneNumberFromJid(socket, from, remoteJidAlt);
        // Nome do contato (display name) vindo do Baileys - message.pushName
        const pushName = typeof (message as any).pushName === 'string' ? (message as any).pushName.trim() : undefined;

        // Mensagem enviada PELO app no celular conectado (fromMe) → salvar como outbound e exibir no chat
        if (message.key.fromMe) {
          await this.handleMessageSentFromPhone(agentId, sessionId, from, phoneNumber, messageText);
          continue;
        }

        // Mensagem recebida DO contato (inbound) → enfileirar para IA e broadcast user_message
        logInfo('📱 Received WhatsApp message (inbound)', {
          agentId,
          sessionId,
          from,
          phoneNumber,
          pushName: pushName || undefined,
          messageLength: messageText.length
        });

        try {
          const { chatService } = await import('../../services/chat.service');
          const { conversationService } = await import('../../services/conversation.service');
          
          // Buscar por phoneNumber E whatsappChatId para unificar @lid e @s.whatsapp.net
          const existingConversation = await conversationService.findConversationByPhoneAndAgent(
            phoneNumber,
            agentId,
            'whatsapp',
            from
          );
          
          await chatService.sendMessage({
            agentId,
            content: messageText,
            conversationId: existingConversation?.conversationId,
            channel: 'whatsapp',
            channelMetadata: {
              phoneNumber,
              whatsappChatId: from,
              platform: 'baileys',
              name: pushName || (isLidJid(from) && !phoneNumber ? 'Número oculto' : undefined),
            }
          });

          // Atualizar nome do contato na conversa existente quando temos pushName
          if (existingConversation?.conversationId && pushName) {
            await conversationService.updateSourceContactName(existingConversation.conversationId, { name: pushName });
          }
          // Corrigir phoneNumber quando está incorreto (LID armazenado) e temos o número real
          if (existingConversation?.conversationId) {
            const storedJid = existingConversation.source?.whatsappChatId;
            const storedPhone = existingConversation.source?.phoneNumber;
            const lidValue = isLidJid(from) ? extractJidUser(from) : '';
            const storedPhoneIsLid = lidValue && storedPhone === lidValue;
            // Número correto: da mensagem atual OU extraído do whatsappChatId quando é @s.whatsapp.net
            const correctPhone = phoneNumber || (storedJid && isPnJid(storedJid) ? extractNormalizedPhoneFromJid(storedJid) : '');
            const shouldUpdate = correctPhone && (!storedPhone || storedPhoneIsLid || storedPhone !== correctPhone);
            if (shouldUpdate) {
              await conversationService.updateSourcePhoneNumber(existingConversation.conversationId, correctPhone);
            }
          }
          // Preferir @lid para envio futuro (WhatsApp migrou para LIDs)
          if (existingConversation?.conversationId && isLidJid(from)) {
            const storedJid = existingConversation.source?.whatsappChatId;
            if (storedJid && !isLidJid(storedJid)) {
              await conversationService.updateSourceWhatsAppChatId(existingConversation.conversationId, from);
            }
          }
          
          logInfo('✅ WhatsApp message processed and queued', { agentId, from });
        } catch (integrationError) {
          logError('❌ Failed to integrate WhatsApp message with chat system', integrationError as Error, { agentId, from });
        }

      } catch (error) {
        logError('Error processing incoming message', error as Error, { agentId, sessionId });
      }
    }
  }

  /**
   * Processa mensagem enviada pelo app no celular conectado (fromMe).
   * Salva como assistant/outbound e publica para o front exibir no chat.
   * Usa busca unificada por phoneNumber/whatsappChatId para evitar duplicatas @lid.
   */
  private async handleMessageSentFromPhone(
    agentId: string,
    sessionId: string,
    remoteJid: string,
    phoneNumber: string,
    messageText: string
  ): Promise<void> {
    try {
      const { conversationService } = await import('../../services/conversation.service');
      const { v4: uuidv4 } = await import('uuid');

      // Buscar por phoneNumber E whatsappChatId para unificar @lid e @s.whatsapp.net
      let conv = await conversationService.findConversationByPhoneAndAgent(
        phoneNumber,
        agentId,
        'whatsapp',
        remoteJid
      );

      if (!conv) {
        const { agentService } = await import('../../services/agent.service');
        const agent = await agentService.getAgentByIdForSystem(agentId);
        const conversationId = uuidv4();
        // Usar phoneNumber normalizado; para @lid sem mapeamento, phoneNumber fica vazio
        const normalizedPhone = normalizePhoneNumber(phoneNumber) || phoneNumber;
        const displayName = normalizedPhone || (isLidJid(remoteJid) ? 'Número oculto' : 'Contato');
        conv = await conversationService.createOrGetConversation({
          conversationId,
          agentId,
          source: {
            type: 'whatsapp',
            phoneNumber: normalizedPhone,
            whatsappChatId: remoteJid,
            name: displayName,
            metadata: {},
          },
          destination: {
            type: 'system',
            systemId: agentId,
            name: agent?.name || 'Agente',
            metadata: { type: 'agent' },
          },
          channel: 'whatsapp',
          channelMetadata: { phoneNumber: normalizedPhone, whatsappChatId: remoteJid, platform: 'baileys' },
        });
      }

      const conversationId = conv.conversationId;
      const messageId = uuidv4();

      await conversationService.saveMessage({
        messageId,
        conversationId,
        agentId,
        content: messageText,
        type: 'assistant',
        direction: 'outbound',
        channel: 'whatsapp',
        channelMetadata: { phoneNumber, whatsappChatId: remoteJid, platform: 'baileys' },
        status: 'delivered',
        processedAt: new Date(),
        deliveredAt: new Date(),
      });

      // Entregar apenas ao front (WebSocket). NÃO publicar no Redis:
      // publishResponse faria o WhatsAppHandler reenviar a mensagem ao destinatário (duplicata).
      const { webHandler } = await import('../../queues/handlers/web.handler');
      await webHandler.deliver({
        messageId,
        conversationId,
        agentId,
        response: {
          message: messageText,
          tokensUsed: 0,
          model: 'whatsapp_app',
          finishReason: 'stop',
        },
        channel: 'whatsapp',
        channelMetadata: { phoneNumber, whatsappChatId: remoteJid, platform: 'baileys' },
        timestamp: new Date().toISOString(),
        processingTime: 0,
      });

      logInfo('📱 Message sent from phone synced to chat', {
        agentId,
        sessionId,
        phoneNumber,
        conversationId,
        messageLength: messageText.length,
      });
    } catch (error) {
      logError('Failed to sync message sent from phone', error as Error, { agentId, sessionId, phoneNumber });
    }
  }

  /**
   * Envia uma mensagem via WhatsApp
   */
  async sendMessage(
    agentId: string,
    sessionId: string,
    to: string,
    message: string
  ): Promise<boolean> {
    const key = this.sessionKey(agentId, sessionId);
    const session = this.sessions.get(key);
    
    if (!session || !session.socket || session.status !== 'connected') {
      throw new Error('WhatsApp session not connected');
    }

    try {
      // Garantir formato correto do número
      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
      
      await session.socket.sendMessage(jid, { text: message });
      
      logInfo('WhatsApp message sent', { agentId, sessionId, to });
      
      return true;
    } catch (error) {
      logError('Error sending WhatsApp message', error as Error, { agentId, sessionId, to });
      throw error;
    }
  }

  /**
   * Obtém o QR Code atual de uma sessão
   */
  getQRCode(agentId: string, sessionId: string): string | null {
    const session = this.sessions.get(this.sessionKey(agentId, sessionId));
    return session?.qrCode || null;
  }

  /**
   * Encontra a primeira sessão ativa para o agentId (fallback quando a chave exata não é encontrada).
   * Útil porque o status pode ser consultado com sessionId do DB enquanto a sessão foi criada/restaurada
   * com o mesmo sessionId mas com possível diferença de serialização (ex.: espaços, encoding).
   */
  private getSessionByAgentId(agentId: string): WhatsAppSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.agentId === agentId) return session;
    }
    return undefined;
  }

  /**
   * Obtém o status da conexão.
   * Tenta primeiro pela chave agentId_sessionId; se não houver sessão, tenta por agentId (fallback).
   */
  getConnectionStatus(agentId: string, sessionId: string): ConnectionStatus {
    agentId = String(agentId).trim();
    sessionId = String(sessionId).trim();
    const key = this.sessionKey(agentId, sessionId);
    let session = this.sessions.get(key);

    if (!session) {
      session = this.getSessionByAgentId(agentId);
      if (session) {
        logInfo('Connection status resolved by agentId fallback', {
          agentId,
          requestedSessionId: sessionId,
          actualSessionId: session.sessionId,
        });
      }
    }

    if (!session) {
      const mapKeys = Array.from(this.sessions.keys());
      const mapSessions = Array.from(this.sessions.entries()).map(([k, s]) => ({
        key: k,
        agentId: s.agentId,
        sessionId: s.sessionId,
        status: s.status,
      }));
      logWarn(
        `Status lookup: session not in Map | lookupKey=${key} | mapKeysCount=${mapKeys.length} | mapKeys=[${mapKeys.join('; ')}] | mapSessions=${JSON.stringify(mapSessions)}`,
        { lookupKey: key, lookupAgentId: agentId, lookupSessionId: sessionId }
      );
      return {
        agentId,
        sessionId,
        status: 'disconnected',
        needsQR: false,
      };
    }

    return {
      agentId,
      sessionId: session.sessionId,
      status: session.status,
      phoneNumber: session.phoneNumber,
      lastConnected: session.lastConnected,
      needsQR: session.status === 'qr_ready' || session.status === 'connecting' || session.status === 'reconnecting',
    };
  }

  /**
   * Desconecta uma sessão
   */
  async disconnectSession(agentId: string, sessionId: string): Promise<void> {
    const key = this.sessionKey(agentId, sessionId);
    const session = this.sessions.get(key);

    if (!session) {
      logWarn('Session not found for disconnect', { agentId, sessionId });
      return;
    }

    try {
      this.cancelReconnectTimeout(session);
      if (session.socket) {
        try {
          removeSocketListeners(session.socket);
          await session.socket.logout();
        } catch (_) { /* ignore */ }
        session.socket = null;
      }

      const authPath = path.join(this.authDir, sessionId);
      if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
      }

      this.sessions.delete(key);
      logInfo('WhatsApp session disconnected', { agentId, sessionId });
    } catch (error) {
      logError('Error disconnecting session', error as Error, { agentId, sessionId });
      throw error;
    }
  }

  /**
   * Lista todas as sessões ativas
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }
}

// Singleton via global para garantir uma unica instancia em todo o processo (evita Map vazio quando controller/handler carregam o modulo por caminhos diferentes)
const GLOBAL_KEY = '__whatsapp_baileys_session_manager__';
const g = global as typeof globalThis & { [key: string]: WhatsAppSessionManager | undefined };
if (!g[GLOBAL_KEY]) {
  g[GLOBAL_KEY] = new WhatsAppSessionManager();
}
export const whatsappSessionManager = g[GLOBAL_KEY]!;
