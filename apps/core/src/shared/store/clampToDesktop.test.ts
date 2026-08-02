import { describe, expect, it } from 'vitest'
import { TASKBAR_HEIGHT, clampToDesktop } from './windowStore'

const min = { width: 320, height: 200 }

describe('clampToDesktop', () => {
  it('leaves a window that already fits alone', () => {
    const out = clampToDesktop({ width: 800, height: 500 }, min, {
      width: 1440,
      height: 900,
    })
    expect(out).toEqual({ width: 800, height: 500 })
  })

  it('clamps a height that would render under the taskbar', () => {
    // The bug: Calendar/Code Editor declare heights that cannot fit a 577px
    // viewport, and the overflow is unreachable because the desktop layer is
    // overflow-hidden and windows do not scroll.
    const viewport = { width: 1280, height: 577 }
    const out = clampToDesktop({ width: 900, height: 720 }, min, viewport)
    expect(out.height).toBe(viewport.height - TASKBAR_HEIGHT)
    expect(out.height + TASKBAR_HEIGHT).toBeLessThanOrEqual(viewport.height)
  })

  it('clamps width to the viewport', () => {
    const out = clampToDesktop({ width: 2000, height: 300 }, min, {
      width: 1024,
      height: 768,
    })
    expect(out.width).toBe(1024)
  })

  it('lets minSize win when the viewport cannot even hold the minimum', () => {
    // Deliberate: a squashed, broken layout is worse than an overflowing one,
    // and an honest minSize is the app's responsibility.
    const out = clampToDesktop(
      { width: 900, height: 700 },
      { width: 500, height: 400 },
      {
        width: 400,
        height: 300,
      }
    )
    expect(out).toEqual({ width: 500, height: 400 })
  })

  it('accounts for the taskbar, not just the viewport height', () => {
    const viewport = { width: 1000, height: 500 }
    const out = clampToDesktop({ width: 800, height: 500 }, min, viewport)
    expect(out.height).toBe(500 - TASKBAR_HEIGHT)
  })
})
