import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { renameSync, rmSync } from 'fs';
import type { Env } from '../config/env.schema';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  db: Database.Database;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit() {
    this.db = new Database(this.config.get('DB_PATH'));
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  /** Where the database file lives. Backup and restore both need this. */
  path(): string {
    return this.config.get('DB_PATH');
  }

  /**
   * Write a **consistent** copy of the database to `destPath` (brief 80).
   *
   * The database sits inside the home volume that a backup tars up, and it is in
   * WAL mode. Copying `db.sqlite` with `tar` while the process is writing gives a
   * torn file *and* silently omits the `-wal` — the archive would look fine and
   * restore to a database missing the most recent writes, or refusing to open.
   *
   * `VACUUM INTO` is SQLite's own answer: it builds a fresh, checkpointed,
   * single-file database from a read transaction, so the snapshot is a valid
   * point-in-time copy with no sidecar files to keep together. The destination
   * is **bound as a parameter**, not interpolated into the SQL text.
   */
  snapshotTo(destPath: string): void {
    this.db.prepare('VACUUM INTO ?').run(destPath);
  }

  /**
   * Swap the live database file for `sourcePath` and reopen (brief 80's restore).
   *
   * Renaming a file out from under an open SQLite connection does **not** switch
   * the connection to the new file: the descriptor follows the inode, so every
   * later query would read and write a ghost that no longer has a name. The
   * connection therefore has to be closed, the file replaced, and a new
   * connection opened — which is safe for callers because every service reaches
   * the handle through `this.db.db` at call time rather than capturing it.
   *
   * The `-wal`/`-shm` sidecars of the *old* database are removed: they belong to
   * the file being replaced, and leaving them next to a different database is how
   * you get a "file is not a database" on the next boot. `migrate()` runs after
   * reopening so a backup taken by an older image is brought forward.
   */
  replaceWith(sourcePath: string): void {
    const target = this.path();
    this.db.close();
    try {
      renameSync(sourcePath, target);
      for (const suffix of ['-wal', '-shm']) {
        rmSync(target + suffix, { force: true });
      }
    } finally {
      // Reopen no matter what: a failed swap must not leave the process without
      // a database, or every subsequent request 500s including the login that
      // would let the user try again.
      this.db = new Database(target);
      this.db.pragma('journal_mode = WAL');
      this.migrate();
    }
  }

  /**
   * Close the better-sqlite3 handle on shutdown so WAL is checkpointed and the
   * file descriptor is released. Guarded against a double-close (shutdown hooks
   * can fire more than once) — better-sqlite3 throws if `close()` is called on
   * an already-closed handle.
   */
  onModuleDestroy() {
    if (this.db?.open) {
      this.db.close();
    }
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
    // Brief 94: recent_files changed shape (root + app_id, UNIQUE(root, path)
    // instead of UNIQUE(path)). SQLite cannot alter constraints, so an
    // old-shape table is dropped and recreated by the block below. The rows
    // are deliberately not migrated: they were Notepad's bare paths with no
    // root — "recently opened" hints, not data — and brief 59 moved Notepad's
    // default root out from under them, so their meaning is unrecoverable.
    const recentCols = this.db
      .prepare(`PRAGMA table_info(recent_files)`)
      .all() as { name: string }[];
    if (recentCols.length > 0 && !recentCols.some((c) => c.name === 'root')) {
      this.db.exec(`DROP TABLE recent_files`);
    }

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

      -- Git repos the user has opened (Brief 76). A table of its own rather than
      -- reusing recent_files: that one is Notes' (a bare path, no root), and
      -- folding two meanings into one table is the shapeless-blob-store pattern
      -- this repo has refused since brief 71. UNIQUE(root, path) makes "open it
      -- again" an upsert of the timestamp rather than a duplicate row.
      CREATE TABLE IF NOT EXISTS git_recent_repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root TEXT NOT NULL,
        path TEXT NOT NULL,
        last_opened DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(root, path)
      );

      -- OS-wide recent files (Brief 94). Replaces Notepad's private recents:
      -- every opener records (root, path, appId), and the Start menu, file
      -- picker and palette consume. UNIQUE(root, path) makes reopening an
      -- upsert of the timestamp; app_id remembers which app to reopen with.
      -- Dotfiles (Brief 49): durable user config, keyed by store name and
      -- holding that store's serialised state as JSON. The SSH analogy the
      -- layering grill settled on: your window layout is the session and dies
      -- with the tab, but your wallpaper and accent are dotfiles -- they belong
      -- to the account and follow you to any browser. Single user, so no owner
      -- column; the global SessionAuthGuard is the whole access story.
      CREATE TABLE IF NOT EXISTS prefs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS recent_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root TEXT NOT NULL,
        path TEXT NOT NULL,
        app_id TEXT NOT NULL,
        last_opened DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(root, path)
      );

      -- Scheduler claims (Brief 93): which alarm/reminder/due occurrences have
      -- already produced a toast. The PRIMARY KEY makes "claim" an atomic
      -- INSERT-or-lose, so with two desktop tabs polling, exactly one wins the
      -- notification. Rows are dedupe state, not history — pruned after days.
      CREATE TABLE IF NOT EXISTS schedule_fired (
        domain TEXT NOT NULL,
        item_id TEXT NOT NULL,
        occurrence_ms INTEGER NOT NULL,
        fired_at INTEGER NOT NULL,
        PRIMARY KEY (domain, item_id, occurrence_ms)
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

    // Bookmarks (Brief 75): nested folders, and `href` becomes `url`.
    //
    // The rename is the contract brief 50 (web browser) will consume — it speaks
    // of `openApp('browser', { url })`, and translating at that seam forever is
    // worse than renaming once here. RENAME COLUMN needs SQLite 3.25+, which
    // better-sqlite3 has; the catch makes the second run a no-op.
    try {
      this.db.exec('ALTER TABLE bookmark_links RENAME COLUMN href TO url');
    } catch {
      // already renamed — safe to ignore
    }

    for (const column of [
      // No REFERENCES clause, for the same reason as todos.list_id: the pragma is
      // off, so it would be decorative. The service deletes a folder subtree
      // explicitly, in one transaction — see the note on deleteGroup, which is the
      // bug brief 73 handed over.
      'parent_id INTEGER',
      'position INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        this.db.exec(`ALTER TABLE bookmark_groups ADD COLUMN ${column}`);
      } catch {
        // column already exists — safe to ignore
      }
    }
    try {
      this.db.exec(
        'ALTER TABLE bookmark_links ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      );
    } catch {
      // column already exists — safe to ignore
    }

    // Speeds up the subtree walk that deleteGroup and the cycle guard both do.
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_bookmark_groups_parent ON bookmark_groups(parent_id)',
    );

    // TOTP replay protection (RFC 6238 §5.2): the highest time-step already
    // accepted. A verify is rejected when its step <= this, so a code cannot be
    // used twice within its window. NULL until the first successful verify.
    try {
      this.db.exec('ALTER TABLE auth_user ADD COLUMN totp_last_step INTEGER');
    } catch {
      // column already exists — safe to ignore
    }

    this.backfillTodoPositions();
    this.backfillBookmarkPositions();
    this.adoptOrphanedBookmarkLinks();
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

  /**
   * Give bookmark folders and links unique positions within their parent.
   *
   * Same shape as {@link backfillTodoPositions} and the same reason — `position`
   * arrived with `DEFAULT 0` on live tables, so every pre-existing row ties and a
   * reorder would write over the ties. Numbering is **per parent** here rather
   * than global, because order only means anything among siblings.
   */
  private backfillBookmarkPositions() {
    const groups = this.db
      .prepare(
        'SELECT id, parent_id FROM bookmark_groups ORDER BY position ASC, id ASC',
      )
      .all() as { id: number; parent_id: number | null }[];
    const links = this.db
      .prepare(
        'SELECT id, group_id FROM bookmark_links ORDER BY position ASC, id ASC',
      )
      .all() as { id: number; group_id: number }[];
    if (groups.length === 0 && links.length === 0) return;

    const groupUpdate = this.db.prepare(
      'UPDATE bookmark_groups SET position = @position WHERE id = @id',
    );
    const linkUpdate = this.db.prepare(
      'UPDATE bookmark_links SET position = @position WHERE id = @id',
    );
    const nextIn = (seen: Map<number | null, number>, key: number | null) => {
      const next = (seen.get(key) ?? 0) + 1;
      seen.set(key, next);
      return next;
    };

    this.db.transaction(() => {
      const groupSeen = new Map<number | null, number>();
      for (const group of groups) {
        groupUpdate.run({
          position: nextIn(groupSeen, group.parent_id),
          id: group.id,
        });
      }
      const linkSeen = new Map<number | null, number>();
      for (const link of links) {
        linkUpdate.run({
          position: nextIn(linkSeen, link.group_id),
          id: link.id,
        });
      }
    })();
  }

  /**
   * Delete bookmark links whose folder is gone.
   *
   * This repairs the bug brief 73 handed to brief 75. `bookmark_links.group_id`
   * declares `ON DELETE CASCADE`, and `deleteGroup` even carried a comment saying
   * SQLite handled it — but `PRAGMA foreign_keys` is **never enabled on this
   * connection**, so the constraint was decorative and every folder deletion left
   * its links behind. They were invisible (the read path buckets links by an
   * existing folder id) and accumulated forever.
   *
   * They are deleted rather than rescued into a "Recovered" folder: the user
   * confirmed "Delete group and all its links?", so the links were meant to go.
   * Resurrecting them would be undoing a decision the user already made.
   */
  private adoptOrphanedBookmarkLinks() {
    this.db.exec(
      `DELETE FROM bookmark_links
         WHERE group_id NOT IN (SELECT id FROM bookmark_groups)`,
    );
    // A folder whose parent is gone would be unreachable in the tree for the same
    // reason. Promote it to the root instead of deleting it — unlike the links
    // above, nobody ever confirmed losing it; it is collateral from the same bug.
    this.db.exec(
      `UPDATE bookmark_groups
          SET parent_id = NULL
        WHERE parent_id IS NOT NULL
          AND parent_id NOT IN (SELECT id FROM bookmark_groups)`,
    );
  }
}
