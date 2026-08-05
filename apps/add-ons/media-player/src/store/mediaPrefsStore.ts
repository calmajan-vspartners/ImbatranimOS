import { useCallback, useState } from 'react'
import { PLAYBACK_RATES } from '../lib/transport'
import { forgetPosition, rememberPosition, resumeKey, shouldRemember } from '../lib/resume'
import type { RepeatMode } from '../lib/queueOrder'

/**
 * Playback preferences that outlive a window: volume, mute, rate, repeat, shuffle, and
 * where you were in each long file.
 *
 * Hand-rolled localStorage rather than a state library, because this add-on ships with
 * zero non-core dependencies and four scalars plus a map do not justify breaking that.
 *
 * The brief wants these on brief 49's durable dotfiles ("my volume should follow the
 * account"), and that is right — `CONFIGS_DIR` is declared in the backend env schema and
 * **not used by any module yet**, so there is nowhere durable to put them today. The
 * brief's own fallback ("until then, the existing persisted-store pattern") is what this
 * is; moving it is a one-function change when 49 lands.
 *
 * Every field is validated on read: this value survives upgrades, and a rate that is no
 * longer in `PLAYBACK_RATES` must not come back out of storage and get assigned to a media
 * element.
 */

export type MediaPrefs = {
  volume: number
  muted: boolean
  rate: number
  repeat: RepeatMode
  shuffle: boolean
  /** `root:path` → seconds. */
  resume: Record<string, number>
}

const STORAGE_KEY = 'imbatranim:media-player:prefs'

const DEFAULTS: MediaPrefs = {
  volume: 1,
  muted: false,
  rate: 1,
  repeat: 'off',
  shuffle: false,
  resume: {},
}

const REPEATS = new Set<string>(['off', 'one', 'all'])

function validResume(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, number> = {}
  for (const [key, seconds] of Object.entries(value as Record<string, unknown>)) {
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
      out[key] = seconds
    }
  }
  return out
}

function load(): MediaPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<MediaPrefs>
    return {
      volume:
        typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1
          ? parsed.volume
          : DEFAULTS.volume,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULTS.muted,
      rate: PLAYBACK_RATES.includes(parsed.rate as (typeof PLAYBACK_RATES)[number])
        ? (parsed.rate as number)
        : DEFAULTS.rate,
      repeat: REPEATS.has(parsed.repeat as string)
        ? (parsed.repeat as RepeatMode)
        : DEFAULTS.repeat,
      shuffle: typeof parsed.shuffle === 'boolean' ? parsed.shuffle : DEFAULTS.shuffle,
      resume: validResume(parsed.resume),
    }
  } catch {
    return DEFAULTS
  }
}

function save(prefs: MediaPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // A full or blocked storage must not take playback down with it.
  }
}

export function useMediaPrefs() {
  const [prefs, setPrefs] = useState<MediaPrefs>(load)

  const update = useCallback((patch: Partial<MediaPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      save(next)
      return next
    })
  }, [])

  /**
   * Record where the user is in a file, or forget it once they have effectively finished.
   *
   * Called on a timer while playing, so it must be cheap and must not write on every
   * `timeupdate` — the caller throttles; this decides whether the position is worth
   * keeping at all.
   */
  const rememberProgress = useCallback(
    (root: string, path: string, position: number, duration: number) => {
      const key = resumeKey(root, path)
      setPrefs((prev) => {
        const keep = shouldRemember(position, duration)
        const resume = keep
          ? rememberPosition(prev.resume, key, Math.floor(position))
          : forgetPosition(prev.resume, key)
        // Nothing changed (the common case, several times a minute) — return the same
        // object so React skips the re-render and storage is left alone.
        if (resume === prev.resume) return prev
        if (
          Object.keys(resume).length === Object.keys(prev.resume).length &&
          resume[key] === prev.resume[key]
        ) {
          return prev
        }
        const next = { ...prev, resume }
        save(next)
        return next
      })
    },
    []
  )

  const clearProgress = useCallback((root: string, path: string) => {
    setPrefs((prev) => {
      const next = { ...prev, resume: forgetPosition(prev.resume, resumeKey(root, path)) }
      save(next)
      return next
    })
  }, [])

  return { prefs, update, rememberProgress, clearProgress }
}
