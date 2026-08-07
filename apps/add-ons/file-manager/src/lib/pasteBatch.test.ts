import { describe, it, expect } from 'vitest'
import { isNoOpPaste, pasteFailureMessage, pasteMoves } from './pasteBatch'
import type { FsEntry } from '../types'

const file = (path: string): FsEntry => ({
  name: path.split('/').pop() as string,
  path,
  type: 'file',
  size: 0,
  modifiedAt: '',
})

describe('pasteMoves', () => {
  it('lands each entry under the destination directory', () => {
    expect(pasteMoves([file('docs/a.txt'), file('docs/b.txt')], 'archive')).toEqual([
      { from: 'docs/a.txt', to: 'archive/a.txt', name: 'a.txt' },
      { from: 'docs/b.txt', to: 'archive/b.txt', name: 'b.txt' },
    ])
  })

  it('drops the leading slash at the root', () => {
    expect(pasteMoves([file('docs/a.txt')], '')).toEqual([
      { from: 'docs/a.txt', to: 'a.txt', name: 'a.txt' },
    ])
  })

  it('takes the basename from the path, not the display name', () => {
    const odd: FsEntry = { ...file('docs/real.txt'), name: 'Display Name' }
    expect(pasteMoves([odd], 'x')[0]).toEqual({
      from: 'docs/real.txt',
      to: 'x/real.txt',
      name: 'real.txt',
    })
  })
})

describe('isNoOpPaste', () => {
  it('flags pasting an entry back into the folder it came from', () => {
    expect(isNoOpPaste(pasteMoves([file('docs/a.txt')], 'docs')[0])).toBe(true)
  })

  it('allows a paste into a different folder', () => {
    expect(isNoOpPaste(pasteMoves([file('docs/a.txt')], 'other')[0])).toBe(false)
  })
})

describe('pasteFailureMessage', () => {
  it('says nothing when everything landed', () => {
    expect(pasteFailureMessage('copy', [], 3)).toBeNull()
  })

  it('names the file when there was only one', () => {
    const [m] = pasteMoves([file('a.txt')], 'x')
    expect(pasteFailureMessage('copy', [m], 1)).toBe('Could not paste “a.txt”.')
    expect(pasteFailureMessage('cut', [m], 1)).toBe('Could not move “a.txt”.')
  })

  it('counts honestly on a partial failure rather than claiming all of it failed', () => {
    const moves = pasteMoves([file('a.txt'), file('b.txt'), file('c.txt')], 'x')
    expect(pasteFailureMessage('copy', moves.slice(0, 2), 3)).toBe('Could not paste 2 of 3 items.')
  })
})
