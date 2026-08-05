import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import {
  CreateEventDto,
  ImportEventsDto,
  RecurrenceDto,
  UpdateEventDto,
} from './dto/calendar.dto';

/**
 * Calendar's events.
 *
 * Why this exists (brief 72): the add-on persisted through zustand to
 * `localStorage`, so the user's calendar lived in whichever *browser* opened the
 * OS — empty from a second machine, outside the documented home-volume backup, and
 * stomped by a second tab on the same origin. This is the fifth app to persist
 * here, and it deliberately copies the shape brief 71 landed for Clock rather than
 * inventing a second mechanism: a typed table per domain, camelCase mapped at the
 * service boundary, class-validator DTOs at the door, and the global
 * `SessionAuthGuard` covering the controller.
 *
 * **Recurrence is stored as a rule, never as materialised instances.** A weekly
 * standup is one row. Expanding it into 520 rows is the mistake that makes editing
 * a series intractable — "this and following" stops having any meaning — so the
 * expansion happens in the client for the range it is painting (see
 * `recurrence.ts` in the add-on). That is also why this module has no
 * "occurrences" endpoint: the window being painted is a client concern, and a
 * server that expanded them would have to agree with the client about the
 * viewer's local time, which it cannot.
 *
 * Times are epoch ms with **local-time semantics** — the same wall-clock reading
 * the viewer sees, with no timezone conversion anywhere. A per-event timezone is
 * out of scope for the brief, and adding one later means adding a column, not
 * reinterpreting these.
 */

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  byWeekday?: number[];
  until?: string;
  count?: number;
}

export interface CalendarEvent {
  id: number;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  notes?: string;
  color?: string;
  reminderMinutes?: number;
  recurrence: Recurrence | null;
  exceptions: string[];
}

interface EventRow {
  id: number;
  title: string;
  start_ms: number;
  end_ms: number;
  all_day: number;
  notes: string | null;
  color: string | null;
  reminder_minutes: number | null;
  rrule_freq: string | null;
  rrule_interval: number | null;
  rrule_by_weekday: string | null;
  rrule_until: string | null;
  rrule_count: number | null;
  exceptions: string;
}

/** Comma-joined because neither an ISO date nor a weekday index can contain a comma. */
function splitList(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').filter((part) => part !== '');
}

function toEvent(row: EventRow): CalendarEvent {
  const recurrence: Recurrence | null = row.rrule_freq
    ? {
        freq: row.rrule_freq as Recurrence['freq'],
        interval: row.rrule_interval ?? 1,
        ...(row.rrule_by_weekday
          ? { byWeekday: splitList(row.rrule_by_weekday).map(Number) }
          : {}),
        ...(row.rrule_until ? { until: row.rrule_until } : {}),
        ...(row.rrule_count !== null ? { count: row.rrule_count } : {}),
      }
    : null;

  return {
    id: row.id,
    title: row.title,
    start: row.start_ms,
    end: row.end_ms,
    allDay: row.all_day === 1,
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.color ? { color: row.color } : {}),
    ...(row.reminder_minutes !== null
      ? { reminderMinutes: row.reminder_minutes }
      : {}),
    recurrence,
    exceptions: splitList(row.exceptions),
  };
}

/** The recurrence half of an INSERT/UPDATE, flattened to columns. */
function recurrenceValues(recurrence: RecurrenceDto | null | undefined) {
  if (!recurrence) {
    return {
      rrule_freq: null,
      rrule_interval: null,
      rrule_by_weekday: null,
      rrule_until: null,
      rrule_count: null,
    };
  }
  return {
    rrule_freq: recurrence.freq,
    rrule_interval: recurrence.interval,
    rrule_by_weekday: recurrence.byWeekday?.length
      ? recurrence.byWeekday.join(',')
      : null,
    rrule_until: recurrence.until ?? null,
    rrule_count: recurrence.count ?? null,
  };
}

const SELECT_COLUMNS = `id, title, start_ms, end_ms, all_day, notes, color,
       reminder_minutes, rrule_freq, rrule_interval, rrule_by_weekday,
       rrule_until, rrule_count, exceptions`;

@Injectable()
export class CalendarService {
  constructor(private readonly db: DbService) {}

  /**
   * Every event, ordered by start.
   *
   * Deliberately unfiltered: a recurring event that started years ago is still
   * relevant to this month, so a naive `WHERE start_ms BETWEEN …` would hide
   * exactly the events the user most expects to see. The row count for a personal
   * calendar is small, and the client expands only the visible window.
   */
  findAll(): CalendarEvent[] {
    const rows = this.db.db
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM calendar_events ORDER BY start_ms ASC, id ASC`,
      )
      .all() as EventRow[];
    return rows.map(toEvent);
  }

  create(dto: CreateEventDto): CalendarEvent {
    const info = this.insert(dto);
    return this.get(Number(info));
  }

  private insert(dto: CreateEventDto): number | bigint {
    const info = this.db.db
      .prepare(
        `INSERT INTO calendar_events (
           title, start_ms, end_ms, all_day, notes, color, reminder_minutes,
           rrule_freq, rrule_interval, rrule_by_weekday, rrule_until, rrule_count,
           exceptions
         ) VALUES (
           @title, @start_ms, @end_ms, @all_day, @notes, @color, @reminder_minutes,
           @rrule_freq, @rrule_interval, @rrule_by_weekday, @rrule_until, @rrule_count,
           @exceptions
         )`,
      )
      .run({
        title: dto.title,
        start_ms: dto.start,
        end_ms: dto.end,
        all_day: dto.allDay ? 1 : 0,
        notes: dto.notes ?? null,
        color: dto.color ?? null,
        reminder_minutes: dto.reminderMinutes ?? null,
        ...recurrenceValues(dto.recurrence),
        exceptions: (dto.exceptions ?? []).join(','),
      });
    return info.lastInsertRowid;
  }

  update(id: number, dto: UpdateEventDto): CalendarEvent {
    const existing = this.db.db
      .prepare('SELECT id FROM calendar_events WHERE id = ?')
      .get(id);
    if (!existing) throw new NotFoundException(`Event ${id} not found`);

    const fields: string[] = [];
    const values: Record<string, unknown> = { id };

    const set = (column: string, key: string, value: unknown) => {
      fields.push(`${column} = @${key}`);
      values[key] = value;
    };

    if (dto.title !== undefined) set('title', 'title', dto.title);
    if (dto.start !== undefined) set('start_ms', 'start_ms', dto.start);
    if (dto.end !== undefined) set('end_ms', 'end_ms', dto.end);
    if (dto.allDay !== undefined) set('all_day', 'all_day', dto.allDay ? 1 : 0);
    // `null` clears these, so they check `undefined` rather than falsiness — an
    // empty note and "no note" must both be expressible.
    if (dto.notes !== undefined) set('notes', 'notes', dto.notes ?? null);
    if (dto.color !== undefined) set('color', 'color', dto.color ?? null);
    if (dto.reminderMinutes !== undefined)
      set('reminder_minutes', 'reminder_minutes', dto.reminderMinutes ?? null);
    if (dto.exceptions !== undefined)
      set('exceptions', 'exceptions', dto.exceptions.join(','));

    if (dto.recurrence !== undefined) {
      // All five columns move together: a rule is one value spread over columns,
      // and patching a subset would leave, say, a BYDAY from the old rule.
      const recurrence = recurrenceValues(dto.recurrence);
      for (const [column, value] of Object.entries(recurrence)) {
        set(column, column, value);
      }
    }

    if (fields.length > 0) {
      fields.push('updated_at = CURRENT_TIMESTAMP');
      this.db.db
        .prepare(
          `UPDATE calendar_events SET ${fields.join(', ')} WHERE id = @id`,
        )
        .run(values);
    }
    return this.get(id);
  }

  remove(id: number): void {
    const info = this.db.db
      .prepare('DELETE FROM calendar_events WHERE id = ?')
      .run(id);
    if (info.changes === 0) {
      throw new NotFoundException(`Event ${id} not found`);
    }
  }

  private get(id: number): CalendarEvent {
    const row = this.db.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM calendar_events WHERE id = ?`)
      .get(id) as EventRow;
    return toEvent(row);
  }

  /**
   * Bulk insert, in one transaction.
   *
   * Serves two callers with one endpoint because they want identical behaviour
   * apart from the guard: the one-time `localStorage` migration passes
   * `onlyIfEmpty` so two tabs opening together cannot produce two copies of every
   * event, and an ICS import does not (importing a file into a calendar that
   * already has events is the normal case, not a mistake).
   */
  importEvents(dto: ImportEventsDto): {
    imported: number;
    skipped: 'not-empty' | null;
  } {
    const run = this.db.db.transaction(() => {
      if (dto.onlyIfEmpty) {
        const row = this.db.db
          .prepare('SELECT COUNT(*) AS n FROM calendar_events')
          .get() as { n: number };
        if (row.n > 0) return { imported: 0, skipped: 'not-empty' as const };
      }
      let imported = 0;
      for (const event of dto.events) {
        this.insert(event);
        imported++;
      }
      return { imported, skipped: null };
    });
    return run();
  }
}
