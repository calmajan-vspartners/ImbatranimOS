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

  private migrate() {
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

    try {
      this.db.exec(
        'ALTER TABLE todos ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      );
    } catch {
      // column already exists — safe to ignore
    }
  }
}
