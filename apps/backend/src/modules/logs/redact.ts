/**
 * Strip anything secret out of a log entry's metadata (brief 84).
 *
 * A log written by the process that also handles credentials is exactly where a
 * secret leaks, so this is a **guard, not a convention**. The rule is
 * deny-by-key-name and it errs towards dropping: a redacted field costs a little
 * debuggability, a leaked one costs the machine.
 *
 * It is deliberately pure and exported so the refusal is testable directly,
 * without a filesystem or a running app.
 */

/**
 * Key names whose values never reach the log.
 *
 * `hash` is here as well as `password`: an argon2 hash is not a plaintext
 * password, but it is the input to an offline cracking attempt, and a log file
 * is a much easier thing to end up in a bug report than the database is.
 */
const SECRET_KEY =
  /pass|secret|token|otp|totp|code|cookie|authorization|hash|credential|salt|session|(?:api|auth|private|signing|access)[-_]?key/i;

/** Longest a single logged string may be. Beyond this it is truncated, not dropped. */
export const MAX_VALUE_LENGTH = 512;
/** Longest the whole serialised entry may be, so one line cannot eat a rotation. */
export const MAX_ENTRY_BYTES = 8 * 1024;
/** How deep to walk a nested object before giving up on it. */
const MAX_DEPTH = 4;
/** How many keys to keep from one object. */
const MAX_KEYS = 32;

export const REDACTED = '[redacted]';

/**
 * Return a copy of `meta` safe to write to disk.
 *
 * Values that are not JSON-ish (functions, symbols, class instances) are
 * described rather than serialised — a log line should never be the thing that
 * throws.
 */
export function redact(meta: unknown, depth = 0): unknown {
  if (meta === null || meta === undefined) return meta;
  if (typeof meta === 'string') {
    return meta.length > MAX_VALUE_LENGTH
      ? `${meta.slice(0, MAX_VALUE_LENGTH)}…[${meta.length} chars]`
      : meta;
  }
  if (typeof meta === 'number' || typeof meta === 'boolean') return meta;
  if (typeof meta === 'bigint') return meta.toString();
  if (meta instanceof Date) return meta.toISOString();
  if (meta instanceof Error) {
    return { name: meta.name, message: redact(meta.message, depth + 1) };
  }
  if (depth >= MAX_DEPTH) return '[nested]';
  if (Array.isArray(meta)) {
    return meta.slice(0, MAX_KEYS).map((v) => redact(v, depth + 1));
  }
  if (typeof meta === 'object') {
    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const [key, value] of Object.entries(meta)) {
      if (kept >= MAX_KEYS) {
        out['…'] = 'more keys omitted';
        break;
      }
      kept++;
      out[key] = SECRET_KEY.test(key) ? REDACTED : redact(value, depth + 1);
    }
    return out;
  }
  // functions, symbols, anything else
  return `[${typeof meta}]`;
}

/** True when this key would be redacted. Exported so call sites can be audited. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/**
 * Serialise one entry to a single JSONL line, bounded.
 *
 * A newline inside a value would split one entry into two unparseable ones, so
 * `JSON.stringify` doing the escaping is load-bearing rather than incidental.
 */
export function serialiseEntry(entry: Record<string, unknown>): string {
  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    // A cycle, or a value that refuses to serialise. Losing the metadata is
    // acceptable; losing the event is not.
    line = JSON.stringify({
      t: entry.t,
      level: entry.level,
      event: entry.event,
      source: entry.source,
      msg: entry.msg,
      meta: { error: 'metadata could not be serialised' },
    });
  }
  if (line.length > MAX_ENTRY_BYTES) {
    line = JSON.stringify({
      t: entry.t,
      level: entry.level,
      event: entry.event,
      source: entry.source,
      msg: entry.msg,
      meta: {
        error: `entry too large (${line.length} bytes), metadata dropped`,
      },
    });
  }
  return `${line}\n`;
}
