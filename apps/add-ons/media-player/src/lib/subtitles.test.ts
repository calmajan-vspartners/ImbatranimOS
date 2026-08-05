import { describe, expect, it } from 'vitest'
import {
  findSubtitle,
  parseSubtitles,
  parseTimestamp,
  stripExtension,
  stripSsaOverrides,
} from './subtitles'

describe('findSubtitle', () => {
  const paths = ['clip.webm', 'clip.srt', 'clip.vtt', 'other.vtt', 'clip.en.srt']

  it('prefers .vtt over .srt for the same basename', () => {
    // Both exist: the one that needs no conversion round-trips exactly.
    expect(findSubtitle(paths, 'clip.webm')).toBe('clip.vtt')
  })

  it('falls back to .srt', () => {
    expect(findSubtitle(['clip.webm', 'clip.srt'], 'clip.webm')).toBe('clip.srt')
  })

  it('does not claim a language-tagged sibling', () => {
    // `clip.en.srt` is a different file; picking it by accident would show the wrong
    // language with no way to tell.
    expect(findSubtitle(['clip.webm', 'clip.en.srt'], 'clip.webm')).toBeNull()
  })

  it('is null when nothing matches', () => {
    expect(findSubtitle(['clip.webm', 'other.vtt'], 'clip.webm')).toBeNull()
  })

  it('matches inside a subdirectory', () => {
    expect(findSubtitle(['films/clip.mp4', 'films/clip.vtt'], 'films/clip.mp4')).toBe(
      'films/clip.vtt'
    )
  })

  it('accepts an upper-case extension', () => {
    expect(findSubtitle(['clip.mp4', 'clip.SRT'], 'clip.mp4')).toBe('clip.SRT')
  })
})

describe('parseTimestamp', () => {
  it('reads both the comma and the dot form', () => {
    expect(parseTimestamp('00:00:01,500')).toBeCloseTo(1.5)
    expect(parseTimestamp('00:00:01.500')).toBeCloseTo(1.5)
  })

  it('reads the hour-less WebVTT form', () => {
    expect(parseTimestamp('02:03.250')).toBeCloseTo(123.25)
  })

  it('reads hours', () => {
    expect(parseTimestamp('01:02:03')).toBe(3723)
  })

  it('pads short millisecond fields rather than misreading them', () => {
    expect(parseTimestamp('00:00:00,5')).toBeCloseTo(0.5)
  })

  it('is null for anything that is not a timestamp', () => {
    expect(parseTimestamp('not a time')).toBeNull()
    expect(parseTimestamp('')).toBeNull()
  })
})

describe('parseSubtitles', () => {
  const SRT = [
    '1',
    '00:00:01,000 --> 00:00:03,000',
    'First line',
    '',
    '2',
    '00:00:04,500 --> 00:00:06,000',
    'Second line',
    'wrapped',
    '',
  ].join('\n')

  const VTT = [
    'WEBVTT',
    '',
    'NOTE this is a comment',
    '',
    'intro',
    '00:00:01.000 --> 00:00:03.000 line:90%',
    'First line',
    '',
    '00:00:04.500 --> 00:00:06.000',
    'Second line',
    '',
  ].join('\n')

  it('parses SubRip', () => {
    expect(parseSubtitles(SRT)).toEqual([
      { start: 1, end: 3, text: 'First line' },
      { start: 4.5, end: 6, text: 'Second line\nwrapped' },
    ])
  })

  it('parses WebVTT, ignoring the header, NOTE blocks, cue ids and cue settings', () => {
    expect(parseSubtitles(VTT)).toEqual([
      { start: 1, end: 3, text: 'First line' },
      { start: 4.5, end: 6, text: 'Second line' },
    ])
  })

  it('handles CRLF line endings', () => {
    expect(parseSubtitles(SRT.replace(/\n/g, '\r\n')).length).toBe(2)
  })

  it('handles a file with no blank line between cues', () => {
    const packed = '00:00:01,000 --> 00:00:02,000\none\n00:00:02,000 --> 00:00:03,000\ntwo'
    expect(parseSubtitles(packed).map((c) => c.text)).toEqual(['one', 'two'])
  })

  it('skips a malformed cue instead of throwing away the file', () => {
    // One bad timestamp three hours in must not cost the other 900 lines.
    const mixed = [
      '00:00:01,000 --> 00:00:02,000',
      'good',
      '',
      'BROKEN --> ALSO BROKEN',
      'bad',
      '',
      '00:00:05,000 --> 00:00:06,000',
      'good again',
    ].join('\n')
    expect(parseSubtitles(mixed).map((c) => c.text)).toEqual(['good', 'good again'])
  })

  it('skips a cue whose end is not after its start', () => {
    expect(parseSubtitles('00:00:05,000 --> 00:00:05,000\nzero length')).toEqual([])
  })

  it('skips a cue with no text', () => {
    expect(parseSubtitles('00:00:01,000 --> 00:00:02,000\n\n')).toEqual([])
  })

  it('is empty for an empty or non-subtitle file', () => {
    expect(parseSubtitles('')).toEqual([])
    expect(parseSubtitles('just some prose\nwith no timings')).toEqual([])
  })
})

describe('stripSsaOverrides', () => {
  it('drops SSA positioning braces', () => {
    expect(stripSsaOverrides('{\\an8}Top line')).toBe('Top line')
  })

  it('keeps WebVTT markup, which VTTCue renders properly', () => {
    expect(stripSsaOverrides('<i>Hello</i>')).toBe('<i>Hello</i>')
  })
})

describe('stripExtension', () => {
  it('leaves a dotted directory alone', () => {
    expect(stripExtension('my.films/clip')).toBe('my.films/clip')
    expect(stripExtension('my.films/clip.mp4')).toBe('my.films/clip')
  })
})
