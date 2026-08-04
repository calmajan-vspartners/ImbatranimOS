import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { classifyClose, retryDelay, MAX_RETRIES, CLOSE_SESSION_REVOKED } from './closeReason'
import { buildXtermTheme, type VarResolver } from './xtermTheme'
import {
  clampFontSize,
  loadFontSize,
  saveFontSize,
  stepFontSize,
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from './fontSize'

describe('classifyClose', () => {
  it('never reconnects after the user typed exit', () => {
    // The single most important case: reconnecting here would be the app
    // overriding an explicit instruction, and it would look like the terminal
    // refusing to close.
    const v = classifyClose(1000, 'pty-exit', true)
    expect(v.retry).toBe(false)
    expect(v.terminal).toBe(true)
    expect(v.message).toBe('Shell exited.')
  })

  it('never reconnects on a revoked session, and says to sign in', () => {
    const v = classifyClose(CLOSE_SESSION_REVOKED, 'session-revoked', true)
    expect(v.retry).toBe(false)
    expect(v.terminal).toBe(true)
    expect(v.message).toMatch(/sign in/i)
  })

  it('does not retry a shell that could not be spawned', () => {
    // A retry loop would spawn-fail just as fast; this needs $SHELL or the image
    // looked at.
    for (const v of [classifyClose(1011, 'spawn-failed', false), classifyClose(1011, '', true)]) {
      expect(v.retry).toBe(false)
      expect(v.terminal).toBe(true)
    }
  })

  it('retries a backend shutdown — the dev-restart case this brief exists for', () => {
    const v = classifyClose(1001, 'shutdown', true)
    expect(v.retry).toBe(true)
    expect(v.terminal).toBe(false)
    expect(v.checkAuth).toBe(false)
  })

  it('retries an abnormal drop after the socket had been open', () => {
    const v = classifyClose(1006, '', true)
    expect(v.retry).toBe(true)
    expect(v.checkAuth).toBe(false)
    expect(v.message).toBe('Disconnected…')
  })

  it('flags a never-opened socket for an auth check', () => {
    // A refused handshake (401 or the session cap) and a dead backend both arrive
    // as 1006 with no reason, so the cause has to be resolved out of band.
    const v = classifyClose(1006, '', false)
    expect(v.retry).toBe(true)
    expect(v.checkAuth).toBe(true)
  })

  it('treats a revoked session as terminal even if it never opened', () => {
    expect(classifyClose(CLOSE_SESSION_REVOKED, 'session-revoked', false).retry).toBe(false)
  })

  it('does not retry a plain code-1000 close', () => {
    // The generic dispose path. Nothing is wrong, so nothing needs reconnecting.
    const v = classifyClose(1000, 'closed', true)
    expect(v.retry).toBe(false)
  })
})

describe('retryDelay', () => {
  it('backs off 1s, 2s, 4s, 8s then holds', () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 8000, 8000])
  })

  it('is capped so the last wait is not absurd', () => {
    // The common cause is a dev-server restart taking a few seconds. A 30-second
    // wait would feel broken even while it is working correctly.
    expect(retryDelay(MAX_RETRIES)).toBeLessThanOrEqual(8000)
  })

  it('survives a nonsense attempt number', () => {
    expect(retryDelay(0)).toBe(1000)
    expect(retryDelay(-3)).toBe(1000)
  })
})

describe('buildXtermTheme', () => {
  const tokens: Record<string, string> = {
    '--k-surface': '#0d0d0e',
    '--k-on-surface': '#f2f2ef',
    '--accent': '#1f5fd6',
  }
  const resolve: VarResolver = (name) => tokens[name] ?? ''

  it('takes background, foreground and cursor from the tokens', () => {
    const t = buildXtermTheme('dark', resolve)
    expect(t.background).toBe('#0d0d0e')
    expect(t.foreground).toBe('#f2f2ef')
    // The accent, not a hardcoded crimson — this is what makes changing the accent
    // in Settings restyle an open terminal.
    expect(t.cursor).toBe('#1f5fd6')
  })

  it('sets cursorAccent to the background, not a fixed near-black', () => {
    // The cursor block is filled with the accent; the glyph beneath it must be the
    // surface colour or it is invisible on the light theme.
    const light: VarResolver = (n) =>
      ({ '--k-surface': '#f3f3f1', '--k-on-surface': '#16161a', '--accent': '#c0263a' })[n] ?? ''
    expect(buildXtermTheme('light', light).cursorAccent).toBe('#f3f3f1')
  })

  it('falls back to the dark tokens when CSS has not resolved yet', () => {
    const t = buildXtermTheme('dark', () => '')
    expect(t.background).toBe('#0d0d0e')
    expect(t.foreground).toBe('#f2f2ef')
    expect(t.cursor).toBe('#c0263a')
  })

  it('trims whatever getPropertyValue returns', () => {
    // Real `getPropertyValue` hands back a leading space for these.
    const t = buildXtermTheme('dark', (n) => (n === '--k-surface' ? '  #111213  ' : ''))
    expect(t.background).toBe('#111213')
  })

  it('ships a DIFFERENT ANSI palette per mode', () => {
    // The whole point: flipping only the background would leave xterm's
    // dark-tuned ANSI colours on a near-white surface.
    const dark = buildXtermTheme('dark', resolve)
    const light = buildXtermTheme('light', resolve)
    expect(light.yellow).not.toBe(dark.yellow)
    expect(light.brightWhite).not.toBe(dark.brightWhite)
  })

  it('keeps every light-mode ANSI colour dark enough to read on the light surface', () => {
    // The regression this guards: a "bright" colour that is brighter than the page.
    // Relative luminance per WCAG; the light surface (#f3f3f1) is ~0.89.
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    }
    const light = buildXtermTheme('light', resolve)
    const ansiKeys = [
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'brightBlack',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
      'brightWhite',
    ] as const
    const surface = lum('#f3f3f1')
    for (const key of ansiKeys) {
      const value = light[key]
      const contrast = (surface + 0.05) / (lum(value) + 0.05)
      // 3:1 — the large-text/UI threshold. Terminal glyphs are small but this is
      // the floor below which a colour is simply not readable.
      expect(contrast, `${key} (${value}) on #f3f3f1`).toBeGreaterThan(3)
    }
  })

  it('keeps every dark-mode ANSI colour light enough to read on the dark surface', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    }
    const dark = buildXtermTheme('dark', resolve)
    const surface = lum('#0d0d0e')
    // `black`/`brightBlack` are conventionally near-background (they are what
    // dimmed text uses) so they are excluded — a terminal palette where ANSI black
    // is readable on black is not a terminal palette.
    const keys = [
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
      'brightWhite',
    ] as const
    for (const key of keys) {
      const contrast = (lum(dark[key]) + 0.05) / (surface + 0.05)
      expect(contrast, `${key} (${dark[key]}) on #0d0d0e`).toBeGreaterThan(3)
    }
  })
})

describe('font size', () => {
  const store = new Map<string, string>()
  const originalLocalStorage = globalThis.localStorage

  beforeEach(() => {
    store.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    })
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    })
  })

  it('clamps to the readable range and rounds', () => {
    expect(clampFontSize(2)).toBe(MIN_FONT_SIZE)
    expect(clampFontSize(400)).toBe(MAX_FONT_SIZE)
    expect(clampFontSize(13.6)).toBe(14)
    expect(clampFontSize(NaN)).toBe(DEFAULT_FONT_SIZE)
  })

  it('round-trips through storage', () => {
    saveFontSize(17)
    expect(loadFontSize()).toBe(17)
  })

  it('returns the default for junk in storage, not the clamp floor', () => {
    // `Number('abc')` is NaN and `Number('')` is 0. Clamping either would give an
    // 8px terminal forever, which reads as a rendering bug rather than a bad
    // stored value.
    for (const junk of ['abc', '', '0', '-4']) {
      store.set('imbatranim:terminal:font-size', junk)
      expect(loadFontSize(), junk).toBe(DEFAULT_FONT_SIZE)
    }
  })

  it('clamps an out-of-range stored value instead of trusting it', () => {
    store.set('imbatranim:terminal:font-size', '900')
    expect(loadFontSize()).toBe(MAX_FONT_SIZE)
  })

  it('steps up, down, and resets', () => {
    expect(stepFontSize(13, 1)).toBe(14)
    expect(stepFontSize(13, -1)).toBe(12)
    expect(stepFontSize(21, 0)).toBe(DEFAULT_FONT_SIZE)
  })

  it('returns the same value at the bounds so the caller can skip a re-fit', () => {
    expect(stepFontSize(MAX_FONT_SIZE, 1)).toBe(MAX_FONT_SIZE)
    expect(stepFontSize(MIN_FONT_SIZE, -1)).toBe(MIN_FONT_SIZE)
  })
})

describe('allowManualRetry', () => {
  it('is false ONLY for a revoked session', () => {
    // A Reconnect button that can only 401 is worse than no button. Every other
    // settled state is worth one more try because the user may have fixed the cause.
    expect(classifyClose(CLOSE_SESSION_REVOKED, 'session-revoked', true).allowManualRetry).toBe(
      false
    )
    for (const v of [
      classifyClose(1000, 'pty-exit', true),
      classifyClose(1000, 'closed', true),
      classifyClose(1011, 'spawn-failed', true),
      classifyClose(1001, 'shutdown', true),
      classifyClose(1006, '', true),
      classifyClose(1006, '', false),
    ]) {
      expect(v.allowManualRetry).toBe(true)
    }
  })
})
