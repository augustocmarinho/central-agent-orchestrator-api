/**
 * Tipos para o sistema de créditos, planos e billing
 */

// ─── Modelos de IA ─────────────────────────────────────────────────

export interface AiModel {
  id: string;
  name: string;
  provider: string;
  displayName: string;
  creditMultiplier: number;
  isActive: boolean;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Planos ────────────────────────────────────────────────────────

export interface Plan {
  id: string;
  name: string;
  displayName: string;
  monthlyCredits: number;
  priceBrl: number;
  features: string[];
  hardLimit: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPlan {
  id: string;
  userId: string;
  planId: string;
  creditsBalance: number;
  cycleStart: Date;
  cycleEnd: Date;
  assignedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  plan?: Plan;
}

// ─── Pacotes adicionais ────────────────────────────────────────────

export interface AdditionalPackage {
  id: string;
  name: string;
  credits: number;
  validityDays: number;
  priceBrl: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserAdditionalPackage {
  id: string;
  userId: string;
  packageId: string;
  creditsRemaining: number;
  assignedAt: Date;
  expiresAt: Date;
  isExhausted: boolean;
  assignedBy?: string;
  createdAt: Date;
  package?: AdditionalPackage;
}

// ─── Transações (ledger) ───────────────────────────────────────────

export type CreditTransactionType =
  | 'plan_allocation'
  | 'consumption'
  | 'package_allocation'
  | 'package_consumption'
  | 'admin_adjustment'
  | 'refund'
  | 'expiration';

export interface CreditTransaction {
  id: string;
  userId: string;
  type: CreditTransactionType;
  amount: number;
  balanceAfter: number;
  agentId?: string;
  messageId?: string;
  userPlanId?: string;
  userPackageId?: string;
  aiModel?: string;
  tokensUsed?: number;
  creditMultiplier?: number;
  idempotencyKey?: string;
  description?: string;
  metadata?: Record<string, any>;
  createdBy?: string;
  createdAt: Date;
}

// ─── Saldo ─────────────────────────────────────────────────────────

export interface UserBalance {
  planBalance: number;
  additionalBalance: number;
  totalBalance: number;
  plan?: Plan;
  cycleEnd?: Date;
  hardLimit: boolean;
}

// ─── Relatórios de uso ─────────────────────────────────────────────

export interface UsageSummary {
  totalCreditsUsed: number;
  totalTokensUsed: number;
  byAgent: Array<{
    agentId: string;
    agentName: string;
    creditsUsed: number;
    tokensUsed: number;
    messageCount: number;
  }>;
  byModel: Array<{
    model: string;
    creditsUsed: number;
    tokensUsed: number;
    messageCount: number;
  }>;
  dailyHistory: Array<{
    date: string;
    creditsUsed: number;
    tokensUsed: number;
    messageCount: number;
  }>;
}

// ─── Resultado da dedução ──────────────────────────────────────────

export interface DeductionResult {
  success: boolean;
  creditsDeducted: number;
  fromPlan: number;
  fromPackages: number;
  newPlanBalance: number;
  warning?: string;
}
