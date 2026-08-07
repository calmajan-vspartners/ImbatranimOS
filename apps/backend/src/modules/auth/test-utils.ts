import type { ConfigService } from '@nestjs/config';
import { DbService } from '../../db/db.service';
import type { Env } from '../../config/env.schema';

/**
 * Build a DbService backed by a fresh in-memory SQLite DB, running the real
 * migrations (so auth tables match production exactly). Test-only.
 */
export function makeTestDb(): DbService {
  const config = {
    get: (key: string) => (key === 'DB_PATH' ? ':memory:' : undefined),
  } as unknown as ConfigService<Env, true>;
  const db = new DbService(config);
  db.onModuleInit();
  return db;
}

/** A ConfigService stub returning the given values (with sane auth defaults). */
export function makeConfig(
  overrides: Partial<Record<keyof Env, unknown>> = {},
): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    SESSION_TTL_HOURS: 168,
    SESSION_ABSOLUTE_MAX_HOURS: 720,
    COOKIE_SECURE: false,
    TRUST_PROXY: false,
    FRONTEND_URL: 'http://localhost:5173',
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService<Env, true>;
}
