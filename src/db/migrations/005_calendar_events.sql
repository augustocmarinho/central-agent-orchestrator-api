-- Calendar events per agent (plugin.calendar)
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  datetime TIMESTAMPTZ NOT NULL,
  attendee TEXT DEFAULT '',
  status VARCHAR(50) DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'pending', 'cancelled')),
  duration_minutes INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_agent_id ON calendar_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_datetime ON calendar_events(datetime);
CREATE INDEX IF NOT EXISTS idx_calendar_events_agent_datetime ON calendar_events(agent_id, datetime);
