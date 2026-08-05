import { describe, expect, it } from 'vitest'
import { advance, canAdvance, nextRepeatMode, shuffledOrder } from './queueOrder'

const queue = ['a.mp3', 'b.mp3', 'c.mp3']

describe('advance', () => {
  it('walks forwards and backwards', () => {
    expect(advance(queue, 'a.mp3', 1, 'off')).toBe('b.mp3')
    expect(advance(queue, 'b.mp3', -1, 'off')).toBe('a.mp3')
  })

  it('stops at the ends with repeat off', () => {
    expect(advance(queue, 'c.mp3', 1, 'off')).toBeNull()
    expect(advance(queue, 'a.mp3', -1, 'off')).toBeNull()
  })

  it('wraps with repeat all, in both directions', () => {
    expect(advance(queue, 'c.mp3', 1, 'all')).toBe('a.mp3')
    expect(advance(queue, 'a.mp3', -1, 'all')).toBe('c.mp3')
  })

  it('replays the same track when repeat-one ENDS a track', () => {
    expect(advance(queue, 'b.mp3', 1, 'one', 'ended')).toBe('b.mp3')
  })

  it('still moves when repeat-one and the user presses Next', () => {
    // A repeat mode that disables the Next button is a bug, not a feature.
    expect(advance(queue, 'b.mp3', 1, 'one', 'manual')).toBe('c.mp3')
    expect(advance(queue, 'b.mp3', -1, 'one', 'manual')).toBe('a.mp3')
  })

  it('starts from an end when the current track is not in the queue', () => {
    // Happens for real: the folder was re-listed and the file is gone, or nothing has been
    // selected yet. Returning null here would make the buttons dead.
    expect(advance(queue, 'gone.mp3', 1, 'off')).toBe('a.mp3')
    expect(advance(queue, null, -1, 'off')).toBe('c.mp3')
  })

  it('is null for an empty queue', () => {
    expect(advance([], 'a.mp3', 1, 'all')).toBeNull()
  })

  it('replays a one-track queue with repeat all', () => {
    expect(advance(['only.mp3'], 'only.mp3', 1, 'all')).toBe('only.mp3')
  })
})

describe('canAdvance', () => {
  it('mirrors advance, so a button is never enabled when nothing would happen', () => {
    expect(canAdvance(queue, 'c.mp3', 1, 'off')).toBe(false)
    expect(canAdvance(queue, 'c.mp3', 1, 'all')).toBe(true)
    expect(canAdvance(queue, 'c.mp3', 1, 'one')).toBe(true)
  })
})

describe('shuffledOrder', () => {
  it('keeps every track exactly once', () => {
    const shuffled = shuffledOrder(queue, 12345)
    expect([...shuffled].sort()).toEqual([...queue].sort())
  })

  it('is stable for a seed, so "next track" does not change between renders', () => {
    expect(shuffledOrder(queue, 7)).toEqual(shuffledOrder(queue, 7))
  })

  it('depends only on the paths and the seed', () => {
    // Not on the playing track: an earlier version pinned it to the front, which re-derived
    // the order on every track change and made Next revisit tracks (measured: b, c, b).
    const many = Array.from({ length: 12 }, (_, i) => `t${i}.mp3`)
    const order = shuffledOrder(many, 4)
    expect(shuffledOrder(many, 4)).toEqual(order)
    expect(new Set(order).size).toBe(12)
  })

  it('actually reorders a longer queue', () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}.mp3`)
    expect(shuffledOrder(many, 42)).not.toEqual(many)
    expect(shuffledOrder(many, 42).length).toBe(30)
  })

  it('handles an empty queue', () => {
    expect(shuffledOrder([], 1)).toEqual([])
  })
})

describe('nextRepeatMode', () => {
  it('cycles off → all → one → off', () => {
    expect(nextRepeatMode('off')).toBe('all')
    expect(nextRepeatMode('all')).toBe('one')
    expect(nextRepeatMode('one')).toBe('off')
  })
})
