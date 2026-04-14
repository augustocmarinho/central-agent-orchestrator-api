-- Configuração de follow-up por agente
-- Permite até 3 mensagens automáticas de acompanhamento quando o cliente não responde
CREATE TABLE IF NOT EXISTS agent_follow_up_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agent_id)
);

-- Passos individuais de follow-up (1 a 3 por agente)
CREATE TABLE IF NOT EXISTS agent_follow_up_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES agent_follow_up_config(id) ON DELETE CASCADE,
  step_order SMALLINT NOT NULL CHECK (step_order BETWEEN 1 AND 3),
  delay_minutes INT NOT NULL CHECK (delay_minutes > 0),
  message_type VARCHAR(20) NOT NULL CHECK (message_type IN ('custom', 'ai_generated')),
  custom_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(config_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_config_agent ON agent_follow_up_config(agent_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_steps_config ON agent_follow_up_steps(config_id);
