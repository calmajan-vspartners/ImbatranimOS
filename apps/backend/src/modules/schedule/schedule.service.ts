import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import type { ScheduleDomain } from './dto/claim.dto';

/** Claims older than this are dedupe state nobody will ask about again. */
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The durable half of the reminder scheduler (brief 93).
 *
 * Occurrence *computation* stays in the browser — alarm times and calendar
 * instants have local wall-clock meaning and the container deliberately knows
 * no timezone (see the calendar_events schema note). What the server owns is
 * the one thing tabs cannot decide alone: which occurrences have already been
 * announced. `claim` is an atomic INSERT-or-lose on the primary key, so two
 * desktop tabs racing the same alarm produce exactly one toast.
 */
@Injectable()
export class ScheduleService {
  constructor(private readonly db: DbService) {}

  /** True if this caller won the occurrence and should show the notification. */
  claim(domain: ScheduleDomain, itemId: string, occurrenceMs: number): boolean {
    const now = Date.now();
    // Prune on the write path so the table cannot grow unbounded without a
    // timer — the next claim after a quiet week sweeps the stale rows.
    this.db.db
      .prepare(`DELETE FROM schedule_fired WHERE fired_at < ?`)
      .run(now - PRUNE_AFTER_MS);

    const result = this.db.db
      .prepare(
        `INSERT OR IGNORE INTO schedule_fired (domain, item_id, occurrence_ms, fired_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(domain, itemId, occurrenceMs, now);
    return result.changes === 1;
  }
}
