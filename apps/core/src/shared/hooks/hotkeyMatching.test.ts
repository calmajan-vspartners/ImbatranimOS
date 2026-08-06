// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { eventMatchesBinding, parseBinding } from './useGlobalHotkeys'

/**
 * The modifier matcher, tested directly.
 *
 * Brief 85 wanted `ctrl+alt+left` and it never fired. The cause was in here and
 * it was pre-existing: off a mac, `mod` IS ctrl, and the mod guard rejected an
 * explicit `ctrl+…` binding using the very key it had asked for. Nothing caught
 * it because until now every binding in the OS used `mod`.
 */
const key = (
  k: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}
): KeyboardEvent =>
  new KeyboardEvent('keydown', {
    key: k,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
  })

const matches = (binding: string, ev: KeyboardEvent) =>
  eventMatchesBinding(ev, parseBinding(binding))

describe('an explicit ctrl+ binding', () => {
  it('FIRES on a real Ctrl press (the bug brief 85 found)', () => {
    expect(matches('ctrl+alt+left', key('ArrowLeft', { ctrl: true, alt: true }))).toBe(true)
    expect(matches('ctrl+alt+right', key('ArrowRight', { ctrl: true, alt: true }))).toBe(true)
  })

  it('does not fire without both modifiers', () => {
    expect(matches('ctrl+alt+left', key('ArrowLeft', { ctrl: true }))).toBe(false)
    expect(matches('ctrl+alt+left', key('ArrowLeft', { alt: true }))).toBe(false)
    expect(matches('ctrl+alt+left', key('ArrowLeft'))).toBe(false)
  })

  it('does not fire on a different arrow', () => {
    expect(matches('ctrl+alt+left', key('ArrowRight', { ctrl: true, alt: true }))).toBe(false)
  })

  it('is not confused by shift', () => {
    expect(matches('ctrl+alt+left', key('ArrowLeft', { ctrl: true, alt: true, shift: true }))).toBe(
      false
    )
  })
})

describe('mod bindings still behave', () => {
  it('mod+k fires on ctrl+k off a mac', () => {
    expect(matches('mod+k', key('k', { ctrl: true }))).toBe(true)
  })

  it('mod+k does not fire on a bare k', () => {
    expect(matches('mod+k', key('k'))).toBe(false)
  })

  it('a bare binding is not triggered by a modified press', () => {
    // `esc`, not `escape` — the matcher normalises the event key to the short
    // name, so the binding string has to use it too.
    expect(matches('esc', key('Escape', { ctrl: true }))).toBe(false)
    expect(matches('esc', key('Escape'))).toBe(true)
  })

  it('normalises arrow names', () => {
    expect(matches('ctrl+alt+up', key('ArrowUp', { ctrl: true, alt: true }))).toBe(true)
  })
})
