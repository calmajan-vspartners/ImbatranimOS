import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractNotes } from './notes'

/**
 * The fixture (python-pptx) has notes on slides 1, 2, 4 and 5 and **none on
 * slide 3** — chosen deliberately, because that is the case where indexing
 * `notesSlideN.xml` by slide number silently shows slide 4 the note that belongs
 * to slide 5.
 */
const deck = () => {
  const buf = readFileSync(join(__dirname, '__fixtures__', 'deck.pptx'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

describe('extractNotes', () => {
  it('returns one entry per slide, in slide order', async () => {
    const notes = await extractNotes(deck())
    expect(notes).toHaveLength(5)
  })

  it('maps notes to the right slides even though the parts are not numbered to match', async () => {
    const notes = await extractNotes(deck())
    expect(notes[0]).toContain('remember to breathe')
    expect(notes[1]).toBe('Note two.')
    // Slide 3 has no notes at all, so notesSlide3.xml belongs to slide 4.
    expect(notes[2]).toBe('')
    expect(notes[3]).toContain('Note four')
    expect(notes[4]).toBe('Final note.')
  })

  it('does not leak the slide-number placeholder into the note', async () => {
    const notes = await extractNotes(deck())
    // A notesSlide carries a sldNum placeholder; rendered naively it appears as a
    // stray digit that reads like part of the sentence.
    expect(notes[1]).toBe('Note two.')
    expect(notes[1]).not.toMatch(/^\d/)
  })

  it('returns an empty list rather than throwing on bytes that are not a zip', async () => {
    const junk = new TextEncoder().encode('not a deck')
    const buf = junk.buffer.slice(junk.byteOffset, junk.byteOffset + junk.byteLength) as ArrayBuffer
    expect(await extractNotes(buf)).toEqual([])
  })

  it('returns an empty list for a zip that is not a pptx', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const z = zipSync({ 'hello.txt': strToU8('hi') })
    const buf = z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer
    // Notes are an extra; they must never be why a deck fails to open.
    expect(await extractNotes(buf)).toEqual([])
  })
})
