// Plugin Calendário: agendar, listar e cancelar eventos (persistência em calendar_events)

import { query } from '../../db/postgres';
import { v4 as uuidv4 } from 'uuid';
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

function rowToEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    datetime: new Date(row.datetime).toISOString(),
    attendee: row.attendee ?? '',
    status: row.status ?? 'confirmed',
    duration: row.duration_minutes ?? undefined,
  };
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

/** Approximate offset (ms) of timezone from UTC for a given date (at noon UTC that day). */
function getOffsetMsForDate(dateStr: string, tz: string): number {
  const noonUtc = new Date(dateStr + 'T12:00:00.000Z');
  const inTz = new Date(noonUtc.toLocaleString('en-US', { timeZone: tz }));
  return noonUtc.getTime() - inTz.getTime();
}

/** Build a Date for YYYY-MM-DD and HH:mm in the given IANA timezone. */
function buildDateInTz(dateStr: string, timeStr: string, tz: string): Date {
  const localNaive = new Date(dateStr + 'T' + timeStr + ':00.000Z').getTime();
  const offsetMs = getOffsetMsForDate(dateStr, tz);
  return new Date(localNaive + offsetMs);
}

// Formato OpenAI Responses API - tool definitions
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'calendar_create_event',
    description: 'Cria um evento no calendário. Valida slot disponível e evita conflitos. Use quando o usuário pedir para agendar, marcar reunião, lembrete, etc. Prefira calendar_list_available_slots para sugerir horários.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título do evento' },
        datetime: { type: 'string', description: 'Data e hora em ISO 8601 (no fuso do agente ou UTC)' },
        attendee: { type: 'string', description: 'Email ou nome do participante (use string vazia se não houver)' },
        duration_minutes: { type: 'number', description: 'Duração em minutos (use 30 se o usuário não especificar)' },
      },
      required: ['title', 'datetime', 'attendee', 'duration_minutes'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'calendar_list_events',
    description: 'Lista os eventos do calendário. Use quando o usuário pedir para ver agendamentos, listar reuniões, etc. Pode filtrar por período e participante.',
    parameters: {
      type: 'object',
      properties: {
        attendee: { type: 'string', description: 'Filtrar por participante (use string vazia para listar todos)' },
        from_date: { type: 'string', description: 'Data inicial ISO YYYY-MM-DD (use vazio para sem filtro)' },
        to_date: { type: 'string', description: 'Data final ISO YYYY-MM-DD (use vazio para sem filtro)' },
      },
      required: ['attendee', 'from_date', 'to_date'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'calendar_cancel_event',
    description: 'Cancela um evento no calendário. Use quando o usuário pedir para cancelar, desmarcar um agendamento.',
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
    name: 'calendar_list_available_slots',
    description: 'Lista horários disponíveis para agendamento nos próximos dias. Use para sugerir datas/horários ao usuário antes de criar o evento.',
    parameters: {
      type: 'object',
      properties: {
        from_date: { type: 'string', description: 'Data inicial ISO YYYY-MM-DD (use vazio para hoje)' },
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
    switch (action) {
      case 'create_event':
        return this.createEvent(agentId, data as { title: string; datetime: string; attendee?: string; duration_minutes?: number }, _config);
      case 'list_events':
        return this.listEvents(agentId, data as { attendee?: string; from_date?: string; to_date?: string }, _config);
      case 'cancel_event':
        return this.cancelEvent(agentId, data as { event_id: string });
      case 'list_available_slots':
        return this.listAvailableSlots(agentId, data as { from_date?: string; days_ahead?: number; limit?: number }, _config);
      default:
        return { success: false, error: `Ação desconhecida: ${action}` };
    }
  },

  async createEvent(
    agentId: string,
    data: { title: string; datetime: string; attendee?: string; duration_minutes?: number },
    config: Record<string, unknown>
  ): Promise<{ success: boolean; data?: CalendarEvent; error?: string }> {
    try {
      const calendarConfig = (config.config as CalendarConfig | undefined) ?? {};
      const tz = calendarConfig.timezone ?? TZ_DEFAULT;
      const durationMinutes = data.duration_minutes ?? calendarConfig.defaultSlotDurationMinutes ?? 30;
      const attendee = data.attendee ?? '';
      const datetime = new Date(data.datetime);
      if (isNaN(datetime.getTime())) {
        return { success: false, error: 'Data/hora inválida' };
      }

      const eventDateStr = getDateInTz(datetime, tz);
      const todayStr = getDateInTz(new Date(), tz);
      const minAdvance = calendarConfig.minAdvanceDays ?? 0;
      const maxAdvance = calendarConfig.maxAdvanceDays ?? 30;
      const today = new Date(todayStr);
      const eventDate = new Date(eventDateStr);
      const daysDiff = Math.floor((eventDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      if (daysDiff < minAdvance) {
        return { success: false, error: `Agendamento só permitido com pelo menos ${minAdvance} dia(s) de antecedência` };
      }
      if (daysDiff > maxAdvance) {
        return { success: false, error: `Agendamento só permitido até ${maxAdvance} dias à frente` };
      }

      const mode = calendarConfig.schedulingMode ?? 'slots';
      if (mode === 'slots') {
        const weekday = getWeekdayInTz(datetime, tz);
        const slots = calendarConfig.daySlots?.[weekday];
        if (!slots || slots.length === 0) {
          return { success: false, error: `Não há horários configurados para ${weekday}` };
        }
        const time = getTimeInTz(datetime, tz);
        const inAny = slots.some((slot) => timeInSlot(time, slot));
        if (!inAny) {
          return { success: false, error: 'O horário não está dentro dos slots disponíveis para esse dia' };
        }

        const start = datetime;
        const end = eventEnd(datetime, durationMinutes);
        const existing = await query(
          `SELECT datetime, duration_minutes FROM calendar_events
           WHERE agent_id = $1 AND status != 'cancelled'
           AND (datetime AT TIME ZONE $2)::date = $3::date`,
          [agentId, tz, eventDateStr]
        );
        for (const row of existing.rows as { datetime: Date; duration_minutes: number | null }[]) {
          const exStart = new Date(row.datetime);
          const exEnd = eventEnd(exStart, row.duration_minutes ?? 30);
          if (intervalsOverlap(start, end, exStart, exEnd)) {
            return { success: false, error: 'Horário já ocupado para outro agendamento' };
          }
        }
      } else {
        const maxPerDay = calendarConfig.maxPatientsPerDay;
        if (maxPerDay != null && maxPerDay > 0) {
          const countResult = await query(
            `SELECT COUNT(*) AS c FROM calendar_events
             WHERE agent_id = $1 AND status != 'cancelled'
             AND (datetime AT TIME ZONE $2)::date = $3::date`,
            [agentId, tz, eventDateStr]
          );
          const count = parseInt(String(countResult.rows[0]?.c ?? 0), 10);
          if (count >= maxPerDay) {
            return { success: false, error: `Limite de ${maxPerDay} agendamento(s) por dia já atingido para esta data` };
          }
        }
      }

      const id = uuidv4();
      await query(
        `INSERT INTO calendar_events (id, agent_id, title, datetime, attendee, status, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', $6)`,
        [id, agentId, data.title, data.datetime, attendee, durationMinutes]
      );
      const event: CalendarEvent = {
        id,
        title: data.title,
        datetime: datetime.toISOString(),
        attendee,
        status: 'confirmed',
        duration: durationMinutes,
      };
      return { success: true, data: event };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  },

  async listEvents(
    agentId: string,
    data: { attendee?: string; from_date?: string; to_date?: string },
    config: Record<string, unknown>
  ): Promise<{ success: boolean; data?: CalendarEvent[]; error?: string }> {
    try {
      const calendarConfig = (config.config as CalendarConfig | undefined) ?? {};
      const tz = calendarConfig.timezone ?? TZ_DEFAULT;
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
      const events = result.rows.map((row: CalendarEventRow) => rowToEvent(row));
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
         WHERE id = $1 AND agent_id = $2`,
        [data.event_id, agentId]
      );
      if ((result.rowCount ?? 0) === 0) {
        return { success: false, error: 'Evento não encontrado' };
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
      const calendarConfig = (config.config as CalendarConfig | undefined) ?? {};
      const tz = calendarConfig.timezone ?? TZ_DEFAULT;
      const minAdvance = calendarConfig.minAdvanceDays ?? 0;
      const maxAdvance = calendarConfig.maxAdvanceDays ?? 30;
      const mode = calendarConfig.schedulingMode ?? 'slots';
      const durationMinutes = calendarConfig.defaultSlotDurationMinutes ?? 30;
      const todayStr = getDateInTz(new Date(), tz);
      const fromDateStr = (data.from_date != null && String(data.from_date).trim()) ? String(data.from_date).trim() : todayStr;
      const daysAhead = Math.min(Math.max((data.days_ahead == null || data.days_ahead === 0) ? 7 : data.days_ahead, 1), 90);
      const limit = (data.limit == null || data.limit === 0) ? 100 : data.limit;

      const slotsOut: Array<{ date: string; time: string; timezone: string; datetime_iso?: string }> = [];
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
          const daySlots = calendarConfig.daySlots?.[weekday];
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
          for (const slot of daySlots) {
            let time = slot.start;
            while (compareTime(time, slot.end) < 0) {
              const slotEnd = addMinutesToTime(time, durationMinutes);
              if (compareTime(slotEnd, slot.end) > 0) break;
              const slotStartDate = buildDateInTz(dateStr, time, tz);
              const slotEndDate = eventEnd(slotStartDate, durationMinutes);
              const occupied = existingRanges.some((r) => intervalsOverlap(slotStartDate, slotEndDate, r.start, r.end));
              if (!occupied) {
                slotsOut.push({
                  date: dateStr,
                  time,
                  timezone: tz,
                  datetime_iso: slotStartDate.toISOString(),
                });
                if (slotsOut.length >= limit) break;
              }
              time = slotEnd;
            }
          }
        } else {
          const maxPerDay = calendarConfig.maxPatientsPerDay ?? 0;
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
