import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** The list is a glance, not an archive — pruned to this on every write. */
const MAX_RECENTS = 50;

export interface RecentFile {
  id: number;
  root: string;
  path: string;
  appId: string;
  lastOpened: string;
}

interface RecentRow {
  id: number;
  root: string;
  path: string;
  app_id: string;
  last_opened: string;
}

/**
 * OS-wide recent files (brief 94). Promoted from Notepad's private recents:
 * every opener records `(root, path, appId)` through one core helper, and the
 * Start menu, the file picker and the palette read it back.
 *
 * Rows are hints, not truth: a path may have been deleted since. Consumers
 * self-heal by removing an entry that 404s when reopened — the same contract
 * sticky-notes proved for stale caches.
 */
@Injectable()
export class RecentService {
  constructor(private readonly db: DbService) {}

  list(): RecentFile[] {
    const rows = this.db.db
      .prepare(
        `SELECT id, root, path, app_id, last_opened FROM recent_files
         ORDER BY last_opened DESC, id DESC LIMIT ?`,
      )
      .all(MAX_RECENTS) as RecentRow[];
    return rows.map((r) => ({
      id: r.id,
      root: r.root,
      path: r.path,
      appId: r.app_id,
      lastOpened: r.last_opened,
    }));
  }

  record(root: string, path: string, appId: string): void {
    const tx = this.db.db.transaction(() => {
      this.db.db
        .prepare(
          `INSERT INTO recent_files (root, path, app_id, last_opened)
           VALUES (@root, @path, @appId, CURRENT_TIMESTAMP)
           ON CONFLICT(root, path) DO UPDATE
             SET app_id = @appId, last_opened = CURRENT_TIMESTAMP`,
        )
        .run({ root, path, appId });
      // Prune on the write path so the table cannot grow unbounded. The id
      // tiebreak matters: CURRENT_TIMESTAMP has second precision, so a burst
      // of opens inside one second would otherwise prune arbitrarily.
      this.db.db
        .prepare(
          `DELETE FROM recent_files WHERE id NOT IN (
             SELECT id FROM recent_files
             ORDER BY last_opened DESC, id DESC LIMIT ?
           )`,
        )
        .run(MAX_RECENTS);
    });
    tx();
  }

  /** Remove one entry (self-heal after a 404 reopen). */
  remove(root: string, path: string): void {
    this.db.db
      .prepare(`DELETE FROM recent_files WHERE root = ? AND path = ?`)
      .run(root, path);
  }

  /** The privacy affordance: wipe the list. */
  clear(): void {
    this.db.db.prepare(`DELETE FROM recent_files`).run();
  }
}
