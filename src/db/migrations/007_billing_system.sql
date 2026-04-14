-- ============================================================
-- Sistema de Créditos, Planos e Billing
-- ============================================================

-- Registro de modelos de IA com multiplicador de custo
CREATE TABLE IF NOT EXISTS ai_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  provider VARCHAR(50) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  credit_multiplier NUMERIC(6,2) NOT NULL DEFAULT 1.00,
  tokens_per_credit INTEGER NOT NULL DEFAULT 1000,
  is_active BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Planos disponíveis
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  monthly_credits INTEGER NOT NULL,
  price_brl NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  features JSONB DEFAULT '[]'::jsonb,
  hard_limit BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Plano ativo do usuário (1 por usuário)
CREATE TABLE IF NOT EXISTS user_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  credits_balance INTEGER NOT NULL DEFAULT 0,
  cycle_start DATE NOT NULL,
  cycle_end DATE NOT NULL,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

-- Templates de pacotes adicionais
CREATE TABLE IF NOT EXISTS additional_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  credits INTEGER NOT NULL,
  validity_days INTEGER NOT NULL DEFAULT 30,
  price_brl NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pacotes adicionais atribuídos a usuários
CREATE TABLE IF NOT EXISTS user_additional_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES additional_packages(id) ON DELETE RESTRICT,
  credits_remaining INTEGER NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  is_exhausted BOOLEAN NOT NULL DEFAULT false,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ledger append-only de transações de crédito
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN (
    'plan_allocation',
    'consumption',
    'package_allocation',
    'package_consumption',
    'admin_adjustment',
    'refund',
    'expiration'
  )),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  message_id VARCHAR(100),
  user_plan_id UUID REFERENCES user_plans(id) ON DELETE SET NULL,
  user_package_id UUID REFERENCES user_additional_packages(id) ON DELETE SET NULL,
  ai_model VARCHAR(100),
  tokens_used INTEGER,
  credit_multiplier NUMERIC(6,2),
  idempotency_key VARCHAR(255) UNIQUE,
  description TEXT,
  metadata JSONB,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Índices
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ai_models_active ON ai_models(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ai_models_name_provider ON ai_models(name, provider);
CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_user_plans_user ON user_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_user_plans_cycle ON user_plans(cycle_end);
CREATE INDEX IF NOT EXISTS idx_user_packages_user ON user_additional_packages(user_id);
CREATE INDEX IF NOT EXISTS idx_user_packages_active ON user_additional_packages(user_id, is_exhausted, expires_at)
  WHERE is_exhausted = false;
CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_tx_agent ON credit_transactions(agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_tx_type ON credit_transactions(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_tx_idempotency ON credit_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_tx_user_month ON credit_transactions(user_id, created_at)
  WHERE type IN ('consumption', 'package_consumption');
