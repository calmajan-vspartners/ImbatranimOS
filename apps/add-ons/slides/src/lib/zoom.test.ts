import { describe, expect, it } from 'vitest'
import { DEFAULT_ZOOM, resolveScale, stepZoom, zoomLabel, ZOOM_STEPS } from './zoom'

const slide = { width: 960, height: 540 }

describe('resolveScale', () => {
  it('fits the width', () => {
    expect(resolveScale({ mode: 'fit-width', scale: 1 }, slide, { width: 480, height: 999 })).toBe(
      0.5
    )
  })

  it('fits the page by the smaller ratio, so the whole slide is visible', () => {
    // Width would allow 1.0 but the height only allows 0.5; picking width would
    // crop the bottom of the slide, which is not "fit page".
    expect(resolveScale({ mode: 'fit-page', scale: 1 }, slide, { width: 960, height: 270 })).toBe(
      0.5
    )
  })

  it('uses a fixed scale verbatim', () => {
    expect(resolveScale({ mode: 'fixed', scale: 1.25 }, slide, { width: 100, height: 100 })).toBe(
      1.25
    )
  })

  it('returns 1 rather than NaN for a zero-sized viewport or slide', () => {
    // Happens before first layout and when a window is dragged to nothing. NaN
    // reaches CSS, which drops it silently, leaving the old scale in place.
    expect(resolveScale(DEFAULT_ZOOM, slide, { width: 0, height: 0 })).toBe(1)
    expect(resolveScale(DEFAULT_ZOOM, { width: 0, height: 0 }, { width: 800, height: 600 })).toBe(1)
  })

  it('ignores non-finite inputs', () => {
    expect(resolveScale(DEFAULT_ZOOM, slide, { width: NaN, height: 600 })).toBe(1)
    expect(resolveScale({ mode: 'fixed', scale: Infinity }, slide, { width: 8, height: 6 })).toBe(1)
  })

  it('clamps absurd scales instead of rendering a 40x slide', () => {
    expect(
      resolveScale(
        { mode: 'fit-width', scale: 1 },
        { width: 10, height: 10 },
        { width: 4000, height: 4000 }
      )
    ).toBe(4)
    expect(resolveScale({ mode: 'fixed', scale: 0.0001 }, slide, { width: 1, height: 1 })).toBe(0.1)
  })
})

describe('stepZoom', () => {
  it('walks up and down the fixed steps', () => {
    expect(stepZoom(1, 1)).toEqual({ mode: 'fixed', scale: 1.25 })
    expect(stepZoom(1, -1)).toEqual({ mode: 'fixed', scale: 0.75 })
  })

  it('steps from an arbitrary fitted scale to the next real step', () => {
    // Coming out of fit-width at 0.62, zooming in should land on 0.75 rather
    // than jumping to 1.
    expect(stepZoom(0.62, 1)).toEqual({ mode: 'fixed', scale: 0.75 })
    expect(stepZoom(0.62, -1)).toEqual({ mode: 'fixed', scale: 0.5 })
  })

  it('stops at the ends instead of wrapping', () => {
    const last = ZOOM_STEPS[ZOOM_STEPS.length - 1]
    expect(stepZoom(last, 1).scale).toBe(last)
    expect(stepZoom(ZOOM_STEPS[0], -1).scale).toBe(ZOOM_STEPS[0])
  })
})

describe('zoomLabel', () => {
  it('names the fitted modes and shows a percentage otherwise', () => {
    expect(zoomLabel({ mode: 'fit-width', scale: 1 }, 0.62)).toBe('Fit width')
    expect(zoomLabel({ mode: 'fit-page', scale: 1 }, 0.5)).toBe('Fit page')
    expect(zoomLabel({ mode: 'fixed', scale: 1.25 }, 1.25)).toBe('125%')
  })
})
