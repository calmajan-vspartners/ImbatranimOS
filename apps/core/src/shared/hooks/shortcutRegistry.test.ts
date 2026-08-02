// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatKeys,
  groupShortcuts,
  isTextEntry,
  useShortcutStore,
  type Shortcut,
} from './shortcutRegistry'

const s = (over: Partial<Shortcut> = {}): Shortcut => ({
  id: 'x',
  keys: 'mod+k',
  description: 'do a thing',
  scope: 'Global',
  ...over,
})

beforeEach(() => {
  useShortcutStore.setState({ shortcuts: {} })
})

describe('shortcut registry', () => {
  it('registers and lists shortcuts', () => {
    useShortcutStore.getState().register([s({ id: 'a' }), s({ id: 'b', keys: 'mod+j' })])
    expect(Object.keys(useShortcutStore.getState().shortcuts).sort()).toEqual(['a', 'b'])
  })

  it('re-registering the same id replaces rather than duplicates', () => {
    // Matters for HMR and for a remounting component.
    useShortcutStore.getState().register([s({ id: 'a', description: 'first' })])
    useShortcutStore.getState().register([s({ id: 'a', description: 'second' })])
    const all = Object.values(useShortcutStore.getState().shortcuts)
    expect(all).toHaveLength(1)
    expect(all[0].description).toBe('second')
  })

  it('unregisters by id', () => {
    useShortcutStore.getState().register([s({ id: 'a' }), s({ id: 'b', keys: 'mod+j' })])
    useShortcutStore.getState().unregister(['a'])
    expect(Object.keys(useShortcutStore.getState().shortcuts)).toEqual(['b'])
  })

  it('warns when two different shortcuts claim the same keys in a scope', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useShortcutStore.getState().register([s({ id: 'a' })])
    useShortcutStore.getState().register([s({ id: 'b' })]) // same keys, same scope
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('does not warn when the same id re-registers its own keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useShortcutStore.getState().register([s({ id: 'a' })])
    useShortcutStore.getState().register([s({ id: 'a' })])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('groupShortcuts', () => {
  it('groups by scope in display order and drops empty groups', () => {
    const groups = groupShortcuts([
      s({ id: 'a', scope: 'Editing' }),
      s({ id: 'b', scope: 'Global', keys: 'mod+k' }),
    ])
    expect(groups.map(([scope]) => scope)).toEqual(['Global', 'Editing'])
  })
})

describe('isTextEntry', () => {
  it.each(['input', 'textarea', 'select'])('is true for <%s>', (tag) => {
    expect(isTextEntry(document.createElement(tag))).toBe(true)
  })

  it('is true for a contenteditable element', () => {
    const el = document.createElement('div')
    el.contentEditable = 'true'
    // jsdom does not implement isContentEditable; assert on the intent.
    Object.defineProperty(el, 'isContentEditable', { value: true })
    expect(isTextEntry(el)).toBe(true)
  })

  it('is false for an ordinary element and for null', () => {
    expect(isTextEntry(document.createElement('div'))).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})

describe('formatKeys', () => {
  it('renders Ctrl on non-Mac and ⌘ on Mac', () => {
    expect(formatKeys('mod+k', false)).toBe('Ctrl + K')
    expect(formatKeys('mod+k', true)).toBe('⌘ + K')
  })

  it('renders named keys readably', () => {
    expect(formatKeys('alt+tab', false)).toBe('Alt + Tab')
    expect(formatKeys('mod+enter', false)).toBe('Ctrl + Enter')
  })
})
