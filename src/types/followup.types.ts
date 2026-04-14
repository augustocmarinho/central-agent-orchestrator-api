/**
 * Tipos para o sistema de follow-up automático
 */

/** Tipo da mensagem de follow-up */
export type FollowUpMessageType = 'custom' | 'ai_generated';

/** Um passo de follow-up */
export interface FollowUpStep {
  id?: string;
  stepOrder: number;          // 1, 2 ou 3
  delayMinutes: number;       // Minutos após última resposta da IA
  messageType: FollowUpMessageType;
  customMessage?: string;     // Obrigatório quando messageType = 'custom'
}

/** Configuração completa de follow-up de um agente */
export interface FollowUpConfig {
  id?: string;
  agentId: string;
  enabled: boolean;
  steps: FollowUpStep[];
}

/** Job da fila de follow-up */
export interface FollowUpJob {
  conversationId: string;
  agentId: string;
  stepOrder: number;
  messageType: FollowUpMessageType;
  customMessage?: string;
  channel: 'web' | 'whatsapp' | 'telegram' | 'api';
  channelMetadata: Record<string, any>;
  scheduledAt: string;        // ISO timestamp
}

/** Estado Redis de sequência ativa */
export interface FollowUpState {
  agentId: string;
  currentStep: number;
  totalSteps: number;
  lastAssistantMessageAt: string;
  jobId: string;
  channel: string;
  channelMetadata: Record<string, any>;
}
