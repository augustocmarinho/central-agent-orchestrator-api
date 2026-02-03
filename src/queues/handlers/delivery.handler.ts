import { ResponseEvent } from '../../types/queue.types';

/**
 * Interface base para handlers de entrega
 * Cada canal (web, whatsapp, telegram) implementa esta interface
 */
export interface IDeliveryHandler {
  /**
   * Entrega uma resposta ao cliente final
   */
  deliver(event: ResponseEvent): Promise<void>;

  /**
   * Verifica se o handler pode entregar para este evento
   */
  canDeliver(event: ResponseEvent): boolean;

  /**
   * Nome do handler
   */
  getName(): string;
}

/**
 * Classe base abstrata para handlers
 */
export abstract class BaseDeliveryHandler implements IDeliveryHandler {
  abstract deliver(event: ResponseEvent): Promise<void>;
  abstract getName(): string;

  canDeliver(event: ResponseEvent): boolean {
    return true; // Override se necessário validações específicas
  }

  /**
   * Helper para formatar mensagem de erro
   */
  protected formatErrorMessage(error: Error, event: ResponseEvent): string {
    return `Failed to deliver message ${event.messageId} via ${this.getName()}: ${error.message}`;
  }
}
