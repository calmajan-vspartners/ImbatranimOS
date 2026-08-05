/**
 * Sidecar subtitle discovery and parsing — one parser for both WebVTT and SubRip.
 *
 * ## Why the cues are parsed here rather than handed to a `<track>` element
 *
 * The obvious implementation is `<track src={downloadUrl(...)}>`, and it cannot work in
 * this OS for two independent reasons:
 *
 * 1. `GET /files/download` serves `application/octet-stream`, and a text track is only
 *    parsed when it arrives as `text/vtt`.
 * 2. Converting to a `Blob` and using a `blob:` URL — the usual way around (1) — is
 *    refused by the shipped CSP: there is no `media-src` directive, so `<track>` falls
 *    back to `default-src 'self'`, which does not include `blob:`. Measured in a browser
 *    against the production build, not inferred.
 *
 * So the file is fetched through the authed api as text, parsed here, and pushed into a
 * `TextTrack` created with `addTextTrack` + `VTTCue`. No new route, no dependency, and no
 * CSP relaxation — which matters, because widening the policy is a human-gated decision
 * in this project.
 *
 * SubRip and WebVTT differ in exactly three things that matter: the `WEBVTT` header, a
 * comma instead of a dot before the milliseconds, and the numeric counter before each
 * cue. Handling all three in one parser is less code than two parsers and means an `.srt`
 * with dots (they exist) still works.
 */

export type Cue = { start: number; end: number; text: string }

/** Extensions searched for beside a video, best first. */
export const SUBTITLE_EXTENSIONS = ['vtt', 'srt'] as const

/** `path` without its extension, or the whole path when it has none. */
export function stripExtension(path: string): string {
  const at = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  return at > slash ? path.slice(0, at) : path
}

/**
 * The sidecar subtitle for `videoPath` among `paths`, or null.
 *
 * `.vtt` wins over `.srt` for the same basename: it needs no conversion, so when someone
 * has both, the one that round-trips exactly is the better choice. Matching is
 * case-insensitive on the extension only — the basename must match exactly, because
 * `Episode.1.en.srt` beside `Episode.1.mkv` is a different (language-tagged) file and
 * guessing at those belongs to a feature this brief does not have.
 */
export function findSubtitle(paths: string[], videoPath: string): string | null {
  const base = stripExtension(videoPath)
  for (const ext of SUBTITLE_EXTENSIONS) {
    const match = paths.find(
      (p) => stripExtension(p) === base && p.toLowerCase().endsWith(`.${ext}`)
    )
    if (match) return match
  }
  return null
}

/** `hh:mm:ss,mmm` / `mm:ss.mmm` → seconds, or null when it is not a timestamp. */
export function parseTimestamp(raw: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(raw.trim())
  if (!match) return null
  const [, h, m, s, ms] = match
  const millis = ms ? Number(ms.padEnd(3, '0')) : 0
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + millis / 1000
}

const TIMING = /^(.+?)\s*-->\s*([^\s]+)(?:\s+(.*))?$/

/**
 * Cues from a WebVTT or SubRip file, in file order.
 *
 * Malformed cues are skipped rather than throwing: a subtitle file with one bad timestamp
 * three hours in should still show the other 900 lines. Anything that is not a cue —
 * the `WEBVTT` header, `NOTE` blocks, `STYLE` blocks, cue numbers, cue identifiers — is
 * ignored by construction, because only lines containing `-->` start a cue.
 */
export function parseSubtitles(source: string): Cue[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const cues: Cue[] = []
  for (let i = 0; i < lines.length; i++) {
    const timing = TIMING.exec(lines[i])
    if (!timing) continue
    const start = parseTimestamp(timing[1])
    const end = parseTimestamp(timing[2])
    if (start === null || end === null || end <= start) continue
    const text: string[] = []
    // Cue text runs to the next blank line — or to the next timing line, for files that
    // omit the blank separator.
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') break
      if (TIMING.test(lines[j])) break
      text.push(lines[j])
      i = j
    }
    if (text.length === 0) continue
    cues.push({ start, end, text: text.join('\n') })
  }
  return cues
}

/**
 * Remove SubStation-Alpha positioning overrides (`{\an8}`) from a cue.
 *
 * WebVTT tags (`<i>`, `<b>`, `<c.yellow>`) are deliberately left alone: `VTTCue` renders
 * them as markup, so stripping them would throw away the italics a subtitle author meant.
 * SSA braces are the opposite case — nothing renders them, so they show up as literal
 * `{\an8}` in front of the line.
 */
export function stripSsaOverrides(text: string): string {
  return text.replace(/\{\\[^}]*\}/g, '').trim()
}
