import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import type { Env } from '../config/env.schema';

@Injectable()
export class DbService implements OnModuleInit {
  db: Database.Database;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit() {
    this.db = new Database(this.config.get('DB_PATH'));
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  /**
   * Create anything missing and repair anything stale.
   *
   * Public and **idempotent**: `CREATE TABLE IF NOT EXISTS`, each `ALTER TABLE`
   * guarded by try/catch, and the position backfill only touching a table that
   * needs it. Called on boot, and callable again — which is how the migration is
   * tested without reopening the connection (a `:memory:` database is per
   * connection, so re-running `onModuleInit` would silently hand back an empty
   * one).
   */
  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sticky_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL DEFAULT '',
        pos_x INTEGER NOT NULL DEFAULT 100,
        pos_y INTEGER NOT NULL DEFAULT 100,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bookmark_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT
      );

      CREATE TABLE IF NOT EXISTS bookmark_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL REFERENCES bookmark_groups(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        href TEXT NOT NULL,
        icon TEXT
      );

      -- Speeds up the per-group link lookup and the ON DELETE CASCADE fan-out.
      CREATE INDEX IF NOT EXISTS idx_bookmark_links_group
        ON bookmark_links(group_id);

      -- Clock (Brief 71): world clocks + alarms, moved out of the viewing
      -- browser's localStorage so they belong to the container. The stopwatch
      -- and countdown timers are session state and deliberately absent.
      CREATE TABLE IF NOT EXISTS clock_world_clocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        time_zone TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- time_of_day rather than time: a 24h "HH:mm" string in the viewer's
      -- local wall-clock time, compared as text (which sorts correctly because
      -- it is zero-padded). days is a 7-char '0'/'1' weekday mask,
      -- Monday-first; all zeros means "ring once, then disable yourself".
      CREATE TABLE IF NOT EXISTS clock_alarms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL DEFAULT '',
        time_of_day TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        days TEXT NOT NULL DEFAULT '0000000',
        last_fired_at TEXT,
        snoozed_until INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Calendar (Brief 72): events moved out of the viewing browser's
      -- localStorage, sharing Clock's shape. Recurrence is stored as a RULE, not
      -- as materialised instances -- a weekly standup is one row, and the client
      -- expands only the range it is painting. rrule_* are all NULL for a
      -- one-off. rrule_by_weekday is a comma-joined Sunday-first index list
      -- ("1,3,5"); exceptions is comma-joined YYYY-MM-DD start days that were
      -- deleted or detached from the series. Times are epoch ms with local
      -- wall-clock meaning; there is deliberately no timezone column.
      CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        color TEXT,
        reminder_minutes INTEGER,
        rrule_freq TEXT,
        rrule_interval INTEGER,
        rrule_by_weekday TEXT,
        rrule_until TEXT,
        rrule_count INTEGER,
        exceptions TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_calendar_events_start
        ON calendar_events(start_ms);

      CREATE TABLE IF NOT EXISTS recent_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        last_opened DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Auth (Brief 10): single-user credential store. The CHECK (id = 1)
      -- enforces "single user" at the schema level — at most one row.
      CREATE TABLE IF NOT EXISTS auth_user (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        password_hash TEXT NOT NULL,
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Sessions: cookie carries a raw random token; only its SHA-256 is
      -- stored, so a DB leak does not yield usable session cookies. Times are
      -- epoch-millis integers to keep TTL math in JS, not SQLite datetime.
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);

    // Todo lists (Brief 73): one level deep, deliberately — arbitrary nesting
    // turns a task list into an outliner. A todo with list_id NULL is unfiled and
    // shows under "All".
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS todo_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Sticky notes (Brief 74): the desktop surface. pos_x/pos_y already existed
    // and are reused as the note's position on the desktop — they used to be the
    // spawn point of a per-note window, which the desktop layer replaces, so no
    // second pair of coordinate columns was added. on_desktop defaults to 0 so
    // every existing note stays list-only until the user places it.
    for (const column of [
      'width INTEGER NOT NULL DEFAULT 200',
      'height INTEGER NOT NULL DEFAULT 180',
      'color TEXT',
      'on_desktop INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        this.db.exec(`ALTER TABLE sticky_notes ADD COLUMN ${column}`);
      } catch {
        // column already exists — safe to ignore
      }
    }

    // Columns added to a table that already shipped. Each is attempted
    // separately, because ALTER TABLE cannot add several at once and one
    // already-exists must not skip the rest.
    for (const column of [
      'position INTEGER NOT NULL DEFAULT 0',
      // Brief 73. due_at is epoch ms with local wall-clock meaning, matching
      // Calendar; NULL means no due date, which is the common case.
      'due_at INTEGER',
      'priority INTEGER NOT NULL DEFAULT 0',
      // No REFERENCES clause: `PRAGMA foreign_keys` is never enabled on this
      // connection, so one would be decorative. The service deletes a list and
      // unfiles its todos in one transaction instead.
      'list_id INTEGER',
    ]) {
      try {
        this.db.exec(`ALTER TABLE todos ADD COLUMN ${column}`);
      } catch {
        // column already exists — safe to ignore
      }
    }

    this.backfillTodoPositions();
  }

  /**
   * Give every todo a unique position, ordered by whatever order it has now.
   *
   * The `position` column was added to a live table with `DEFAULT 0`, so every
   * row that predates it shares position 0 — `ORDER BY position` then falls back
   * to whatever SQLite feels like, and a drag-to-reorder writes 1..N over the top
   * of ties. This normalises to 1..N by (position, id), so pre-existing todos keep
   * their insertion order and everything reordered since keeps its order too.
   *
   * Runs only when it has something to fix (a zero, or two rows sharing a
   * position), so a healthy table costs one SELECT at boot.
   */
  private backfillTodoPositions() {
    const check = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                COUNT(DISTINCT position) AS distinct_positions,
                SUM(CASE WHEN position = 0 THEN 1 ELSE 0 END) AS zeros
           FROM todos`,
      )
      .get() as { total: number; distinct_positions: number; zeros: number };

    if (check.total === 0) return;
    if (check.zeros === 0 && check.distinct_positions === check.total) return;

    const rows = this.db
      .prepare('SELECT id FROM todos ORDER BY position ASC, id ASC')
      .all() as { id: number }[];
    const update = this.db.prepare(
      'UPDATE todos SET position = @position WHERE id = @id',
    );
    this.db.transaction(() => {
      rows.forEach((row, index) => {
        update.run({ position: index + 1, id: row.id });
      });
    })();
  }
}
