/**
 * Exporta e inicializa todos os consumers
 */

export { messageConsumer } from './message.consumer';

// Função para inicializar todos os consumers
export function initializeConsumers() {
  // O consumer é inicializado automaticamente ao ser importado
  // Esta função existe para manter consistência e permitir futura expansão
  console.log('✅ All consumers initialized');
}
