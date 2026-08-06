import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { prefsStorage } from '../../lib/prefs'

export type ThemeMode = 'dark' | 'light'
export type AccentId = 'crimson' | 'cobalt' | 'emerald' | 'signal'

export type AccentPreset = {
  id: AccentId
  name: string
  /** Accent fill. Chosen dark enough that white text/icons clear 4.5:1 on it. */
  hex: string
  /** Text/icon color to sit on the accent fill. */
  on: string
}

/**
 * Accent candidates (provisional). White-on-accent contrast noted; all >= 4.5:1.
 *   crimson #c0263a ~6.5  ·  cobalt #1f5fd6 ~5.8  ·  emerald #0f7a40 ~5.5  ·  signal #d24317 ~4.6
 */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'crimson', name: 'Crimson', hex: '#c0263a', on: '#ffffff' },
  { id: 'cobalt', name: 'Cobalt', hex: '#1f5fd6', on: '#ffffff' },
  { id: 'emerald', name: 'Emerald', hex: '#0f7a40', on: '#ffffff' },
  { id: 'signal', name: 'Signal Orange', hex: '#d24317', on: '#ffffff' },
]

export const DEFAULT_ACCENT: AccentId = 'crimson'
export const DEFAULT_THEME: ThemeMode = 'dark'

type AppearanceStore = {
  theme: ThemeMode
  accent: AccentId
  setTheme: (t: ThemeMode) => void
  setAccent: (a: AccentId) => void
}

export const useAppearanceStore = create<AppearanceStore>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      accent: DEFAULT_ACCENT,
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
    }),
    {
      name: 'imbatranimos:appearance',
      /**
       * Server-backed dotfile (brief 49): durable user config that belongs to the
       * account, not to one browser. `prefsStorage` mirrors to localStorage for
       * the pre-auth first paint and writes through to `/api/prefs`.
       */
      storage: createJSONStorage(() => prefsStorage),
    }
  )
)

/** Push the active theme + accent onto the document root so CSS vars resolve. */
export function applyAppearance(theme: ThemeMode, accent: AccentId): void {
  const preset = ACCENT_PRESETS.find((p) => p.id === accent) ?? ACCENT_PRESETS[0]
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.style.setProperty('--accent', preset.hex)
  root.style.setProperty('--accent-on', preset.on)
}
