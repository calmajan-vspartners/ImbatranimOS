import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { prefsStorage } from '../../lib/prefs'

type AddonStore = {
  /** App ids the user has disabled. Non-disableable ids are ignored at read time. */
  disabled: string[]
  toggle: (id: string) => void
  enable: (id: string) => void
  disable: (id: string) => void
  isDisabled: (id: string) => boolean
}

export const useAddonStore = create<AddonStore>()(
  persist(
    (set, get) => ({
      disabled: [],
      toggle: (id) =>
        set((s) => ({
          disabled: s.disabled.includes(id)
            ? s.disabled.filter((d) => d !== id)
            : [...s.disabled, id],
        })),
      enable: (id) => set((s) => ({ disabled: s.disabled.filter((d) => d !== id) })),
      disable: (id) =>
        set((s) => (s.disabled.includes(id) ? s : { disabled: [...s.disabled, id] })),
      isDisabled: (id) => get().disabled.includes(id),
    }),
    {
      name: 'imbatranimos:addons',
      /**
       * Server-backed dotfile (brief 49): durable user config that belongs to the
       * account, not to one browser. `prefsStorage` mirrors to localStorage for
       * the pre-auth first paint and writes through to `/api/prefs`.
       */
      storage: createJSONStorage(() => prefsStorage),
    }
  )
)
