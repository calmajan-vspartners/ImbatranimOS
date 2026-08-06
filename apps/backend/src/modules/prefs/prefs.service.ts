import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import type { PrefEntryDto, PrefsMap } from './dto/prefs.dto';

/**
 * Durable user config — the dotfiles half of brief 49's split.
 *
 * The layering grill settled the model as SSH: a **session** is per-tab and dies
 * with the tab, while **user config** belongs to the account and follows you to
 * any browser, the way `.bashrc` follows you to any login. Wallpaper, accent,
 * icon positions and the disabled-app set were in `localStorage`, which is
 * neither — tied to one browser, lost on a different device or cleared storage,
 * and shared between tabs that should not share anything.
 *
 * **The value is opaque here on purpose.** The server stores whatever JSON a
 * store hands it and never parses or validates the shape. Giving the backend a
 * schema for every client store would mean a backend change every time a store
 * gains a field, and a version skew bug the first time the two disagreed. The
 * client owns the meaning; this owns durability and access control.
 */
@Injectable()
export class PrefsService {
  constructor(private readonly db: DbService) {}

  /** Every dotfile, key → serialised JSON. */
  all(): PrefsMap {
    const rows = this.db.db.prepare('SELECT key, value FROM prefs').all() as {
      key: string;
      value: string;
    }[];
    const out: PrefsMap = {};
    for (const row of rows) out[row.key] = row.value;
    return out;
  }

  get(key: string): string | null {
    const row = this.db.db
      .prepare('SELECT value FROM prefs WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * Upsert a batch, in one transaction.
   *
   * One transaction rather than a loop of writes because a desktop change often
   * touches two stores at once (switching theme rewrites appearance; dragging an
   * icon rewrites the desktop layout) and a half-applied batch would leave the
   * next boot hydrating an inconsistent pair.
   */
  put(entries: PrefEntryDto[]): { written: number } {
    const upsert = this.db.db.prepare(
      `INSERT INTO prefs (key, value, updated_at)
       VALUES (@key, @value, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE
         SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    );
    this.db.db.transaction((batch: PrefEntryDto[]) => {
      // Destructured, NOT passed straight through. The global ValidationPipe
      // runs with `transform: true`, so what arrives here is a `PrefEntryDto`
      // *instance*, and better-sqlite3 refuses a class instance for named
      // parameters ("Named parameters can only be passed within plain
      // objects"). The first version of this handed `entry` over directly and
      // 500'd on every real request while the unit test — which built plain
      // object literals — passed. There is a test for the instance now.
      for (const entry of batch) {
        upsert.run({ key: entry.key, value: entry.value });
      }
    })(entries);
    return { written: entries.length };
  }

  remove(key: string): void {
    this.db.db.prepare('DELETE FROM prefs WHERE key = ?').run(key);
  }
}
