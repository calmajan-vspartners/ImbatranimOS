import { useCallback, useState } from 'react'

// Component-local persistence for the preview pane (on/off + width), same
// load/save-with-try/catch shape as the core window-layout store — just
// without a zustand dependency, since file-manager doesn't already have one
// and this add-on stays at zero new deps.

export type PreviewPaneSettings = {
  open: boolean
  width: number
}

const STORAGE_KEY = 'imbatranim:file-manager:preview-pane'

export const PREVIEW_PANE_MIN_WIDTH = 220
export const PREVIEW_PANE_MAX_WIDTH = 480

/** Where Home (and a double-click on the splitter) puts the pane back. */
export const PREVIEW_PANE_DEFAULT_WIDTH = 280

const DEFAULT_SETTINGS: PreviewPaneSettings = { open: false, width: PREVIEW_PANE_DEFAULT_WIDTH }

function clampWidth(width: number): number {
  return Math.min(PREVIEW_PANE_MAX_WIDTH, Math.max(PREVIEW_PANE_MIN_WIDTH, width))
}

function loadSettings(): PreviewPaneSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<PreviewPaneSettings>
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : DEFAULT_SETTINGS.open,
      width: typeof parsed.width === 'number' ? clampWidth(parsed.width) : DEFAULT_SETTINGS.width,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: PreviewPaneSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // quota exceeded or private mode — silently skip
  }
}

export function usePreviewPaneSettings() {
  const [settings, setSettings] = useState<PreviewPaneSettings>(loadSettings)

  const toggle = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, open: !prev.open }
      saveSettings(next)
      return next
    })
  }, [])

  const setWidth = useCallback((width: number) => {
    setSettings((prev) => {
      const next = { ...prev, width: clampWidth(width) }
      saveSettings(next)
      return next
    })
  }, [])

  return { open: settings.open, width: settings.width, toggle, setWidth }
}
