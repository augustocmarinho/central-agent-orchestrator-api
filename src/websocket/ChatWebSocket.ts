import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { chatService } from '../services/chat.service';
import { verifyToken } from '../auth/jwt';
import url from 'url';

interface WebSocketClient extends WebSocket {
  userId?: string;
  agentId?: string;
  conversationId?: string;
  isAlive?: boolean;
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
      });
      
      // Enviar confirmação de conexão
      this.sendMessage(ws, {
        type: 'connected',
        data: { message: 'Conectado ao chat' },
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
      
      // Notificar que está processando
      this.sendMessage(ws, {
        type: 'processing',
        data: { message: 'Processando sua mensagem...' },
      });
      
      const result = await chatService.sendMessage({
        agentId: data.agentId,
        userId: ws.userId,
        content: data.content,
        conversationId: ws.conversationId || data.conversationId,
        channel: 'webchat',
      });
      
      // Atualizar conversationId se for nova
      if (!ws.conversationId) {
        ws.conversationId = result.conversationId;
      }
      
      // Enviar resposta
      this.sendMessage(ws, {
        type: 'message',
        data: {
          conversationId: result.conversationId,
          message: result.message,
        },
      });
    } catch (error: any) {
      console.error('Erro ao processar mensagem do chat:', error);
      this.sendError(ws, error.message || 'Erro ao processar mensagem');
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
