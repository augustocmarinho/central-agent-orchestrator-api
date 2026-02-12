-- Modelo de IA usado pelo agente no chat (ex: gpt-4o-mini, gpt-4o). Padrão: gpt-4o-mini
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS ai_model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini';

-- Provedor do modelo de IA (ex: openai, cursor). Padrão: openai
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS ai_provider VARCHAR(50) NOT NULL DEFAULT 'openai';
