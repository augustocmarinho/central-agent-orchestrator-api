import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { logInfo, logWarn, logError } from '../../utils/logger';
import { WhatsAppSession, ConnectionStatus } from './types';

/**
 * Gerenciador de sessões WhatsApp usando Baileys
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

  /**
   * Obtém ou cria uma sessão para um agente
   */
  async getOrCreateSession(agentId: string, sessionId: string): Promise<WhatsAppSession> {
    const key = `${agentId}_${sessionId}`;
    
    if (this.sessions.has(key)) {
      return this.sessions.get(key)!;
    }

    const session: WhatsAppSession = {
      agentId,
      sessionId,
      socket: null,
      qrCode: null,
      status: 'disconnected',
    };

    this.sessions.set(key, session);
    return session;
  }

  /**
   * Inicia uma conexão WhatsApp e gera QR Code
   */
  async startSession(agentId: string, sessionId: string): Promise<string | null> {
    logInfo('Starting WhatsApp session', { agentId, sessionId });
    
    const session = await this.getOrCreateSession(agentId, sessionId);
    
    if (session.status === 'connected') {
      logWarn('Session already connected', { agentId, sessionId });
      return null;
    }

    try {
      const authPath = path.join(this.authDir, sessionId);
      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      const socket = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Não imprimir no terminal
        browser: ['AI Agent Platform', 'Chrome', '1.0.0'],
        defaultQueryTimeoutMs: undefined,
      });

      session.socket = socket;
      session.status = 'connecting';

      // Event: QR Code atualizado
      socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          logInfo('QR Code generated', { agentId, sessionId });
          
          // Gerar QR Code em base64
          const qrCodeData = await QRCode.toDataURL(qr);
          session.qrCode = qrCodeData;
          session.status = 'qr_ready';
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
          
          logWarn('Connection closed', {
            agentId,
            sessionId,
            shouldReconnect,
            reason: (lastDisconnect?.error as Boom)?.output?.statusCode
          });

          if (shouldReconnect) {
            session.status = 'connecting';
            // Reconectar após 3 segundos
            setTimeout(() => {
              this.startSession(agentId, sessionId);
            }, 3000);
          } else {
            session.status = 'disconnected';
            session.qrCode = null;
            this.sessions.delete(`${agentId}_${sessionId}`);
          }
        } else if (connection === 'open') {
          logInfo('WhatsApp connected successfully', { agentId, sessionId });
          session.status = 'connected';
          session.qrCode = null;
          session.lastConnected = new Date();
          
          // Obter número de telefone
          try {
            const user = socket.user;
            if (user?.id) {
              session.phoneNumber = user.id.split(':')[0];
              logInfo('Phone number identified', { agentId, phoneNumber: session.phoneNumber });
            }
          } catch (err) {
            logWarn('Could not identify phone number', err);
          }
        }
      });

      // Event: Credenciais atualizadas
      socket.ev.on('creds.update', saveCreds);

      // Event: Mensagens recebidas
      socket.ev.on('messages.upsert', async (messageUpdate) => {
        await this.handleIncomingMessages(agentId, sessionId, messageUpdate);
      });

      return session.qrCode;
    } catch (error) {
      logError('Error starting WhatsApp session', error as Error, { agentId, sessionId });
      session.status = 'disconnected';
      throw error;
    }
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
   */
  private async handleIncomingMessages(
    agentId: string,
    sessionId: string,
    messageUpdate: any
  ): Promise<void> {
    const { messages, type } = messageUpdate;
    
    if (type !== 'notify') return;

    for (const message of messages) {
      try {
        const from = message.key?.remoteJid || '';
        const messageText = this.extractMessageText(message);

        if (!messageText.trim()) continue;

        const phoneNumber = from.split('@')[0];

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
          messageLength: messageText.length
        });

        try {
          const { chatService } = await import('../../services/chat.service');
          const { conversationService } = await import('../../services/conversation.service');
          
          const existingConversation = await conversationService.findConversationByPhoneAndAgent(
            phoneNumber,
            agentId,
            'whatsapp'
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
            }
          });
          
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
      const { responsePublisher } = await import('../../queues/pubsub/publisher');
      const { v4: uuidv4 } = await import('uuid');

      let conv = await conversationService.findConversationByPhoneAndAgent(
        phoneNumber,
        agentId,
        'whatsapp'
      );

      if (!conv) {
        const { agentService } = await import('../../services/agent.service');
        const agent = await agentService.getAgentByIdForSystem(agentId);
        const conversationId = uuidv4();
        conv = await conversationService.createOrGetConversation({
          conversationId,
          agentId,
          source: {
            type: 'whatsapp',
            phoneNumber,
            whatsappChatId: remoteJid,
            name: phoneNumber,
            metadata: {},
          },
          destination: {
            type: 'system',
            systemId: agentId,
            name: agent?.name || 'Agente',
            metadata: { type: 'agent' },
          },
          channel: 'whatsapp',
          channelMetadata: { phoneNumber, whatsappChatId: remoteJid, platform: 'baileys' },
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
    const session = this.sessions.get(`${agentId}_${sessionId}`);
    
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
    const session = this.sessions.get(`${agentId}_${sessionId}`);
    return session?.qrCode || null;
  }

  /**
   * Obtém o status da conexão
   */
  getConnectionStatus(agentId: string, sessionId: string): ConnectionStatus {
    const session = this.sessions.get(`${agentId}_${sessionId}`);
    
    if (!session) {
      return {
        agentId,
        sessionId,
        status: 'disconnected',
        needsQR: false,
      };
    }

    return {
      agentId,
      sessionId,
      status: session.status,
      phoneNumber: session.phoneNumber,
      lastConnected: session.lastConnected,
      needsQR: session.status === 'qr_ready' || session.status === 'connecting',
    };
  }

  /**
   * Desconecta uma sessão
   */
  async disconnectSession(agentId: string, sessionId: string): Promise<void> {
    const key = `${agentId}_${sessionId}`;
    const session = this.sessions.get(key);
    
    if (!session) {
      logWarn('Session not found for disconnect', { agentId, sessionId });
      return;
    }

    try {
      if (session.socket) {
        await session.socket.logout();
      }
      
      // Remover arquivos de autenticação
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

// Singleton
export const whatsappSessionManager = new WhatsAppSessionManager();
