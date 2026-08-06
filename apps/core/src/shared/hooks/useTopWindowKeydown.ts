import { useEffect, useRef } from 'react'
import { isTopWindow } from '../store/windowStore'
import { isTextEntry } from './shortcutRegistry'

export interface TopWindowKeydownOptions {
  /**
   * When true (the default), the handler is skipped while the event target is
   * a text-entry element (input/textarea/select/contentEditable). An app that
   * genuinely wants keys while typing — none currently do — can opt out.
   */
  ignoreTextEntry?: boolean
  /** Listen in the capture phase (default true), matching `useSaveHotkey`. */
  capture?: boolean
}

/**
 * Bind a `keydown` handler that fires ONLY while `windowId` is the top-most
 * visible window, and (by default) never while the user is typing in a text
 * field. This is the one correct way for an add-on to own reader/transport
 * keys (Space, arrows, F, +/-, Ctrl+F…): a bare `window.addEventListener`
 * fires for every window at once and steals keystrokes from other apps and
 * from text inputs OS-wide.
 *
 * `handler` is kept in a ref so the latest closure runs without re-binding —
 * callers may pass an inline function that closes over changing state.
 */
export function useTopWindowKeydown(
  windowId: string,
  handler: (e: KeyboardEvent) => void,
  options: TopWindowKeydownOptions = {}
): void {
  const { ignoreTextEntry = true, capture = true } = options
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isTopWindow(windowId)) return
      if (ignoreTextEntry && isTextEntry(e.target)) return
      handlerRef.current(e)
    }
    window.addEventListener('keydown', onKey, capture)
    return () => window.removeEventListener('keydown', onKey, capture)
  }, [windowId, ignoreTextEntry, capture])
}
