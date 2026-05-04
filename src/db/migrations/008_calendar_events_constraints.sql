-- Constraints e idempotência para calendar_events
-- Resolve: race condition de duplicatas em fan-out paralelo, retry da Bull, e
-- permite ON CONFLICT por tool_call_id para idempotência de chamadas da OpenAI.

-- Coluna para rastrear o call_id da Responses API que originou o evento.
-- NULL para eventos pre-existentes (sem idempotência retroativa).
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS tool_call_id VARCHAR(64);

-- Idempotência: dois inserts com o mesmo (agent_id, tool_call_id) viram no-op
-- via ON CONFLICT. Parcial para não bloquear linhas antigas com NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_events_tool_call_id
  ON calendar_events(agent_id, tool_call_id)
  WHERE tool_call_id IS NOT NULL;

-- Limpeza de duplicatas pré-existentes (causadas pelo bug de race condition antes desta
-- migration): para cada (agent_id, datetime) com mais de um evento ativo, mantém o mais
-- antigo (created_at ASC) e marca os demais como 'cancelled'. Sem esta limpeza, o índice
-- único parcial abaixo falharia. Os eventos cancelados continuam visíveis no histórico.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY agent_id, datetime
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM calendar_events
  WHERE status <> 'cancelled'
)
UPDATE calendar_events
SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Bloqueia duplicata exata (mesmo agent_id + datetime ativo). Ainda permite
-- recriar no mesmo horário se o evento anterior foi cancelado.
-- NOTE: sobreposição parcial (9h+30min vs 9h15+30min) NÃO é coberta aqui — é
-- responsabilidade do advisory_xact_lock + overlap check no handler.
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_events_active_slot
  ON calendar_events(agent_id, datetime)
  WHERE status <> 'cancelled';

-- Acelera filtros que combinam status (ex: 'cancelled') com janela de datetime,
-- usados pelo overlap check e pela listagem de eventos ativos.
CREATE INDEX IF NOT EXISTS idx_calendar_events_agent_status_datetime
  ON calendar_events(agent_id, status, datetime);
