import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { chatService } from '../services/chat.service';
import { verifyToken } from '../auth/jwt';
import { WebHandler } from '../queues/handlers/web.handler';
import url from 'url';
import { v4 as uuidv4 } from 'uuid';

interface WebSocketClient extends WebSocket {
  userId?: string;
  agentId?: string;
  conversationId?: string;
  isAlive?: boolean;
  socketId?: string; // ID único para identificar a conexão
}

export class ChatWebSocketServer {
  private wss: WebSocketServer;
  
  constructor(server: any) {
    this.wss = new WebSocketServer({ server, path: '/ws/chat' });
    this.initialize();
  }
  
  private initialize() {
    this.wss.on('connection', (ws: WebSocketClient, req: IncomingMessage) => {
      console.log('🔌 Nova conexão WebSocket');
      
      // Autenticar conexão
      const authenticated = this.authenticateConnection(ws, req);
      if (!authenticated) {
        ws.close(1008, 'Não autorizado');
        return;
      }
      
      // Gerar socketId único e registrar no handler
      ws.socketId = uuidv4();
      WebHandler.registerConnection(ws.socketId, ws);
      
      ws.isAlive = true;
      
      // Heartbeat
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      
      // Mensagens recebidas
      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(ws, message);
        } catch (error) {
          console.error('Erro ao processar mensagem WS:', error);
          this.sendError(ws, 'Erro ao processar mensagem');
        }
      });
      
      // Desconexão
      ws.on('close', () => {
        console.log('🔌 Conexão WebSocket fechada');
        // Remover do handler
        if (ws.socketId) {
          WebHandler.unregisterConnection(ws.socketId);
        }
      });
      
      // Enviar confirmação de conexão
      this.sendMessage(ws, {
        type: 'connected',
        data: { 
          message: 'Conectado ao chat',
          socketId: ws.socketId 
        },
      });
    });
    
    // Heartbeat para detectar conexões mortas
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws: WebSocketClient) => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
    
    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }
  
  private authenticateConnection(ws: WebSocketClient, req: IncomingMessage): boolean {
    try {
      const queryParams = url.parse(req.url || '', true).query;
      const token = queryParams.token as string;
      
      if (!token) {
        return false;
      }
      
      const payload = verifyToken(token);
      ws.userId = payload.userId;
      
      return true;
    } catch (error) {
      return false;
    }
  }
  
  private async handleMessage(ws: WebSocketClient, message: any) {
    const { type, data } = message;
    
    switch (type) {
      case 'join':
        // Entrar em uma conversa
        ws.agentId = data.agentId;
        ws.conversationId = data.conversationId;
        console.log('📍 WebSocket joined conversation', { 
          socketId: ws.socketId,
          conversationId: data.conversationId,
          agentId: data.agentId 
        });
        this.sendMessage(ws, {
          type: 'joined',
          data: { agentId: data.agentId, conversationId: data.conversationId },
        });
        break;
      
      case 'message':
        // Enviar mensagem
        await this.handleChatMessage(ws, data);
        break;
      
      case 'typing':
        // Indicador de digitação (pode ser broadcast para outros clientes)
        break;
      
      default:
        this.sendError(ws, 'Tipo de mensagem não reconhecido');
    }
  }
  
  private async handleChatMessage(ws: WebSocketClient, data: any) {
    try {
      if (!data.agentId || !data.content) {
        return this.sendError(ws, 'agentId e content são obrigatórios');
      }
      
      // Validar scheduledFor se fornecido
      let scheduledDate: Date | undefined;
      if (data.scheduledFor) {
        scheduledDate = new Date(data.scheduledFor);
        if (isNaN(scheduledDate.getTime())) {
          return this.sendError(ws, 'scheduledFor deve ser uma data válida (ISO 8601)');
        }
        if (scheduledDate < new Date()) {
          return this.sendError(ws, 'scheduledFor deve ser uma data futura');
        }
      }
      
      // Buscar conversação para determinar o canal correto
      const conversationId = ws.conversationId || data.conversationId;
      let channel: 'web' | 'whatsapp' | 'telegram' | 'api' = 'web';
      let channelMetadata: Record<string, any> = {
        websocketId: ws.socketId,
      };

      if (conversationId) {
        const conversation = await chatService.getConversation(conversationId);
        if (conversation) {
          // Usar o canal da conversa original
          channel = conversation.channel;
          
          // Mesclar metadados do canal original com o socketId atual
          channelMetadata = {
            ...conversation.channelMetadata,
            websocketId: ws.socketId, // Sempre incluir para delivery via WebSocket
          };

          // Adicionar informações específicas do canal de origem
          if (channel === 'whatsapp' && conversation.source.phoneNumber) {
            channelMetadata.phoneNumber = conversation.source.phoneNumber;
            channelMetadata.whatsappChatId = conversation.source.whatsappChatId;
          } else if (channel === 'telegram' && conversation.source.telegramChatId) {
            channelMetadata.telegramChatId = conversation.source.telegramChatId;
            channelMetadata.telegramUserId = conversation.source.telegramUserId;
          }

          console.log('📋 Conversa encontrada - usando canal:', {
            conversationId,
            channel,
            hasPhoneNumber: !!channelMetadata.phoneNumber,
            hasTelegramChatId: !!channelMetadata.telegramChatId
          });
        }
      }
      
      // Notificar que está enfileirando ou agendando
      this.sendMessage(ws, {
        type: scheduledDate ? 'scheduled' : 'queued',
        data: { 
          message: scheduledDate 
            ? `Mensagem agendada para ${scheduledDate.toISOString()}` 
            : 'Mensagem recebida, processando...',
          scheduledFor: scheduledDate?.toISOString()
        },
      });
      
      // Enviar para fila (retorna imediatamente ou agenda)
      const result = await chatService.sendMessage({
        agentId: data.agentId,
        userId: ws.userId,
        content: data.content,
        conversationId,
        channel,
        channelMetadata,
        scheduledFor: scheduledDate,
      });
      
      // Atualizar conversationId se for nova
      if (!ws.conversationId) {
        ws.conversationId = result.conversationId;
        console.log('📍 WebSocket conversationId updated', { 
          socketId: ws.socketId,
          conversationId: result.conversationId 
        });
      }
      
      // Fazer broadcast da mensagem do usuário para todos os WebSockets da conversa
      this.broadcastToConversation(result.conversationId, {
        type: 'user_message',
        data: {
          messageId: result.messageId,
          conversationId: result.conversationId,
          content: data.content,
          userId: ws.userId,
          timestamp: new Date().toISOString(),
          senderSocketId: ws.socketId, // Identificar quem enviou
        },
      });
      
      // Confirmar que mensagem foi enfileirada ou agendada
      this.sendMessage(ws, {
        type: result.status === 'scheduled' ? 'scheduled' : 'processing',
        data: {
          conversationId: result.conversationId,
          messageId: result.messageId,
          jobId: result.jobId,
          status: result.status,
          scheduledFor: result.scheduledFor?.toISOString(),
          message: result.status === 'scheduled' 
            ? `Mensagem agendada para ${result.scheduledFor?.toISOString()}`
            : 'Sua mensagem está sendo processada...',
        },
      });

      // A resposta será enviada automaticamente pelo WebHandler quando o job completar
    } catch (error: any) {
      console.error('Erro ao processar mensagem do chat:', error);
      this.sendError(ws, error.message || 'Erro ao processar mensagem');
    }
  }
  
  private broadcastToConversation(conversationId: string, data: any) {
    let broadcastCount = 0;
    
    this.wss.clients.forEach((client: WebSocketClient) => {
      // Enviar para todos os clientes conectados nessa conversa
      if (client.conversationId === conversationId && client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify(data));
          broadcastCount++;
        } catch (error) {
          console.error('Erro ao fazer broadcast para conversa:', error);
        }
      }
    });
    
    if (broadcastCount > 0) {
      console.log(`📡 Broadcast para ${broadcastCount} cliente(s) na conversa ${conversationId}`);
    }
  }
  
  private sendMessage(ws: WebSocketClient, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
  
  private sendError(ws: WebSocketClient, error: string) {
    this.sendMessage(ws, {
      type: 'error',
      data: { error },
    });
  }
}
