import { describe, expect, it } from 'vitest'
import { deliveryFor, normaliseIntent, type Phase } from './intentDelivery'

/**
 * The re-delivery rule (brief 108). Archive Manager is the only single-instance
 * app declaring `opens`, so it is the one place a second double-click used to
 * be silently dropped.
 */

describe('normaliseIntent', () => {
  it("passes this app's own intents through untouched", () => {
    const extract = { action: 'extract', root: 'home', path: 'a.zip', dest: 'out' }
    expect(normaliseIntent(extract)).toBe(extract)
    const compress = { action: 'compress', root: 'home', paths: ['x'], dest: 'a.zip' }
    expect(normaliseIntent(compress)).toBe(compress)
  })

  it('translates the generic open payload into a BROWSE (no dest)', () => {
    expect(normaliseIntent({ openPath: 'b.zip', root: 'home' })).toEqual({
      action: 'extract',
      root: 'home',
      path: 'b.zip',
    })
  })

  it('ignores junk', () => {
    expect(normaliseIntent(null)).toBeNull()
    expect(normaliseIntent(undefined)).toBeNull()
    expect(normaliseIntent('a.zip')).toBeNull()
    expect(normaliseIntent({ openPath: 'a.zip' })).toBeNull()
    expect(normaliseIntent({ root: 'home' })).toBeNull()
  })
})

describe('deliveryFor', () => {
  const intent = { action: 'extract', root: 'home', path: 'b.zip' } as const

  it('runs immediately in every non-running phase — browsing A then opening B switches', () => {
    for (const phase of ['idle', 'listing', 'browsing', 'done', 'error'] as Phase[]) {
      expect(deliveryFor(phase, intent)).toBe('run')
    }
  })

  it('defers while an extraction is running — the job cannot be cancelled', () => {
    expect(deliveryFor('running', intent)).toBe('defer')
  })

  it('ignores a payload that normalises to nothing, in any phase', () => {
    expect(deliveryFor('browsing', null)).toBe('ignore')
    expect(deliveryFor('running', null)).toBe('ignore')
  })
})
