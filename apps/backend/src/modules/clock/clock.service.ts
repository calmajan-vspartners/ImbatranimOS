import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import {
  CreateAlarmDto,
  CreateWorldClockDto,
  ImportClockStateDto,
  UpdateAlarmDto,
} from './dto/clock.dto';

/**
 * Clock's persisted state: world clocks and alarms.
 *
 * Why this exists (brief 71, shared with Calendar/brief 72): the add-on used to
 * persist through zustand to `localStorage`, which put the user's alarms in
 * whichever *browser* opened the OS. That contradicts "the computer is the
 * container" — the data was outside the home volume the documented backup
 * covers, and two tabs on one origin stomped each other. Todo, Sticky Notes and
 * Bookmarks already persist here; this is the fourth app to follow, not a new
 * mechanism, which is exactly why no generic key-value blob store was invented
 * for it: a typed table per domain is what the codebase already does, and it is
 * what lets the DTOs reject a malformed alarm time at the door.
 *
 * The stopwatch and the countdown timers deliberately do NOT live here. They are
 * session state — a running countdown must not resurrect after a reload, and
 * nobody expects to find yesterday's stopwatch.
 *
 * Unlike the older modules (`sticky_notes`, `todos`) this one maps rows to
 * camelCase at the service boundary instead of leaking `snake_case` column names
 * into the API and then into React props. New surface, so it starts clean; the
 * older modules keep their shape because changing them is a client-visible break
 * with no user-facing gain.
 */

export interface WorldClock {
  id: number;
  label: string;
  timeZone: string;
}

export interface Alarm {
  id: number;
  label: string;
  /** 24h "HH:mm", in the *viewer's* local wall-clock time. */
  time: string;
  enabled: boolean;
  /** 7-char '0'/'1' weekday mask, Monday-first. All zeros = fires once. */
  days: string;
  lastFiredAt: string | null;
  /** Epoch ms, or null. */
  snoozedUntil: number | null;
}

/** Raw row shapes, so the mapping functions are honest about the cast. */
interface WorldClockRow {
  id: number;
  label: string;
  time_zone: string;
}

interface AlarmRow {
  id: number;
  label: string;
  time_of_day: string;
  enabled: number;
  days: string;
  last_fired_at: string | null;
  snoozed_until: number | null;
}

const NO_REPEAT = '0000000';

function toWorldClock(row: WorldClockRow): WorldClock {
  return { id: row.id, label: row.label, timeZone: row.time_zone };
}

function toAlarm(row: AlarmRow): Alarm {
  return {
    id: row.id,
    label: row.label,
    time: row.time_of_day,
    enabled: row.enabled === 1,
    days: row.days,
    lastFiredAt: row.last_fired_at,
    snoozedUntil: row.snoozed_until,
  };
}

@Injectable()
export class ClockService {
  constructor(private readonly db: DbService) {}

  // --- world clocks ---------------------------------------------------------

  findWorldClocks(): WorldClock[] {
    const rows = this.db.db
      .prepare(
        'SELECT id, label, time_zone FROM clock_world_clocks ORDER BY id ASC',
      )
      .all() as WorldClockRow[];
    return rows.map(toWorldClock);
  }

  createWorldClock(dto: CreateWorldClockDto): WorldClock {
    const info = this.db.db
      .prepare(
        'INSERT INTO clock_world_clocks (label, time_zone) VALUES (@label, @timeZone)',
      )
      .run({ label: dto.label, timeZone: dto.timeZone });
    return this.getWorldClock(Number(info.lastInsertRowid));
  }

  removeWorldClock(id: number): void {
    const info = this.db.db
      .prepare('DELETE FROM clock_world_clocks WHERE id = ?')
      .run(id);
    if (info.changes === 0) {
      throw new NotFoundException(`World clock ${id} not found`);
    }
  }

  private getWorldClock(id: number): WorldClock {
    const row = this.db.db
      .prepare(
        'SELECT id, label, time_zone FROM clock_world_clocks WHERE id = ?',
      )
      .get(id) as WorldClockRow;
    return toWorldClock(row);
  }

  // --- alarms ---------------------------------------------------------------

  /** Sorted by time of day, which is the order the Alarms tab reads best in. */
  findAlarms(): Alarm[] {
    const rows = this.db.db
      .prepare(
        `SELECT id, label, time_of_day, enabled, days, last_fired_at, snoozed_until
           FROM clock_alarms ORDER BY time_of_day ASC, id ASC`,
      )
      .all() as AlarmRow[];
    return rows.map(toAlarm);
  }

  createAlarm(dto: CreateAlarmDto): Alarm {
    const info = this.db.db
      .prepare(
        `INSERT INTO clock_alarms (label, time_of_day, days)
         VALUES (@label, @time, @days)`,
      )
      .run({
        label: dto.label ?? '',
        time: dto.time,
        days: dto.days ?? NO_REPEAT,
      });
    return this.getAlarm(Number(info.lastInsertRowid));
  }

  updateAlarm(id: number, dto: UpdateAlarmDto): Alarm {
    const existing = this.db.db
      .prepare('SELECT id FROM clock_alarms WHERE id = ?')
      .get(id);
    if (!existing) throw new NotFoundException(`Alarm ${id} not found`);

    const fields: string[] = [];
    const values: Record<string, unknown> = { id };

    if (dto.label !== undefined) {
      fields.push('label = @label');
      values.label = dto.label;
    }
    if (dto.time !== undefined) {
      fields.push('time_of_day = @time');
      values.time = dto.time;
    }
    if (dto.enabled !== undefined) {
      fields.push('enabled = @enabled');
      values.enabled = dto.enabled ? 1 : 0;
    }
    if (dto.days !== undefined) {
      fields.push('days = @days');
      values.days = dto.days;
    }
    // `null` is a meaningful value for both of these — "never fired" and "not
    // snoozed" — so they check for `undefined`, not falsiness.
    if (dto.lastFiredAt !== undefined) {
      fields.push('last_fired_at = @lastFiredAt');
      values.lastFiredAt = dto.lastFiredAt;
    }
    if (dto.snoozedUntil !== undefined) {
      fields.push('snoozed_until = @snoozedUntil');
      values.snoozedUntil = dto.snoozedUntil;
    }

    if (fields.length > 0) {
      this.db.db
        .prepare(`UPDATE clock_alarms SET ${fields.join(', ')} WHERE id = @id`)
        .run(values);
    }
    return this.getAlarm(id);
  }

  removeAlarm(id: number): void {
    const info = this.db.db
      .prepare('DELETE FROM clock_alarms WHERE id = ?')
      .run(id);
    if (info.changes === 0) {
      throw new NotFoundException(`Alarm ${id} not found`);
    }
  }

  private getAlarm(id: number): Alarm {
    const row = this.db.db
      .prepare(
        `SELECT id, label, time_of_day, enabled, days, last_fired_at, snoozed_until
           FROM clock_alarms WHERE id = ?`,
      )
      .get(id) as AlarmRow;
    return toAlarm(row);
  }

  // --- one-time localStorage hand-over --------------------------------------

  /**
   * Adopt a browser's old `localStorage` clock state, once.
   *
   * Per-table and guarded on emptiness, inside one transaction: whoever gets
   * there first wins, so two tabs loading at the same moment cannot produce two
   * copies of every alarm. Imported alarms are given the `Every day` mask
   * because that is what they actually did before repeat existed — an alarm that
   * used to ring daily must not quietly become a one-shot.
   */
  importState(dto: ImportClockStateDto): {
    imported: boolean;
    worldClocks: number;
    alarms: number;
  } {
    const run = this.db.db.transaction(() => {
      let worldClocks = 0;
      let alarms = 0;

      const clockCount = this.count('clock_world_clocks');
      if (clockCount === 0 && dto.worldClocks?.length) {
        const insert = this.db.db.prepare(
          'INSERT INTO clock_world_clocks (label, time_zone) VALUES (?, ?)',
        );
        for (const w of dto.worldClocks) {
          insert.run(w.label, w.timeZone);
          worldClocks++;
        }
      }

      const alarmCount = this.count('clock_alarms');
      if (alarmCount === 0 && dto.alarms?.length) {
        const insert = this.db.db.prepare(
          `INSERT INTO clock_alarms (label, time_of_day, enabled, days)
           VALUES (?, ?, ?, ?)`,
        );
        for (const a of dto.alarms) {
          insert.run(
            a.label ?? '',
            a.time,
            a.enabled === false ? 0 : 1,
            a.days ?? '1111111',
          );
          alarms++;
        }
      }

      return {
        imported: worldClocks + alarms > 0,
        worldClocks,
        alarms,
      };
    });
    return run();
  }

  private count(table: 'clock_world_clocks' | 'clock_alarms'): number {
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .get() as { n: number };
    return row.n;
  }
}
