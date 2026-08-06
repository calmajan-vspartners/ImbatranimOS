import { describe, expect, it } from 'vitest'
import { toSignIns, type LogEntry } from '@imbatranim/ui'
import { eventLabel, formatWhen, knownEvents, relativeTime, summarise } from './logFormat'

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  t: '2026-08-06T10:00:00.000Z',
  level: 'info',
  event: 'auth.login.ok',
  source: 'server',
  msg: 'Signed in',
  ...over,
})

describe('event labels', () => {
  it('reads as English, not as a dotted key', () => {
    expect(eventLabel('auth.login.failed')).toBe('Sign-in failed')
    expect(eventLabel('files.deleted')).toBe('File deleted for good')
  })

  it('falls back to the raw event rather than showing nothing', () => {
    expect(eventLabel('something.new.the.ui.has.not.met')).toBe('something.new.the.ui.has.not.met')
  })

  it('covers every event the backend writes today', () => {
    // If a call site is added without a label the row still renders (above),
    // but this is the nudge to add one.
    expect(knownEvents()).toContain('auth.throttle.locked')
    expect(knownEvents()).toContain('backup.restored')
    expect(knownEvents()).toContain('app.crashed')
  })
})

describe('timestamps', () => {
  const now = Date.parse('2026-08-06T12:00:00.000Z')

  it('gives both a clock time and a distance', () => {
    const { clock, relative } = formatWhen('2026-08-06T10:00:00.000Z', now)
    expect(clock.length).toBeGreaterThan(0)
    expect(relative).toBe('2h ago')
  })

  it('rounds the way a person would read it', () => {
    expect(relativeTime(now - 5_000, now)).toBe('just now')
    expect(relativeTime(now - 120_000, now)).toBe('2m ago')
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3h ago')
    expect(relativeTime(now - 5 * 86400_000, now)).toBe('5d ago')
    expect(relativeTime(now - 90 * 86400_000, now)).toBe('3mo ago')
  })

  it('never shows a negative age from a clock skew', () => {
    expect(relativeTime(now + 60_000, now)).toBe('just now')
  })

  it('shows an unparseable timestamp as-is rather than "Invalid Date"', () => {
    expect(formatWhen('not a date').clock).toBe('not a date')
  })
})

describe('row summaries', () => {
  it('pulls the one fact that answers the row’s own question', () => {
    expect(summarise(entry({ msg: 'Signed in', meta: { ip: '10.0.0.4' } }))).toBe(
      'Signed in — 10.0.0.4'
    )
    expect(
      summarise(
        entry({
          event: 'files.deleted',
          msg: 'A trashed item was deleted for good',
          meta: { originalPath: 'Documents/taxes.pdf' },
        })
      )
    ).toBe('A trashed item was deleted for good — Documents/taxes.pdf')
  })

  it('does not invent a dash when there is nothing to add', () => {
    expect(summarise(entry({ msg: 'Two-factor turned on', meta: {} }))).toBe('Two-factor turned on')
    expect(summarise(entry({ msg: 'Two-factor turned on' }))).toBe('Two-factor turned on')
  })

  it('ignores a non-string value rather than printing [object Object]', () => {
    expect(summarise(entry({ msg: 'Killed', meta: { name: { nested: true } } }))).toBe('Killed')
  })
})

describe('sign-in history', () => {
  it('keeps only sign-in events, and marks which failed', () => {
    const rows = toSignIns([
      entry({ event: 'auth.login.ok', meta: { ip: '10.0.0.4' } }),
      entry({ event: 'auth.login.failed', meta: { ip: '203.0.113.7' } }),
      entry({ event: 'files.deleted', meta: { originalPath: 'a' } }),
      entry({ event: 'auth.logout', meta: { ip: '10.0.0.4' } }),
    ])
    expect(rows).toEqual([
      { t: '2026-08-06T10:00:00.000Z', ip: '10.0.0.4', ok: true },
      { t: '2026-08-06T10:00:00.000Z', ip: '203.0.113.7', ok: false },
    ])
  })

  it('says "unknown" rather than dropping a row with no address', () => {
    const rows = toSignIns([entry({ event: 'auth.login.ok', meta: {} })])
    expect(rows[0].ip).toBe('unknown')
  })
})
