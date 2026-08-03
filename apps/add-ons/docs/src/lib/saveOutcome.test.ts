import { describe, expect, it } from 'vitest'
import { shouldClearDirty } from './saveOutcome'

describe('shouldClearDirty', () => {
  it('clears when the upload resolved and nothing changed mid-flight', () => {
    expect(shouldClearDirty({ uploaded: true, editCountBefore: 4, editCountAfter: 4 })).toBe(true)
  })

  it('keeps the document dirty when the upload failed', () => {
    // The whole point of brief 62: a rejected write leaves the document
    // differing from disk, so the marker stays and the close guard stays armed.
    expect(shouldClearDirty({ uploaded: false, editCountBefore: 4, editCountAfter: 4 })).toBe(false)
  })

  it('keeps it dirty when the upload failed even if edits also landed', () => {
    expect(shouldClearDirty({ uploaded: false, editCountBefore: 4, editCountAfter: 9 })).toBe(false)
  })

  it('keeps it dirty when an edit landed while the save was in flight', () => {
    // Export happens before upload, so those edits are not in the bytes sent.
    expect(shouldClearDirty({ uploaded: true, editCountBefore: 4, editCountAfter: 5 })).toBe(false)
  })

  it('is not fooled by a counter that only ever goes up', () => {
    // Guards against someone "simplifying" this to `editCountAfter <= before`.
    expect(shouldClearDirty({ uploaded: true, editCountBefore: 5, editCountAfter: 4 })).toBe(false)
  })
})
