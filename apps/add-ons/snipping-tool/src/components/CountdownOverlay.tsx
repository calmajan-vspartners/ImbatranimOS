/**
 * The delay-capture countdown.
 *
 * `pointerEvents: 'none'` is the entire point of this component. Delay capture exists to
 * photograph things that vanish when you click — an open menu, a hover state — so during
 * the countdown the desktop must be fully usable. An overlay that swallowed clicks would
 * make the feature impossible to use for its only purpose.
 *
 * It is tagged `data-snip-overlay` so the rasterizer filters it out; without that, every
 * delayed capture would have a countdown badge printed on it.
 */
export function CountdownOverlay({ remaining }: { remaining: number }) {
  return (
    <div
      data-snip-overlay
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 16,
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div
        style={{
          padding: '6px 14px',
          fontSize: 12,
          fontWeight: 600,
          color: '#fff',
          background: 'rgba(20,20,24,0.85)',
          border: '1px solid rgba(255,255,255,0.15)',
          whiteSpace: 'nowrap',
        }}
      >
        Capturing the whole desktop in {remaining}s — open what you need now
      </div>
    </div>
  )
}
