import { describe, expect, it } from 'vitest'
import {
  hunkStats,
  parseDiff,
  patchForHunk,
  toSideBySide,
  wordDiff,
  type FileDiff,
} from './diffModel'

/** Two hunks, far enough apart that git emits them separately. */
const TWO_HUNKS = `diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,5 +1,5 @@
 line 1
-line 2
+CHANGED TOP
 line 3
 line 4
 line 5
@@ -16,4 +16,4 @@
 line 16
 line 17
 line 18
-line 19
+CHANGED BOTTOM
`

describe('parseDiff', () => {
  it('splits into files and hunks with the right line numbers', () => {
    const [file] = parseDiff(TWO_HUNKS)
    expect(file.path).toBe('f.txt')
    expect(file.oldPath).toBe('f.txt')
    expect(file.hunks).toHaveLength(2)

    const first = file.hunks[0]
    expect(first.oldStart).toBe(1)
    expect(first.newStart).toBe(1)
    expect(first.lines.map((l) => l.kind)).toEqual([
      'context',
      'del',
      'add',
      'context',
      'context',
      'context',
    ])
    // Old and new numbering advance independently around the change.
    expect(first.lines[1]).toMatchObject({ oldNo: 2, newNo: null, text: 'line 2' })
    expect(first.lines[2]).toMatchObject({ oldNo: null, newNo: 2, text: 'CHANGED TOP' })
    expect(first.lines[3]).toMatchObject({ oldNo: 3, newNo: 3 })
    // The second hunk restarts at its own offsets.
    expect(file.hunks[1].oldStart).toBe(16)
  })

  it('keeps every header line verbatim, because git apply reads them', () => {
    const [file] = parseDiff(TWO_HUNKS)
    expect(file.header).toEqual([
      'diff --git a/f.txt b/f.txt',
      'index 1111111..2222222 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
    ])
  })

  it('handles a new file, where the old side is /dev/null', () => {
    const [file] = parseDiff(
      `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..aaaaaaa
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`
    )
    expect(file.path).toBe('new.txt')
    expect(file.oldPath).toBe('')
    expect(file.header).toContain('new file mode 100644')
    expect(file.hunks[0].lines.every((l) => l.kind === 'add')).toBe(true)
  })

  it('handles a deletion, where the new side is /dev/null', () => {
    const [file] = parseDiff(
      `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
`
    )
    // Falls back to the old path so the row is not nameless.
    expect(file.path).toBe('gone.txt')
    expect(file.newPath).toBe('')
  })

  it('marks a binary file instead of pretending it has hunks', () => {
    const [file] = parseDiff(
      `diff --git a/img.png b/img.png
index 1111111..2222222 100644
Binary files a/img.png and b/img.png differ
`
    )
    expect(file.binary).toBe(true)
    expect(file.hunks).toEqual([])
  })

  it('keeps a binary file whose path contains a space', () => {
    // A binary diff has no `---`/`+++` body to recover the name from, so if the
    // `diff --git` line is misparsed the file ends up nameless and is dropped.
    // Git writes the space unquoted: `diff --git a/my file.bin b/my file.bin`.
    const [file] = parseDiff(
      `diff --git a/my file.bin b/my file.bin
index 1111111..2222222 100644
Binary files a/my file.bin and b/my file.bin differ
`
    )
    expect(file).toBeDefined()
    expect(file.path).toBe('my file.bin')
    expect(file.oldPath).toBe('my file.bin')
    expect(file.newPath).toBe('my file.bin')
    expect(file.binary).toBe(true)
  })

  it('parses several files at once', () => {
    const files = parseDiff(TWO_HUNKS + TWO_HUNKS.replace(/f\.txt/g, 'g.txt'))
    expect(files.map((f) => f.path)).toEqual(['f.txt', 'g.txt'])
  })

  it('keeps the no-newline marker inside the hunk', () => {
    // Dropping it would make an applied patch silently add a trailing newline.
    const [file] = parseDiff(
      `--- a/x
+++ b/x
@@ -1 +1 @@
-a
\\ No newline at end of file
+b
\\ No newline at end of file
`
    )
    expect(file.hunks[0].lines.filter((l) => l.kind === 'meta')).toHaveLength(2)
  })

  it('understands a hunk header with no comma (a single line)', () => {
    const [file] = parseDiff(`--- a/x\n+++ b/x\n@@ -3 +3 @@\n-a\n+b\n`)
    expect(file.hunks[0]).toMatchObject({
      oldStart: 3,
      oldCount: 1,
      newStart: 3,
      newCount: 1,
    })
  })

  it('is empty for empty input', () => {
    expect(parseDiff('')).toEqual([])
    expect(parseDiff('   \n')).toEqual([])
  })
})

describe('patchForHunk — the text git will execute', () => {
  it('carries the file header and exactly one hunk', () => {
    const [file] = parseDiff(TWO_HUNKS)
    const patch = patchForHunk(file, file.hunks[0])
    expect(patch).toContain('diff --git a/f.txt b/f.txt')
    expect(patch).toContain('CHANGED TOP')
    // The other hunk must NOT be in it — that is the whole point.
    expect(patch).not.toContain('CHANGED BOTTOM')
    expect(patch.match(/^@@/gm)).toHaveLength(1)
  })

  it('recomputes the counts from the lines it actually emits', () => {
    const [file] = parseDiff(TWO_HUNKS)
    const patch = patchForHunk(file, file.hunks[0])
    // 5 old lines (4 context + 1 deletion), 5 new (4 context + 1 addition).
    expect(patch).toContain('@@ -1,5 +1,5 @@')
  })

  it('restores the +/-/space markers exactly', () => {
    const [file] = parseDiff(TWO_HUNKS)
    const body = patchForHunk(file, file.hunks[0]).split('\n')
    expect(body).toContain('-line 2')
    expect(body).toContain('+CHANGED TOP')
    expect(body).toContain(' line 1')
  })

  it('ends with a newline, which git apply requires', () => {
    const [file] = parseDiff(TWO_HUNKS)
    expect(patchForHunk(file, file.hunks[0]).endsWith('\n')).toBe(true)
  })

  it('round-trips: parsing its own output yields the same hunk', () => {
    const [file] = parseDiff(TWO_HUNKS)
    const patch = patchForHunk(file, file.hunks[1])
    const [again] = parseDiff(patch)
    expect(again.hunks).toHaveLength(1)
    expect(again.hunks[0].lines.map((l) => `${l.kind}:${l.text}`)).toEqual(
      file.hunks[1].lines.map((l) => `${l.kind}:${l.text}`)
    )
  })

  it('keeps the no-newline marker in the patch body', () => {
    const [file] = parseDiff(
      `--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n`
    )
    expect(patchForHunk(file, file.hunks[0])).toContain('\\ No newline at end of file')
  })

  it('emits a new-file hunk with a 0 old start', () => {
    const [file] = parseDiff(
      `diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n`
    )
    expect(patchForHunk(file, file.hunks[0])).toContain('@@ -0,0 +1,2 @@')
  })
})

describe('toSideBySide', () => {
  const hunkOf = (diff: string) => parseDiff(diff)[0].hunks[0]

  it('pairs a deletion with the addition that replaced it', () => {
    const rows = toSideBySide(hunkOf(TWO_HUNKS))
    const changed = rows.filter((r) => r.paired)
    expect(changed).toHaveLength(1)
    expect(changed[0].left?.text).toBe('line 2')
    expect(changed[0].right?.text).toBe('CHANGED TOP')
  })

  it('puts a context line on both sides', () => {
    const rows = toSideBySide(hunkOf(TWO_HUNKS))
    expect(rows[0].left).toBe(rows[0].right)
    expect(rows[0].paired).toBe(false)
  })

  it('gives an unmatched deletion a blank right side, and vice versa', () => {
    const rows = toSideBySide(hunkOf(`--- a/x\n+++ b/x\n@@ -1,3 +1,2 @@\n-a\n-b\n+c\n d\n`))
    expect(rows[0]).toMatchObject({ paired: true })
    expect(rows[1].left?.text).toBe('b')
    expect(rows[1].right).toBeNull()
    expect(rows[1].paired).toBe(false)
  })

  it('does NOT pair across a context line', () => {
    // Two separate edits with unchanged code between them are two edits; pairing
    // them would invent a relationship the diff does not claim.
    const rows = toSideBySide(hunkOf(`--- a/x\n+++ b/x\n@@ -1,4 +1,4 @@\n-a\n ctx\n-b\n+B\n`))
    expect(rows[0].left?.text).toBe('a')
    expect(rows[0].right).toBeNull()
    expect(rows[1].left?.text).toBe('ctx')
    expect(rows[2]).toMatchObject({ paired: true })
    expect(rows[2].left?.text).toBe('b')
  })

  it('drops the no-newline marker from the rendered rows', () => {
    const rows = toSideBySide(
      hunkOf(`--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n`)
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].paired).toBe(true)
  })
})

describe('wordDiff', () => {
  it('marks only the middle that actually changed', () => {
    const { left, right } = wordDiff('const a = oldValue + 1', 'const a = newValue + 1')
    expect(left.filter((p) => p.changed).map((p) => p.text)).toEqual(['oldValue'])
    expect(right.filter((p) => p.changed).map((p) => p.text)).toEqual(['newValue'])
    // And reassembling the parts gives the original line back, exactly.
    expect(left.map((p) => p.text).join('')).toBe('const a = oldValue + 1')
    expect(right.map((p) => p.text).join('')).toBe('const a = newValue + 1')
  })

  it('marks nothing when the lines are identical', () => {
    const { left } = wordDiff('same', 'same')
    expect(left.every((p) => !p.changed)).toBe(true)
  })

  it('marks the whole line when nothing is shared', () => {
    const { left, right } = wordDiff('aaa', 'zzz')
    expect(left).toEqual([{ text: 'aaa', changed: true }])
    expect(right).toEqual([{ text: 'zzz', changed: true }])
  })

  it('does not drag punctuation into a changed identifier', () => {
    const { right } = wordDiff('foo(bar)', 'foo(baz)')
    expect(right.filter((p) => p.changed).map((p) => p.text)).toEqual(['baz'])
  })

  it('handles a pure insertion at the end', () => {
    const { left, right } = wordDiff('a b', 'a b c')
    expect(left.filter((p) => p.changed)).toEqual([])
    expect(right.filter((p) => p.changed).map((p) => p.text)).toEqual([' c'])
  })

  it('handles an empty side', () => {
    const { left, right } = wordDiff('', 'added')
    expect(left).toEqual([{ text: '', changed: false }])
    expect(right).toEqual([{ text: 'added', changed: true }])
  })

  it('preserves leading whitespace, which matters in a diff', () => {
    const { right } = wordDiff('  indented', '    indented')
    expect(right.map((p) => p.text).join('')).toBe('    indented')
  })
})

describe('hunkStats', () => {
  it('counts additions and removals, not context', () => {
    const [file] = parseDiff(TWO_HUNKS)
    expect(hunkStats(file.hunks[0])).toEqual({ added: 1, removed: 1 })
  })

  it('is zero-safe for an empty hunk', () => {
    const empty: FileDiff['hunks'][number] = {
      header: '@@ -0,0 +0,0 @@',
      oldStart: 0,
      oldCount: 0,
      newStart: 0,
      newCount: 0,
      lines: [],
    }
    expect(hunkStats(empty)).toEqual({ added: 0, removed: 0 })
  })
})
