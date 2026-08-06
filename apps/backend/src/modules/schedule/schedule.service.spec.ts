import { ScheduleService } from './schedule.service';
import { makeTestDb } from '../auth/test-utils';
import type { DbService } from '../../db/db.service';

describe('ScheduleService', () => {
  let db: DbService;
  let service: ScheduleService;

  beforeEach(() => {
    db = makeTestDb();
    service = new ScheduleService(db);
  });

  it('first claim of an occurrence wins', () => {
    expect(service.claim('clock', '4', 1_700_000_000_000)).toBe(true);
  });

  it('second claim of the same occurrence loses', () => {
    service.claim('clock', '4', 1_700_000_000_000);
    expect(service.claim('clock', '4', 1_700_000_000_000)).toBe(false);
  });

  it('a different occurrence of the same item is a fresh claim', () => {
    service.claim('clock', '4', 1_700_000_000_000);
    expect(service.claim('clock', '4', 1_700_000_060_000)).toBe(true);
  });

  it('the same occurrence key in another domain is independent', () => {
    service.claim('clock', '4', 1_700_000_000_000);
    expect(service.claim('todo', '4', 1_700_000_000_000)).toBe(true);
  });

  it('prunes claims older than the retention window on write', () => {
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    db.db
      .prepare(
        `INSERT INTO schedule_fired (domain, item_id, occurrence_ms, fired_at)
         VALUES ('clock', 'old', 1, ?)`,
      )
      .run(twoWeeksAgo);

    service.claim('todo', 'fresh', 2);

    const rows = db.db
      .prepare(`SELECT item_id FROM schedule_fired ORDER BY item_id`)
      .all() as { item_id: string }[];
    expect(rows.map((r) => r.item_id)).toEqual(['fresh']);
  });
});
