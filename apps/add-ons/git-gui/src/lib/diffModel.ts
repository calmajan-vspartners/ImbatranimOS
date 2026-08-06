/**
 * Unified-diff parsing, hunk patches, side-by-side pairing, and word-level diff.
 *
 * Pure and tested, because two things here are quietly load-bearing:
 *
 * 1. **The patch this builds is executed by git.** `patchForHunk` output goes to
 *    `git apply --cached` on the backend. It cannot be "roughly right": a patch
 *    whose header is wrong applies to the wrong file, and one whose hunk counts are
 *    wrong is rejected outright with a message the user cannot act on.
 * 2. **Side-by-side pairing is where a diff viewer lies.** Pair rows badly and the
 *    user reads a deletion against an unrelated addition and believes a change they
 *    are not looking at.
 */

export type DiffLineKind = 'context' | 'add' | 'del' | 'meta'

export type DiffLine = {
  kind: DiffLineKind
  /** The line WITHOUT its leading +/-/space marker. */
  text: string
  /** Line number on the old side, or null for an addition. */
  oldNo: number | null
  /** Line number on the new side, or null for a deletion. */
  newNo: number | null
}

export type Hunk = {
  /** The literal `@@ -a,b +c,d @@ ...` line, reused verbatim in a patch. */
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

export type FileDiff = {
  /** Path shown in the UI — the new name, falling back to the old for a delete. */
  path: string
  oldPath: string
  newPath: string
  /**
   * Every line before the first `@@`, kept **verbatim**. A patch must carry these
   * back unchanged: `git apply` reads the `diff --git` / `---` / `+++` lines to
   * decide which file it is touching, and `new file mode` / `deleted file mode` /
   * `index` lines change what the apply means.
   */
  header: string[]
  hunks: Hunk[]
  /** True for a binary file, where there is nothing to show or stage per hunk. */
  binary: boolean
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Strip git's `a/` / `b/` prefix, and understand `/dev/null`. */
function cleanPath(raw: string): string {
  const p = raw.trim().replace(/\t.*$/, '')
  if (p === '/dev/null') return ''
  return p.replace(/^[ab]\//, '')
}

/**
 * Extract the `a/` and `b/` sides from a `diff --git` line.
 *
 * `\S+ \S+` breaks the instant a path contains a space: git writes
 * `diff --git a/my file b/my file` (unquoted, space and all) or
 * `diff --git "a/my file" "b/my file"` (C-quoted, when the path has characters
 * that force quoting). A binary file with a space in its name has no `---`/`+++`
 * body to recover the name from, so a miss here drops the file from the diff.
 */
function parseDiffGitLine(line: string): { a: string; b: string } | null {
  const rest = line.slice('diff --git '.length)
  // Quoted form: git C-quotes either side when the path needs it. Strip the
  // enclosing quotes — enough to keep the file visible and named.
  if (rest.startsWith('"')) {
    const close = rest.indexOf('" ', 1)
    if (close !== -1) {
      const a = rest.slice(1, close)
      let b = rest.slice(close + 2)
      if (b.startsWith('"') && b.endsWith('"')) b = b.slice(1, -1)
      return { a, b }
    }
  }
  // Fast path: neither side has a space.
  const simple = /^(\S+) (\S+)$/.exec(rest)
  if (simple) return { a: simple[1], b: simple[2] }
  // Spaces present, no rename: `a/<p> b/<p>` with identical <p>. The two sides
  // are equal length, so the ` b/` separator sits exactly at the midpoint — the
  // one boundary where an equal-length a-side ends and the b-side begins.
  if (rest.startsWith('a/')) {
    const p = rest.slice(2)
    // p = <path> + " b/" + <path>, so length is 2·len + 3 (always odd).
    if (p.length % 2 === 1) {
      const len = (p.length - 3) / 2
      if (p[len] === ' ' && p.slice(len + 1, len + 3) === 'b/') {
        const aPath = p.slice(0, len)
        const bPath = p.slice(len + 3)
        if (aPath === bPath) return { a: `a/${aPath}`, b: `b/${bPath}` }
      }
    }
  }
  return null
}

/**
 * Parse `git diff` output into files and hunks.
 *
 * Tolerant on purpose: a diff arrives from a real repository and may contain
 * binary markers, mode-only changes, renames, and a "\ No newline at end of file"
 * marker. Anything unrecognised is kept in the file header rather than dropped, so
 * a patch rebuilt from it still says what git said.
 */
export function parseDiff(text: string): FileDiff[] {
  if (!text.trim()) return []
  const files: FileDiff[] = []
  let file: FileDiff | null = null
  let hunk: Hunk | null = null
  let oldNo = 0
  let newNo = 0

  const pushHunk = () => {
    if (file && hunk) file.hunks.push(hunk)
    hunk = null
  }
  const pushFile = () => {
    pushHunk()
    if (file) files.push(file)
    file = null
  }

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      pushFile()
      file = { path: '', oldPath: '', newPath: '', header: [line], binary: false, hunks: [] }
      // Take the paths from this line too, not only from `---`/`+++`: a binary
      // file's diff has no `---` header at all, and without this it would end up
      // nameless and be dropped as an empty parse.
      const pair = parseDiffGitLine(line)
      if (pair) {
        file.oldPath = cleanPath(pair.a)
        file.newPath = cleanPath(pair.b)
      }
      continue
    }
    if (!file) {
      // A diff for a single file can arrive without the `diff --git` line.
      if (line.startsWith('--- ')) {
        file = { path: '', oldPath: '', newPath: '', header: [line], binary: false, hunks: [] }
        file.oldPath = cleanPath(line.slice(4))
        continue
      }
      continue
    }

    const match = HUNK_RE.exec(line)
    if (match) {
      pushHunk()
      const oldStart = Number(match[1])
      const oldCount = match[2] === undefined ? 1 : Number(match[2])
      const newStart = Number(match[3])
      const newCount = match[4] === undefined ? 1 : Number(match[4])
      hunk = { header: line, oldStart, oldCount, newStart, newCount, lines: [] }
      oldNo = oldStart
      newNo = newStart
      continue
    }

    if (!hunk) {
      file.header.push(line)
      if (line.startsWith('--- ')) file.oldPath = cleanPath(line.slice(4))
      else if (line.startsWith('+++ ')) file.newPath = cleanPath(line.slice(4))
      else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
        file.binary = true
      }
      continue
    }

    if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ })
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null })
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" belongs to the hunk and must survive into a
      // patch, or applying it silently adds a newline the user never typed.
      hunk.lines.push({ kind: 'meta', text: line, oldNo: null, newNo: null })
    } else if (line === '') {
      // NOT a context line. Git writes an empty context line as a single space, so
      // a bare '' is the trailing element `split('\n')` leaves on any text ending
      // in a newline. Counting it as context added a phantom line to every hunk —
      // which then went into the rebuilt patch and made its `@@` counts wrong.
      continue
    } else if (line.startsWith(' ')) {
      hunk.lines.push({
        kind: 'context',
        text: line.slice(1),
        oldNo: oldNo++,
        newNo: newNo++,
      })
    } else {
      // Something after the hunks that is not part of one (e.g. a trailing
      // `diff --git` handled above, or git noise) — close the hunk and keep it.
      pushHunk()
      file.header.push(line)
    }
  }
  pushFile()

  for (const f of files) {
    f.path = f.newPath || f.oldPath
  }
  // A trailing empty split element can create a file with nothing in it.
  return files.filter((f) => f.path !== '' || f.hunks.length > 0)
}

/** The line the diff body actually contains, marker restored. */
function rawLine(line: DiffLine): string {
  if (line.kind === 'meta') return line.text
  const marker = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
  return `${marker}${line.text}`
}

/**
 * Build a patch containing exactly one hunk, ready for `git apply --cached`.
 *
 * The **counts are recomputed** rather than copied from the original header. They
 * are already correct for staging a hunk as-is, but recomputing means this same
 * function stays correct if a future brief adds per-*line* selection, and it makes
 * a malformed input fail here rather than inside git.
 *
 * The file header is copied verbatim (see {@link FileDiff.header}) and the patch
 * ends with a newline, which `git apply` requires.
 */
export function patchForHunk(file: FileDiff, hunk: Hunk): string {
  const oldCount = hunk.lines.filter((l) => l.kind === 'del' || l.kind === 'context').length
  const newCount = hunk.lines.filter((l) => l.kind === 'add' || l.kind === 'context').length
  const header = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`
  return [...file.header, header, ...hunk.lines.map(rawLine), ''].join('\n')
}

// ---------------------------------------------------------------------------
// Side-by-side
// ---------------------------------------------------------------------------

export type SideRow = {
  left: DiffLine | null
  right: DiffLine | null
  /** True when this row is a del/add pair worth word-diffing. */
  paired: boolean
}

/**
 * Lay a hunk out in two columns.
 *
 * The rule that matters: a run of deletions immediately followed by a run of
 * additions is paired **positionally** (first with first, second with second), and
 * any leftover on either side gets a blank opposite. Pairing across a context line
 * is deliberately not done — two changes separated by unchanged code are two
 * changes, and showing them side by side would invent a relationship.
 */
export function toSideBySide(hunk: Hunk): SideRow[] {
  const rows: SideRow[] = []
  const lines = hunk.lines.filter((l) => l.kind !== 'meta')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.kind === 'context') {
      rows.push({ left: line, right: line, paired: false })
      i += 1
      continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++])
    while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++])
    const n = Math.max(dels.length, adds.length)
    for (let k = 0; k < n; k++) {
      const left = dels[k] ?? null
      const right = adds[k] ?? null
      rows.push({ left, right, paired: left !== null && right !== null })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// Word-level highlight
// ---------------------------------------------------------------------------

export type WordPart = { text: string; changed: boolean }

/**
 * Split a line into words, keeping the separators.
 *
 * Whitespace and punctuation are their own tokens so `foo(bar)` → `foo`, `(`,
 * `bar`, `)` — highlighting a changed identifier without dragging its brackets in.
 */
function tokenize(line: string): string[] {
  return line.match(/(\s+|\w+|[^\s\w]+)/g) ?? []
}

/**
 * Word-level difference between two versions of one line.
 *
 * A common-prefix/common-suffix trim rather than a full LCS: for the case this
 * serves — one line edited into another — it produces the same answer as an LCS
 * almost always, in linear time and about fifteen lines. The failure mode is
 * benign: a line that was rewritten wholesale is highlighted wholesale, which is
 * the honest rendering anyway.
 */
export function wordDiff(before: string, after: string): { left: WordPart[]; right: WordPart[] } {
  if (before === after) {
    return { left: [{ text: before, changed: false }], right: [{ text: after, changed: false }] }
  }
  const a = tokenize(before)
  const b = tokenize(after)

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++

  let end = 0
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++
  }

  const build = (tokens: string[]): WordPart[] => {
    const head = tokens.slice(0, start).join('')
    const middle = tokens.slice(start, tokens.length - end).join('')
    const tail = end === 0 ? '' : tokens.slice(tokens.length - end).join('')
    const parts: WordPart[] = []
    if (head) parts.push({ text: head, changed: false })
    if (middle) parts.push({ text: middle, changed: true })
    if (tail) parts.push({ text: tail, changed: false })
    return parts.length > 0 ? parts : [{ text: '', changed: false }]
  }

  return { left: build(a), right: build(b) }
}

/** `+3 −1`, for a hunk's own header row. */
export function hunkStats(hunk: Hunk): { added: number; removed: number } {
  return {
    added: hunk.lines.filter((l) => l.kind === 'add').length,
    removed: hunk.lines.filter((l) => l.kind === 'del').length,
  }
}
