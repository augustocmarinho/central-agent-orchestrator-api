// Plugin Calendário: agendar, listar, cancelar e remarcar eventos.
// Persistência em calendar_events (PostgreSQL).

import { pool, query } from '../../db/postgres';
import { v4 as uuidv4 } from 'uuid';
import { logWarn } from '../../utils/logger';
import type { PoolClient } from 'pg';
import type { PluginExecuteContext } from '../registry';

type WeekDay = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

export interface CalendarEventRow {
  id: string;
  agent_id: string;
  title: string;
  datetime: Date;
  attendee: string;
  status: string;
  duration_minutes: number | null;
  created_at: Date;
  updated_at: Date;
}

/** Event shape returned to front / tools (datetime as ISO string, duration in minutes). */
export interface CalendarEvent {
  id: string;
  title: string;
  datetime: string;
  attendee: string;
  status?: string;
  duration?: number;
  /** Data no fuso do agente — facilita reasoning da IA. */
  date?: string;
  /** Hora no fuso do agente (HH:mm). */
  time?: string;
  /** Fuso usado na conversão de date/time. */
  timezone?: string;
}

/** Calendar config as stored (key "config" in plugin_configs). */
interface CalendarConfig {
  daySlots?: Partial<Record<WeekDay, Array<{ start: string; end: string }>>>;
  timezone?: string;
  schedulingMode?: 'slots' | 'fila';
  minAdvanceDays?: number;
  maxAdvanceDays?: number;
  maxPatientsPerDay?: number;
  defaultSlotDurationMinutes?: number;
}

const TZ_DEFAULT = 'America/Sao_Paulo';

/** YYYY-MM-DD in the given timezone. */
function getDateInTz(d: Date, tz: string): string {
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

/** Weekday in config format: 'monday'..'sunday'. */
function getWeekdayInTz(d: Date, tz: string): WeekDay {
  const long = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' });
  return long.toLowerCase() as WeekDay;
}

/** HH:mm in the given timezone (24h). */
function getTimeInTz(d: Date, tz: string): string {
  return d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Compare time strings "HH:mm". Returns -1 if a < b, 0 if equal, 1 if a > b. */
function compareTime(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  if (ah !== bh) return ah < bh ? -1 : 1;
  return am < bm ? -1 : am > bm ? 1 : 0;
}

/** True if time "HH:mm" is within [slot.start, slot.end) (start inclusive, end exclusive). */
function timeInSlot(time: string, slot: { start: string; end: string }): boolean {
  return compareTime(time, slot.start) >= 0 && compareTime(time, slot.end) < 0;
}

/** Event end datetime (start + duration minutes). */
function eventEnd(datetime: Date, durationMinutes: number): Date {
  const end = new Date(datetime);
  end.setMinutes(end.getMinutes() + durationMinutes);
  return end;
}

/** Overlap: [s1,e1) and [s2,e2) overlap iff s1 < e2 && s2 < e1. */
function intervalsOverlap(
  start1: Date, end1: Date,
  start2: Date, end2: Date
): boolean {
  return start1.getTime() < end2.getTime() && start2.getTime() < end1.getTime();
}

/** Add minutes to "HH:mm", return "HH:mm". */
function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

/**
 * Constrói um Date UTC a partir de YYYY-MM-DD + HH:mm interpretados na IANA timezone `tz`.
 *
 * Implementação independente do fuso do servidor Node:
 *  1. Faz um "chute": trata os campos (Y,M,D,h,m) como se fossem UTC.
 *  2. Pergunta ao Intl que wall-time o `tz` enxerga nesse instante.
 *  3. A diferença entre o wall-time desejado e o que o `tz` mostrou é o offset
 *     que precisamos somar ao chute para chegar ao instante UTC correto.
 *
 * Fica correto em DST (mesmo nas horas inexistentes/duplas, escolhe o offset
 * "antes" da virada — que é o comportamento padrão de fromZonedTime).
 */
function buildDateInTz(dateStr: string, timeStr: string, tz: string): Date {
  const [Y, M, D] = dateStr.split('-').map(Number);
  const [h, m] = timeStr.split(':').map(Number);

  const utcGuess = Date.UTC(Y, M - 1, D, h, m, 0);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcGuess));

  const get = (key: string) => Number(parts.find((p) => p.type === key)?.value ?? 0);
  const tzHour = get('hour') === 24 ? 0 : get('hour'); // Intl às vezes retorna "24" para meia-noite
  const seenAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), tzHour, get('minute'), get('second'));

  // wall_wanted - wall_seen = offset que precisa ser aplicado.
  const offsetMs = utcGuess - seenAsUtc;
  return new Date(utcGuess + offsetMs);
}

/** Validate "YYYY-MM-DD". */
function isValidDateStr(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Validate "HH:mm" (24h, 00:00..23:59). */
function isValidTimeStr(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return false;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h >= 0 && h < 24 && mm >= 0 && mm < 60;
}

/**
 * Resolve o Date UTC a partir do payload da tool, aceitando os dois formatos:
 *  - novo: { date: 'YYYY-MM-DD', time: 'HH:mm' } interpretado em `tz` do agente
 *  - legado: { datetime: ISO 8601 } (warning de deprecação)
 */
type ResolveDatetimeResult =
  | { ok: true; datetime: Date }
  | { ok: false; error: string };

function resolveEventDatetime(
  data: { date?: unknown; time?: unknown; datetime?: unknown },
  tz: string
): ResolveDatetimeResult {
  if (isValidDateStr(data.date) && isValidTimeStr(data.time)) {
    const dt = buildDateInTz(data.date, data.time, tz);
    if (isNaN(dt.getTime())) return { ok: false, error: 'Data/hora inválida' };
    return { ok: true, datetime: dt };
  }
  if (typeof data.datetime === 'string' && data.datetime.trim()) {
    logWarn('calendar_create_event: contrato legado {datetime} usado, prefira {date,time}');
    const dt = new Date(data.datetime);
    if (isNaN(dt.getTime())) return { ok: false, error: 'Data/hora inválida' };
    return { ok: true, datetime: dt };
  }
  return { ok: false, error: 'Informe date (YYYY-MM-DD) e time (HH:mm) no fuso do agente' };
}

/** Bloqueia criações concorrentes do mesmo agente dentro da transação corrente. */
async function lockAgentForCalendar(conn: PoolClient, agentId: string): Promise<void> {
  await conn.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`calendar:${agentId}`]);
}

/** Diferença em minutos entre duas strings "HH:mm" (b - a, b > a). */
function diffMinutes(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return (bh * 60 + bm) - (ah * 60 + am);
}

interface ValidationResult {
  /** Mensagem de erro (presente se inválido). */
  error?: string;
  /**
   * Duração efetiva do agendamento em minutos. Em modo `slots`, é forçada à duração
   * total da janela configurada (ex: 09:00–12:00 → 180min). Em modo `fila`, é a
   * duração que veio do payload (ou o default).
   */
  effectiveDuration?: number;
}

/**
 * Valida disponibilidade contra config e eventos existentes.
 *
 * Modelo de slots: cada janela `{start, end}` configurada representa UM atendimento
 * com duração igual à janela inteira. O `time` do agendamento deve corresponder
 * exatamente ao `start` de uma janela (não pontos intermediários).
 */
async function validateAgainstConfig(
  conn: PoolClient,
  agentId: string,
  datetime: Date,
  durationMinutes: number,
  cfg: CalendarConfig,
  excludeEventId?: string
): Promise<ValidationResult> {
  const tz = cfg.timezone ?? TZ_DEFAULT;
  const eventDateStr = getDateInTz(datetime, tz);
  const todayStr = getDateInTz(new Date(), tz);
  const minAdvance = cfg.minAdvanceDays ?? 0;
  const maxAdvance = cfg.maxAdvanceDays ?? 30;
  const today = new Date(todayStr);
  const eventDate = new Date(eventDateStr);
  const daysDiff = Math.floor((eventDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  if (datetime.getTime() <= Date.now()) {
    return { error: 'Não é possível agendar para uma data/hora no passado' };
  }
  if (daysDiff < minAdvance) {
    return { error: `Agendamento só permitido com pelo menos ${minAdvance} dia(s) de antecedência` };
  }
  if (daysDiff > maxAdvance) {
    return { error: `Agendamento só permitido até ${maxAdvance} dias à frente` };
  }

  const mode = cfg.schedulingMode ?? 'slots';
  let effectiveDuration = durationMinutes;

  if (mode === 'slots') {
    const weekday = getWeekdayInTz(datetime, tz);
    const slots = cfg.daySlots?.[weekday];
    if (!slots || slots.length === 0) {
      return { error: `Não há horários configurados para ${weekday}` };
    }
    const time = getTimeInTz(datetime, tz);
    const matched = slots.find((slot) => slot.start === time);
    if (!matched) {
      const available = slots.map((s) => s.start).join(', ');
      return { error: `Horário ${time} não corresponde ao início de nenhuma janela. Janelas disponíveis: ${available}` };
    }

    // Duração da janela é a fonte de verdade — ignoramos qualquer duration_minutes
    // arbitrário que tenha vindo da IA. Cada janela = 1 atendimento.
    effectiveDuration = diffMinutes(matched.start, matched.end);

    const start = datetime;
    const end = eventEnd(datetime, effectiveDuration);
    const params: unknown[] = [agentId, tz, eventDateStr];
    let sql = `SELECT id, datetime, duration_minutes FROM calendar_events
               WHERE agent_id = $1 AND status != 'cancelled'
               AND (datetime AT TIME ZONE $2)::date = $3::date`;
    if (excludeEventId) {
      sql += ` AND id != $4`;
      params.push(excludeEventId);
    }
    const existing = await conn.query(sql, params);
    for (const row of existing.rows as { id: string; datetime: Date; duration_minutes: number | null }[]) {
      const exStart = new Date(row.datetime);
      const exEnd = eventEnd(exStart, row.duration_minutes ?? 30);
      if (intervalsOverlap(start, end, exStart, exEnd)) {
        return { error: 'Horário já ocupado para outro agendamento' };
      }
    }
  } else {
    const maxPerDay = cfg.maxPatientsPerDay;
    if (maxPerDay != null && maxPerDay > 0) {
      const params: unknown[] = [agentId, tz, eventDateStr];
      let sql = `SELECT COUNT(*) AS c FROM calendar_events
                 WHERE agent_id = $1 AND status != 'cancelled'
                 AND (datetime AT TIME ZONE $2)::date = $3::date`;
      if (excludeEventId) {
        sql += ` AND id != $4`;
        params.push(excludeEventId);
      }
      const countResult = await conn.query(sql, params);
      const count = parseInt(String(countResult.rows[0]?.c ?? 0), 10);
      if (count >= maxPerDay) {
        return { error: `Limite de ${maxPerDay} agendamento(s) por dia já atingido para esta data` };
      }
    }
  }

  return { effectiveDuration };
}

function rowToEvent(row: CalendarEventRow, tz?: string): CalendarEvent {
  const dt = new Date(row.datetime);
  const event: CalendarEvent = {
    id: row.id,
    title: row.title,
    datetime: dt.toISOString(),
    attendee: row.attendee ?? '',
    status: row.status ?? 'confirmed',
    duration: row.duration_minutes ?? undefined,
  };
  if (tz) {
    event.date = getDateInTz(dt, tz);
    event.time = getTimeInTz(dt, tz);
    event.timezone = tz;
  }
  return event;
}

// Formato OpenAI Responses API - tool definitions
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'calendar_create_event',
    description: 'Cria um evento no calendário. OBRIGATÓRIO: você DEVE chamar esta tool ANTES de confirmar qualquer agendamento ao usuário. NUNCA diga "agendado", "marcado" ou "confirmado" sem ter executado esta função e recebido success=true na resposta. Se a tool retornar success=false, repasse o erro ao usuário e ofereça alternativas — não invente que deu certo. Cada janela de atendimento configurada (ex: 09:00–12:00) corresponde a UM agendamento; o `time` informado deve ser o INÍCIO de uma janela retornada por calendar_list_available_slots (a duração é fixada pela janela). Para REMARCAR, use calendar_reschedule_event — nunca cancel+create.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título do evento' },
        date: { type: 'string', description: 'Data no formato YYYY-MM-DD (no fuso do agente)' },
        time: { type: 'string', description: 'Hora de início no formato HH:mm — DEVE ser o `time` exato retornado por calendar_list_available_slots' },
        attendee: { type: 'string', description: 'Email ou nome do participante (use string vazia se não houver)' },
        duration_minutes: { type: 'number', description: 'Duração desejada (em modo slots o backend força a duração da janela; informe o `duration_minutes` retornado por list_available_slots)' },
      },
      required: ['title', 'date', 'time', 'attendee', 'duration_minutes'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'calendar_list_events',
    description: 'Lista os eventos do calendário do agente. Use quando o usuário pedir para ver agendamentos, listar reuniões, etc. Pode filtrar por período e participante.',
    parameters: {
      type: 'object',
      properties: {
        attendee: { type: 'string', description: 'Filtrar por participante (use string vazia para listar todos)' },
        from_date: { type: 'string', description: 'Data inicial YYYY-MM-DD (use vazio para sem filtro)' },
        to_date: { type: 'string', description: 'Data final YYYY-MM-DD (use vazio para sem filtro)' },
      },
      required: ['attendee', 'from_date', 'to_date'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'calendar_cancel_event',
    description: 'Cancela um evento existente. Use quando o usuário pedir para desmarcar. Para REMARCAR (mudar data/hora), prefira calendar_reschedule_event que é atômico.',
    parameters: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'ID do evento a cancelar' },
      },
      required: ['event_id'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'calendar_reschedule_event',
    description: 'Remarca um evento existente para uma nova data/hora de forma atômica (não cria duplicatas se falhar). Use SEMPRE quando o cliente pedir para mudar o horário de um agendamento — nunca use cancel + create separadamente.',
    parameters: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'ID do evento a remarcar' },
        new_date: { type: 'string', description: 'Nova data YYYY-MM-DD (no fuso do agente)' },
        new_time: { type: 'string', description: 'Nova hora HH:mm (24h, no fuso do agente)' },
        new_duration_minutes: { type: 'number', description: 'Nova duração em minutos (use 0 para manter a atual)' },
      },
      required: ['event_id', 'new_date', 'new_time', 'new_duration_minutes'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'calendar_list_available_slots',
    description: 'Lista as janelas de atendimento disponíveis (cada janela = 1 agendamento, com início, fim e duração próprios — ex: 09:00–12:00 é uma janela de 180min). Use ANTES de calendar_create_event para apresentar opções. Ao ofertar ao usuário, mostre o intervalo completo (ex: "quinta às 09:00 (até 12:00)"). Os campos `date`, `time` e `duration_minutes` retornados devem ser passados literalmente para calendar_create_event.',
    parameters: {
      type: 'object',
      properties: {
        from_date: { type: 'string', description: 'Data inicial YYYY-MM-DD (use vazio para hoje)' },
        days_ahead: { type: 'number', description: 'Quantidade de dias à frente (use 7 se não especificado)' },
        limit: { type: 'number', description: 'Máximo de slots a retornar (use 100 se não especificado)' },
      },
      required: ['from_date', 'days_ahead', 'limit'],
      additionalProperties: false,
    },
    strict: true,
  },
];

export const calendarPlugin = {
  id: 'plugin.calendar',

  getTools(): typeof TOOL_DEFINITIONS {
    return TOOL_DEFINITIONS;
  },

  async execute(
    action: string,
    data: Record<string, unknown>,
    _config: Record<string, unknown>,
    context?: PluginExecuteContext
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const agentId = context?.agentId;
    if (!agentId) {
      return { success: false, error: 'Contexto do agente não disponível' };
    }
    const toolCallId = context?.toolCallId;
    switch (action) {
      case 'create_event':
        return this.createEvent(
          agentId,
          data as { title: string; date?: string; time?: string; datetime?: string; attendee?: string; duration_minutes?: number },
          _config,
          toolCallId
        );
      case 'list_events':
        return this.listEvents(agentId, data as { attendee?: string; from_date?: string; to_date?: string }, _config);
      case 'cancel_event':
        return this.cancelEvent(agentId, data as { event_id: string });
      case 'reschedule_event':
        return this.rescheduleEvent(
          agentId,
          data as { event_id: string; new_date: string; new_time: string; new_duration_minutes?: number },
          _config
        );
      case 'list_available_slots':
        return this.listAvailableSlots(agentId, data as { from_date?: string; days_ahead?: number; limit?: number }, _config);
      default:
        return { success: false, error: `Ação desconhecida: ${action}` };
    }
  },

  async createEvent(
    agentId: string,
    data: { title: string; date?: string; time?: string; datetime?: string; attendee?: string; duration_minutes?: number },
    config: Record<string, unknown>,
    toolCallId?: string
  ): Promise<{ success: boolean; data?: CalendarEvent; error?: string }> {
    const cfg = (config.config as CalendarConfig | undefined) ?? {};
    const tz = cfg.timezone ?? TZ_DEFAULT;
    const durationMinutes = data.duration_minutes ?? cfg.defaultSlotDurationMinutes ?? 30;
    const attendee = data.attendee ?? '';

    const resolved = resolveEventDatetime(data, tz);
    if (!resolved.ok) return { success: false, error: resolved.error };
    const datetime = resolved.datetime;

    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      await lockAgentForCalendar(conn, agentId);

      // Idempotência: se já existe evento ativo com este (agent_id, tool_call_id), retorna o existente.
      if (toolCallId) {
        const dup = await conn.query(
          `SELECT id, agent_id, title, datetime, attendee, status, duration_minutes, created_at, updated_at
           FROM calendar_events
           WHERE agent_id = $1 AND tool_call_id = $2`,
          [agentId, toolCallId]
        );
        if (dup.rows.length > 0) {
          await conn.query('COMMIT');
          return { success: true, data: rowToEvent(dup.rows[0] as CalendarEventRow, tz) };
        }
      }

      const validation = await validateAgainstConfig(conn, agentId, datetime, durationMinutes, cfg);
      if (validation.error) {
        await conn.query('ROLLBACK');
        return { success: false, error: validation.error };
      }
      const finalDuration = validation.effectiveDuration ?? durationMinutes;

      const id = uuidv4();
      try {
        await conn.query(
          `INSERT INTO calendar_events (id, agent_id, title, datetime, attendee, status, duration_minutes, tool_call_id)
           VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7)`,
          [id, agentId, data.title, datetime.toISOString(), attendee, finalDuration, toolCallId ?? null]
        );
      } catch (err: unknown) {
        await conn.query('ROLLBACK');
        const code = (err as { code?: string }).code;
        if (code === '23505') {
          return { success: false, error: 'Horário já ocupado para outro agendamento' };
        }
        throw err;
      }

      await conn.query('COMMIT');

      return {
        success: true,
        data: {
          id,
          title: data.title,
          datetime: datetime.toISOString(),
          attendee,
          status: 'confirmed',
          duration: finalDuration,
          date: getDateInTz(datetime, tz),
          time: getTimeInTz(datetime, tz),
          timezone: tz,
        },
      };
    } catch (err: unknown) {
      try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    } finally {
      conn.release();
    }
  },

  async rescheduleEvent(
    agentId: string,
    data: { event_id: string; new_date: string; new_time: string; new_duration_minutes?: number },
    config: Record<string, unknown>
  ): Promise<{ success: boolean; data?: CalendarEvent; error?: string }> {
    const cfg = (config.config as CalendarConfig | undefined) ?? {};
    const tz = cfg.timezone ?? TZ_DEFAULT;

    if (!data.event_id) return { success: false, error: 'event_id é obrigatório' };
    if (!isValidDateStr(data.new_date)) return { success: false, error: 'new_date inválido (use YYYY-MM-DD)' };
    if (!isValidTimeStr(data.new_time)) return { success: false, error: 'new_time inválido (use HH:mm)' };

    const newDatetime = buildDateInTz(data.new_date, data.new_time, tz);
    if (isNaN(newDatetime.getTime())) {
      return { success: false, error: 'Data/hora inválida' };
    }

    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      await lockAgentForCalendar(conn, agentId);

      const existing = await conn.query(
        `SELECT id, agent_id, title, datetime, attendee, status, duration_minutes, created_at, updated_at
         FROM calendar_events
         WHERE id = $1 AND agent_id = $2
         FOR UPDATE`,
        [data.event_id, agentId]
      );
      if (existing.rows.length === 0) {
        await conn.query('ROLLBACK');
        return { success: false, error: 'Evento não encontrado' };
      }
      const current = existing.rows[0] as CalendarEventRow;
      if (current.status === 'cancelled') {
        await conn.query('ROLLBACK');
        return { success: false, error: 'Evento já está cancelado — crie um novo em vez de remarcar' };
      }

      const newDuration = data.new_duration_minutes && data.new_duration_minutes > 0
        ? data.new_duration_minutes
        : (current.duration_minutes ?? 30);

      const validation = await validateAgainstConfig(conn, agentId, newDatetime, newDuration, cfg, data.event_id);
      if (validation.error) {
        await conn.query('ROLLBACK');
        return { success: false, error: validation.error };
      }
      const finalDuration = validation.effectiveDuration ?? newDuration;

      try {
        await conn.query(
          `UPDATE calendar_events
           SET datetime = $1, duration_minutes = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3 AND agent_id = $4`,
          [newDatetime.toISOString(), finalDuration, data.event_id, agentId]
        );
      } catch (err: unknown) {
        await conn.query('ROLLBACK');
        const code = (err as { code?: string }).code;
        if (code === '23505') {
          return { success: false, error: 'Horário já ocupado para outro agendamento' };
        }
        throw err;
      }

      await conn.query('COMMIT');

      return {
        success: true,
        data: {
          id: current.id,
          title: current.title,
          datetime: newDatetime.toISOString(),
          attendee: current.attendee ?? '',
          status: current.status,
          duration: finalDuration,
          date: getDateInTz(newDatetime, tz),
          time: getTimeInTz(newDatetime, tz),
          timezone: tz,
        },
      };
    } catch (err: unknown) {
      try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    } finally {
      conn.release();
    }
  },

  async listEvents(
    agentId: string,
    data: { attendee?: string; from_date?: string; to_date?: string },
    config: Record<string, unknown>
  ): Promise<{ success: boolean; data?: CalendarEvent[]; error?: string }> {
    try {
      const cfg = (config.config as CalendarConfig | undefined) ?? {};
      const tz = cfg.timezone ?? TZ_DEFAULT;
      let sql = `SELECT id, agent_id, title, datetime, attendee, status, duration_minutes, created_at, updated_at
                 FROM calendar_events WHERE agent_id = $1`;
      const params: unknown[] = [agentId];
      let idx = 2;
      if (data.attendee) {
        sql += ` AND attendee = $${idx}`;
        params.push(data.attendee);
        idx++;
      }
      if (data.from_date) {
        sql += ` AND (datetime AT TIME ZONE $${idx})::date >= $${idx + 1}::date`;
        params.push(tz, data.from_date);
        idx += 2;
      }
      if (data.to_date) {
        sql += ` AND (datetime AT TIME ZONE $${idx})::date <= $${idx + 1}::date`;
        params.push(tz, data.to_date);
        idx += 2;
      }
      sql += ` ORDER BY datetime ASC`;
      const result = await query(sql, params);
      const events = result.rows.map((row: CalendarEventRow) => rowToEvent(row, tz));
      return { success: true, data: events };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  },

  async cancelEvent(agentId: string, data: { event_id: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await query(
        `UPDATE calendar_events SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND agent_id = $2 AND status != 'cancelled'`,
        [data.event_id, agentId]
      );
      if ((result.rowCount ?? 0) === 0) {
        return { success: false, error: 'Evento não encontrado ou já cancelado' };
      }
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  },

  async listAvailableSlots(
    agentId: string,
    data: { from_date?: string; days_ahead?: number; limit?: number },
    config: Record<string, unknown>
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    try {
      const cfg = (config.config as CalendarConfig | undefined) ?? {};
      const tz = cfg.timezone ?? TZ_DEFAULT;
      const minAdvance = cfg.minAdvanceDays ?? 0;
      const maxAdvance = cfg.maxAdvanceDays ?? 30;
      const mode = cfg.schedulingMode ?? 'slots';
      const todayStr = getDateInTz(new Date(), tz);
      const fromDateStr = (data.from_date != null && String(data.from_date).trim()) ? String(data.from_date).trim() : todayStr;
      const daysAhead = Math.min(Math.max((data.days_ahead == null || data.days_ahead === 0) ? 7 : data.days_ahead, 1), 90);
      const limit = (data.limit == null || data.limit === 0) ? 100 : data.limit;

      const slotsOut: Array<{ date: string; time: string; end_time: string; duration_minutes: number; timezone: string }> = [];
      const filaOut: Array<{ date: string; slots_remaining: number; timezone: string }> = [];
      const today = new Date(todayStr + 'T12:00:00.000Z');
      const fromDate = new Date(fromDateStr + 'T12:00:00.000Z');

      for (let d = 0; d < daysAhead && (mode !== 'slots' || slotsOut.length < limit); d++) {
        const iterDate = new Date(fromDate.getTime());
        iterDate.setUTCDate(iterDate.getUTCDate() + d);
        const dateStr = getDateInTz(iterDate, tz);
        const daysDiff = Math.floor((iterDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
        if (daysDiff < minAdvance || daysDiff > maxAdvance) continue;

        if (mode === 'slots') {
          const weekday = getWeekdayInTz(iterDate, tz);
          const daySlots = cfg.daySlots?.[weekday];
          if (!daySlots || daySlots.length === 0) continue;
          const existing = await query(
            `SELECT datetime, duration_minutes FROM calendar_events
             WHERE agent_id = $1 AND status != 'cancelled'
             AND (datetime AT TIME ZONE $2)::date = $3::date`,
            [agentId, tz, dateStr]
          );
          const existingRanges = (existing.rows as { datetime: Date; duration_minutes: number | null }[]).map((row) => {
            const start = new Date(row.datetime);
            const end = eventEnd(start, row.duration_minutes ?? 30);
            return { start, end };
          });
          // Cada janela {start, end} configurada vira UM slot agendável (1 atendimento de
          // duração = end - start). Não fatiamos a janela em sub-slots.
          for (const slot of daySlots) {
            const slotDuration = diffMinutes(slot.start, slot.end);
            if (slotDuration <= 0) continue;
            const slotStartDate = buildDateInTz(dateStr, slot.start, tz);
            const slotEndDate = eventEnd(slotStartDate, slotDuration);
            const occupied = existingRanges.some((r) => intervalsOverlap(slotStartDate, slotEndDate, r.start, r.end));
            if (!occupied) {
              slotsOut.push({
                date: dateStr,
                time: slot.start,
                end_time: slot.end,
                duration_minutes: slotDuration,
                timezone: tz,
              });
              if (slotsOut.length >= limit) break;
            }
          }
        } else {
          const maxPerDay = cfg.maxPatientsPerDay ?? 0;
          if (maxPerDay <= 0) continue;
          const countResult = await query(
            `SELECT COUNT(*) AS c FROM calendar_events
             WHERE agent_id = $1 AND status != 'cancelled'
             AND (datetime AT TIME ZONE $2)::date = $3::date`,
            [agentId, tz, dateStr]
          );
          const count = parseInt(String(countResult.rows[0]?.c ?? 0), 10);
          const remaining = Math.max(0, maxPerDay - count);
          if (remaining > 0) {
            filaOut.push({ date: dateStr, slots_remaining: remaining, timezone: tz });
          }
        }
      }

      const dataOut = mode === 'slots'
        ? { slots: slotsOut, timezone: tz }
        : { days: filaOut, timezone: tz };
      return { success: true, data: dataOut };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  },
};

export default calendarPlugin;
