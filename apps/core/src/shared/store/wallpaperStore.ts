import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { prefsStorage } from '../../lib/prefs'

export type Wallpaper = 'dots' | 'grid' | 'linen'

type WallpaperStore = {
  wallpaper: Wallpaper
  setWallpaper: (w: Wallpaper) => void
}

export const useWallpaperStore = create<WallpaperStore>()(
  persist(
    (set) => ({
      wallpaper: 'dots',
      setWallpaper: (w) => set({ wallpaper: w }),
    }),
    {
      name: 'wallpaper-storage',
      /**
       * Server-backed dotfile (brief 49): durable user config that belongs to the
       * account, not to one browser. `prefsStorage` mirrors to localStorage for
       * the pre-auth first paint and writes through to `/api/prefs`.
       */
      storage: createJSONStorage(() => prefsStorage),
    }
  )
)
