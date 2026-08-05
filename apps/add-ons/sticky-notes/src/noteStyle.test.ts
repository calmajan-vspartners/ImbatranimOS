import { describe, expect, it } from 'vitest'
import {
  COLOR_OPTIONS,
  COLOR_SWATCH,
  EMPTY_LABEL,
  noteColorClass,
  notePreview,
  noteTitle,
} from './noteStyle'

describe('the palette', () => {
  it('matches the backend DTO exactly', () => {
    // `COLORS` in create-sticky-note.dto.ts. If the two drift, the server accepts a
    // colour the picker cannot offer, or the picker offers one the server rejects.
    expect(COLOR_OPTIONS).toEqual(['blue', 'green', 'amber', 'red', 'purple', 'slate'])
  })

  it('has a fill class and a swatch for every option', () => {
    // A missing entry renders `undefined` into the class list — invisible in a
    // review, invisible in a typecheck if the map is ever widened to a plain object.
    for (const color of COLOR_OPTIONS) {
      expect(noteColorClass(color)).toMatch(/^border-\S+ bg-\S+$/)
      expect(COLOR_SWATCH[color]).toMatch(/^bg-\S+$/)
    }
  })

  it('falls back to the neutral surface when a note has no colour', () => {
    // `null` is a real value here, not "unset" — the picker can clear a colour.
    expect(noteColorClass(null)).toBe('border-outline-variant bg-surface-container')
  })

  it('gives every colour a distinct fill', () => {
    expect(new Set(COLOR_OPTIONS.map(noteColorClass)).size).toBe(COLOR_OPTIONS.length)
  })
})

describe('noteTitle / notePreview', () => {
  it('takes the first non-blank line', () => {
    expect(noteTitle('\n\n  buy milk\nand eggs')).toBe('buy milk')
  })

  it('truncates a long first line rather than overflowing the row', () => {
    expect(noteTitle('x'.repeat(200))).toHaveLength(60)
  })

  it('is empty for a note with nothing but whitespace', () => {
    expect(noteTitle('   \n\t\n ')).toBe('')
  })

  it('labels an empty note instead of showing a blank row', () => {
    // A note is created empty and opened straight into the editor, so this is the
    // very first thing the list shows for it.
    expect(notePreview('')).toBe(EMPTY_LABEL)
    expect(notePreview('  \n ')).toBe(EMPTY_LABEL)
  })

  it('shows the text when there is text', () => {
    expect(notePreview('a scrap')).toBe('a scrap')
  })
})
