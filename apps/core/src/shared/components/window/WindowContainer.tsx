import { useShallow } from 'zustand/shallow'
import { topVisibleWindowId, useWindowStore } from '../../store/windowStore'
import { Window } from './Window'

// Field separator for the per-window projection key. `␟` (SYMBOL FOR UNIT
// SEPARATOR) cannot occur in a uuid or an app-id slug, so splitting is safe.
const SEP = '␟'

/**
 * Subscribe to a projection that deliberately omits `position`/`size`, so the
 * ~60fps geometry churn of a drag/resize does NOT re-render this container. Only
 * a change to identity, stacking order (zIndex) or visibility does. `useShallow`
 * caches the array while the projected strings are unchanged — projecting to
 * *objects* would defeat it (freshly-built objects are never shallow-equal), the
 * same trap the raw-array subscription used to fall into.
 */
function useOrderedWindows(): { id: string; appId: string; zIndex: number; isVisible: boolean }[] {
  const keys = useWindowStore(
    useShallow((s) =>
      s.windows.map((w) => `${w.id}${SEP}${w.appId}${SEP}${w.zIndex}${SEP}${w.isVisible ? 1 : 0}`)
    )
  )
  return keys
    .map((k) => {
      const [id, appId, zIndex, isVisible] = k.split(SEP)
      return { id, appId, zIndex: Number(zIndex), isVisible: isVisible === '1' }
    })
    .sort((a, b) => a.zIndex - b.zIndex)
}

export function WindowContainer() {
  const orderedWindows = useOrderedWindows()
  // The one shared definition of "focused" — taskbar highlight, window chrome and
  // hotkey target all read this same helper so they can never disagree.
  const focusedId = topVisibleWindowId()

  return (
    // Own stacking context: window zIndex grows unboundedly (persisted, bumped on
    // every focus), so left in the root context it would climb past portaled
    // overlays and swallow dialogs/selects/tooltips. `isolation:isolate` confines
    // the whole window band to this wrapper; overlays sit in a higher band above it.
    <div style={{ isolation: 'isolate' }}>
      {orderedWindows.map((w) => (
        <Window key={w.id} windowId={w.id} appId={w.appId} isFocused={w.id === focusedId} />
      ))}
    </div>
  )
}
