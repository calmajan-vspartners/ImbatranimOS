import { describe, it, expect } from 'vitest'
import { classifyVerbKey, type VerbKeyContext, type VerbKeyEvent } from './verbKeys'

const IDLE: VerbKeyContext = { renaming: false, modalOpen: false, menuOpen: false }

const ev = (over: Partial<VerbKeyEvent>): VerbKeyEvent => ({
  key: 'a',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  targetTag: 'DIV',
  targetEditable: false,
  ...over,
})

describe('the verb set', () => {
  it('F2 renames', () => {
    expect(classifyVerbKey(ev({ key: 'F2' }), IDLE)).toBe('rename')
  })

  it('Delete trashes and Shift+Delete deletes permanently', () => {
    expect(classifyVerbKey(ev({ key: 'Delete' }), IDLE)).toBe('trash')
    expect(classifyVerbKey(ev({ key: 'Delete', shiftKey: true }), IDLE)).toBe('delete-permanently')
  })

  it('Ctrl+C/X/V/A are copy/cut/paste/select-all', () => {
    expect(classifyVerbKey(ev({ key: 'c', ctrlKey: true }), IDLE)).toBe('copy')
    expect(classifyVerbKey(ev({ key: 'x', ctrlKey: true }), IDLE)).toBe('cut')
    expect(classifyVerbKey(ev({ key: 'v', ctrlKey: true }), IDLE)).toBe('paste')
    expect(classifyVerbKey(ev({ key: 'a', ctrlKey: true }), IDLE)).toBe('select-all')
  })

  it('accepts meta for the same verbs, and a capitalised key', () => {
    expect(classifyVerbKey(ev({ key: 'C', metaKey: true }), IDLE)).toBe('copy')
  })

  it('opens the menu from the menu key and from Shift+F10', () => {
    expect(classifyVerbKey(ev({ key: 'ContextMenu' }), IDLE)).toBe('context-menu')
    expect(classifyVerbKey(ev({ key: 'F10', shiftKey: true }), IDLE)).toBe('context-menu')
    expect(classifyVerbKey(ev({ key: 'F10' }), IDLE)).toBeNull()
  })
})

describe('keys that are not ours', () => {
  it('leaves plain letters, arrows and Enter alone', () => {
    for (const key of ['a', 'z', 'ArrowDown', 'Enter', 'Escape', 'Tab']) {
      expect(classifyVerbKey(ev({ key }), IDLE)).toBeNull()
    }
  })

  it('leaves Ctrl+H to the hidden-files toggle', () => {
    expect(classifyVerbKey(ev({ key: 'h', ctrlKey: true }), IDLE)).toBeNull()
  })

  it('leaves Ctrl+F to the search box', () => {
    expect(classifyVerbKey(ev({ key: 'f', ctrlKey: true }), IDLE)).toBeNull()
  })

  it('never shadows Ctrl+Shift+letter (devtools and other apps own those)', () => {
    expect(classifyVerbKey(ev({ key: 'c', ctrlKey: true, shiftKey: true }), IDLE)).toBeNull()
    expect(classifyVerbKey(ev({ key: 'a', ctrlKey: true, shiftKey: true }), IDLE)).toBeNull()
  })

  it('never shadows Alt — the window manager and menus own it', () => {
    expect(classifyVerbKey(ev({ key: 'F2', altKey: true }), IDLE)).toBeNull()
    expect(classifyVerbKey(ev({ key: 'Delete', altKey: true }), IDLE)).toBeNull()
  })
})

describe('inertness — the part that would eat a file', () => {
  const VERBS: VerbKeyEvent[] = [
    ev({ key: 'F2' }),
    ev({ key: 'Delete' }),
    ev({ key: 'Delete', shiftKey: true }),
    ev({ key: 'c', ctrlKey: true }),
    ev({ key: 'x', ctrlKey: true }),
    ev({ key: 'v', ctrlKey: true }),
    ev({ key: 'a', ctrlKey: true }),
    ev({ key: 'ContextMenu' }),
  ]

  it('is dead while an inline rename is in progress', () => {
    for (const e of VERBS) expect(classifyVerbKey(e, { ...IDLE, renaming: true })).toBeNull()
  })

  it('is dead while any modal is open', () => {
    for (const e of VERBS) expect(classifyVerbKey(e, { ...IDLE, modalOpen: true })).toBeNull()
  })

  it('is dead while the context menu is open — it owns the keyboard', () => {
    for (const e of VERBS) expect(classifyVerbKey(e, { ...IDLE, menuOpen: true })).toBeNull()
  })

  it('is dead when the key was typed into a field', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      for (const e of VERBS) expect(classifyVerbKey({ ...e, targetTag: tag }, IDLE)).toBeNull()
    }
    for (const e of VERBS) {
      expect(classifyVerbKey({ ...e, targetEditable: true }, IDLE)).toBeNull()
    }
  })
})
