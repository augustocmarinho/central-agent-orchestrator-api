import { ResponseEvent } from '../../types/queue.types';
import { BaseDeliveryHandler } from './delivery.handler';
import { logInfo, logError, logWarn } from '../../utils/logger';
import { WebSocket } from 'ws';

/**
 * Handler para entrega via WebSocket (canal web)
 */
export class WebHandler extends BaseDeliveryHandler {
  // Mapa estático de conexões WebSocket
  // Será populado pelo ChatWebSocketServer
  private static connections: Map<string, WebSocket> = new Map();

  getName(): string {
    return 'WebHandler';
  }

  /**
   * Registra uma conexão WebSocket
   */
  static registerConnection(socketId: string, ws: WebSocket) {
    this.connections.set(socketId, ws);
    logInfo('WebSocket registered', { socketId, totalConnections: this.connections.size });
  }

  /**
   * Remove uma conexão WebSocket
   */
  static unregisterConnection(socketId: string) {
    this.connections.delete(socketId);
    logInfo('WebSocket unregistered', { socketId, totalConnections: this.connections.size });
  }

  /**
   * Busca uma conexão WebSocket
   */
  static getConnection(socketId: string): WebSocket | undefined {
    return this.connections.get(socketId);
  }

  /**
   * Obtém todas as conexões
   */
  static getAllConnections(): Map<string, WebSocket> {
    return this.connections;
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

    let delivered = false;

    // Estratégia 1: Tentar entregar pelo socketId específico (se fornecido)
    if (socketId) {
      const ws = WebHandler.getConnection(socketId);
      
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(payload));
          delivered = true;
          
          logInfo('✅ Message delivered via WebSocket (by socketId)', { 
            socketId,
            messageId: event.messageId,
            conversationId 
          });
        } catch (error) {
          logError('Error delivering message via WebSocket', error as Error, { 
            socketId,
            messageId: event.messageId 
          });
        }
      } else {
        logWarn('WebSocket connection not found or not open (by socketId)', { 
          socketId,
          messageId: event.messageId 
        });
      }
    }

    // Estratégia 2: Se não entregou pelo socketId, fazer broadcast por conversationId
    if (!delivered && conversationId) {
      let broadcastCount = 0;

      WebHandler.getAllConnections().forEach((ws: any, sid) => {
        // Verificar se o WebSocket está nessa conversa E está aberto
        if (ws.conversationId === conversationId && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(payload));
            broadcastCount++;
            
            logInfo('✅ Message delivered via WebSocket (by conversationId)', { 
              socketId: sid,
              messageId: event.messageId,
              conversationId 
            });
          } catch (error) {
            logError('Error broadcasting message via WebSocket', error as Error, { 
              socketId: sid,
              messageId: event.messageId 
            });
          }
        }
      });

      if (broadcastCount > 0) {
        delivered = true;
        logInfo(`📡 Message broadcasted to ${broadcastCount} WebSocket(s)`, { 
          messageId: event.messageId,
          conversationId 
        });
      }
    }

    // Se não conseguiu entregar de forma alguma, logar aviso
    if (!delivered) {
      logWarn('❌ No WebSocket available for delivery', { 
        socketId,
        conversationId,
        messageId: event.messageId,
        reason: 'No matching WebSocket connection found (by socketId or conversationId)'
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
    
    this.connections.forEach((ws, socketId) => {
      if (this.sendToClient(socketId, data)) {
        successCount++;
      }
    });

    logInfo('Broadcast sent', { totalConnections: this.connections.size, successCount });
  }
}

// Singleton instance
export const webHandler = new WebHandler();
