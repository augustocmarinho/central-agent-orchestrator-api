import { ResponseEvent } from '../../types/queue.types';
import { BaseDeliveryHandler } from './delivery.handler';
import { logInfo, logError, logWarn } from '../../utils/logger';
import { WebSocket } from 'ws';

// Map global para garantir que ChatWebSocket e chat.service (e outros módulos) usem
// a MESMA instância, mesmo quando carregados por caminhos diferentes. Resolve
// wsConnections=0 quando o front está conectado.
const GLOBAL_WS_CONNECTIONS_KEY = '__web_handler_connections__';
const g = global as typeof globalThis & { [key: string]: Map<string, WebSocket> | undefined };
if (!g[GLOBAL_WS_CONNECTIONS_KEY]) {
  g[GLOBAL_WS_CONNECTIONS_KEY] = new Map<string, WebSocket>();
}
const connections = g[GLOBAL_WS_CONNECTIONS_KEY]!;

/**
 * Handler para entrega via WebSocket (canal web)
 */
export class WebHandler extends BaseDeliveryHandler {
  getName(): string {
    return 'WebHandler';
  }

  /**
   * Registra uma conexão WebSocket
   */
  static registerConnection(socketId: string, ws: WebSocket) {
    connections.set(socketId, ws);
    logInfo('WebSocket registered', { socketId, totalConnections: connections.size });
  }

  /**
   * Remove uma conexão WebSocket
   */
  static unregisterConnection(socketId: string) {
    connections.delete(socketId);
    logInfo('WebSocket unregistered', { socketId, totalConnections: connections.size });
  }

  /**
   * Busca uma conexão WebSocket
   */
  static getConnection(socketId: string): WebSocket | undefined {
    return connections.get(socketId);
  }

  /**
   * Obtém todas as conexões
   */
  static getAllConnections(): Map<string, WebSocket> {
    return connections;
  }

  /**
   * Entrega a resposta via WebSocket
   */
  async deliver(event: ResponseEvent): Promise<void> {
    const socketId = event.channelMetadata.websocketId;
    const conversationId = event.conversationId;

    // Preparar payload (usado para todos os envios)
    const payload = {
      type: 'message',
      data: {
        messageId: event.messageId,
        conversationId: event.conversationId,
        message: event.response.message,
        timestamp: event.timestamp,
        metadata: {
          model: event.response.model,
          tokensUsed: event.response.tokensUsed,
          processingTime: event.processingTime,
          finishReason: event.response.finishReason,
        },
      },
    };

    let deliveredCount = 0;
    const deliveredSockets = new Set<string>();

    // Estratégia: Broadcast para TODOS os WebSockets da conversa
    if (conversationId) {
      WebHandler.getAllConnections().forEach((ws: any, sid) => {
        // Verificar se o WebSocket está nessa conversa E está aberto
        if (ws.conversationId === conversationId && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(payload));
            deliveredCount++;
            deliveredSockets.add(sid);
            
            logInfo('✅ Message delivered via WebSocket', { 
              socketId: sid,
              messageId: event.messageId,
              conversationId,
              isOriginalSender: sid === socketId
            });
          } catch (error) {
            logError('Error delivering message via WebSocket', error as Error, { 
              socketId: sid,
              messageId: event.messageId 
            });
          }
        }
      });

      if (deliveredCount > 0) {
        logInfo(`📡 Message broadcasted to ${deliveredCount} WebSocket(s)`, { 
          messageId: event.messageId,
          conversationId,
          sockets: Array.from(deliveredSockets)
        });
      }
    }

    // Se não conseguiu entregar de forma alguma, logar aviso
    if (deliveredCount === 0) {
      logWarn('❌ No WebSocket available for delivery', { 
        socketId,
        conversationId,
        messageId: event.messageId,
        reason: conversationId 
          ? 'No WebSocket connections found for this conversation'
          : 'No conversationId provided'
      });
    }
  }

  /**
   * Envia uma mensagem para um WebSocket específico (método estático de conveniência)
   */
  static sendToClient(socketId: string, data: any) {
    const ws = this.getConnection(socketId);
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logWarn('Cannot send to client: connection not available', { socketId });
      return false;
    }

    try {
      ws.send(JSON.stringify(data));
      return true;
    } catch (error) {
      logError('Error sending to WebSocket', error as Error, { socketId });
      return false;
    }
  }

  /**
   * Broadcast para todas as conexões
   */
  static broadcast(data: any) {
    let successCount = 0;
    
    connections.forEach((ws, socketId) => {
      if (this.sendToClient(socketId, data)) {
        successCount++;
      }
    });

    logInfo('Broadcast sent', { totalConnections: connections.size, successCount });
  }

  /**
   * Broadcast para clientes que estão na conversa OU no agente.
   * Usado para mensagens de canais externos (WhatsApp, Telegram).
   * Se nenhum cliente corresponder, faz fallback para broadcast geral.
   */
  static broadcastToAgentOrConversation(agentId: string, conversationId: string, data: any) {
    let successCount = 0;

    connections.forEach((ws: any, socketId) => {
      const inConversation = ws.conversationId === conversationId;
      const inAgent = ws.agentId === agentId;
      if ((inConversation || inAgent) && this.sendToClient(socketId, data)) {
        successCount++;
      }
    });

    if (successCount === 0 && connections.size > 0) {
      this.broadcast(data);
    }
  }
}

// Singleton instance
export const webHandler = new WebHandler();
