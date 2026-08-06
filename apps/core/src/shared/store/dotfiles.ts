import { useAssociationStore } from '../registry/associations'
import { useAddonStore } from './addonStore'
import { useAppearanceStore, applyAppearance } from './appearanceStore'
import { useDesktopStore } from './desktopStore'
import { useWallpaperStore } from './wallpaperStore'

/**
 * Re-read every dotfile store from the mirror, after the server has filled it
 * (brief 49).
 *
 * This is the step the design needs and is easy to miss: zustand's `persist`
 * hydrates **once, at store creation**, which happens at import time — long
 * before there is a session to fetch `/api/prefs` with. Populating the cache
 * afterwards therefore changes nothing on its own; the stores are already
 * sitting on whatever they read at import (their defaults, on a browser that
 * has never seen this machine). `rehydrate()` is what makes the server's copy
 * actually take effect, and without it "your settings follow you to another
 * browser" silently does not happen.
 *
 * Appearance is re-applied afterwards because it is the one store whose value
 * is painted onto `<html>` rather than read during render.
 */
export async function rehydrateDotfileStores(): Promise<void> {
  await Promise.all([
    useAppearanceStore.persist.rehydrate(),
    useWallpaperStore.persist.rehydrate(),
    useDesktopStore.persist.rehydrate(),
    useAddonStore.persist.rehydrate(),
    useAssociationStore.persist.rehydrate(),
  ])
  const { theme, accent } = useAppearanceStore.getState()
  applyAppearance(theme, accent)
}
