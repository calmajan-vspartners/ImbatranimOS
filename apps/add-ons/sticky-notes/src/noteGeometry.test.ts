import { describe, expect, it } from 'vitest'
import { MAX_H, MAX_W, MIN_H, MIN_W, clampNote } from './noteGeometry'

const DESKTOP = { width: 1280, height: 676 } // 720 viewport minus the 44px taskbar

describe('clampNote — a note must never become unreachable', () => {
  it('leaves a note that is already inside alone', () => {
    expect(clampNote({ x: 320, y: 240, w: 200, h: 180 }, DESKTOP)).toEqual({
      x: 320,
      y: 240,
      w: 200,
      h: 180,
    })
  })

  it('keeps a note-width on screen when dragged off the right edge', () => {
    // Dropped far past the edge: the note stops with MIN_W still visible, so there
    // is something left to grab after a reload.
    const { x } = clampNote({ x: 5000, y: 100, w: 200, h: 180 }, DESKTOP)
    expect(x).toBe(DESKTOP.width - MIN_W)
    expect(x + MIN_W).toBeLessThanOrEqual(DESKTOP.width)
  })

  it('keeps the header on screen when dragged off the bottom edge', () => {
    // Vertically it is the header that matters — the drag handle is in it.
    const { y } = clampNote({ x: 100, y: 5000, w: 200, h: 180 }, DESKTOP)
    expect(y).toBe(DESKTOP.height - 28)
    expect(y).toBeLessThan(DESKTOP.height)
  })

  it('refuses negative coordinates from a drag past the top-left', () => {
    expect(clampNote({ x: -400, y: -400, w: 200, h: 180 }, DESKTOP)).toMatchObject({
      x: 0,
      y: 0,
    })
  })

  it('pins x to 0 on a desktop narrower than the visible margin', () => {
    // `bounds.width - MIN_W` goes negative here; the note must not get a negative
    // left, which would put its controls off the screen. `y: 10` is untouched —
    // 80px of height still leaves 52px of room for the header.
    expect(clampNote({ x: 50, y: 10, w: 200, h: 180 }, { width: 80, height: 80 })).toMatchObject({
      x: 0,
      y: 10,
    })
  })

  it('clamps a resize to the range the backend DTO accepts', () => {
    // A size outside these bounds is a 400, which would roll the gesture back and
    // read as a broken drag.
    expect(clampNote({ x: 0, y: 0, w: 10, h: 4 }, DESKTOP)).toMatchObject({
      w: MIN_W,
      h: MIN_H,
    })
    expect(clampNote({ x: 0, y: 0, w: 9000, h: 9000 }, DESKTOP)).toMatchObject({
      w: MAX_W,
      h: MAX_H,
    })
  })

  it('rounds every value, because the server takes integers', () => {
    expect(clampNote({ x: 12.7, y: 8.2, w: 200.4, h: 180.6 }, DESKTOP)).toEqual({
      x: 13,
      y: 8,
      w: 200,
      h: 181,
    })
  })

  it('clamps a note wider than the desktop to x = 0, not off the left', () => {
    // Position is clamped against the bounds, not against the clamped size, so an
    // oversized note sits at the origin instead of being pushed off-screen.
    const box = clampNote({ x: 400, y: 20, w: 2000, h: 180 }, { width: 400, height: 400 })
    expect(box.x).toBe(400 - MIN_W)
    expect(box.w).toBe(MAX_W)
  })
})
