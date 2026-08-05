import { beforeAll, describe, expect, it } from 'vitest'
import { codecHint, describeMediaError, mediaErrorReport } from './mediaError'

// `MediaError` is a DOM interface, absent in the node test environment. These tests only
// need its four codes and an object carrying one, so the constants are declared here
// rather than pulling in jsdom for them.
const CODES = { ABORTED: 1, NETWORK: 2, DECODE: 3, SRC_NOT_SUPPORTED: 4 }
const err = (code: number) => ({ code, message: '' }) as MediaError

beforeAll(() => {
  ;(globalThis as { MediaError?: unknown }).MediaError = {
    MEDIA_ERR_ABORTED: CODES.ABORTED,
    MEDIA_ERR_NETWORK: CODES.NETWORK,
    MEDIA_ERR_DECODE: CODES.DECODE,
    MEDIA_ERR_SRC_NOT_SUPPORTED: CODES.SRC_NOT_SUPPORTED,
  }
})

describe('describeMediaError', () => {
  it('names each failure in plain words', () => {
    expect(describeMediaError(err(CODES.DECODE))).toMatch(/can’t decode/)
    expect(describeMediaError(err(CODES.SRC_NOT_SUPPORTED))).toMatch(/can’t play this file format/)
    expect(describeMediaError(err(CODES.NETWORK))).toMatch(/network/)
    expect(describeMediaError(err(CODES.ABORTED))).toMatch(/aborted/)
  })

  it('never returns an empty string, even with no error object or an unknown code', () => {
    // The element fires `error` with a null `error` in some paths; a blank overlay would
    // be indistinguishable from a broken app, which is the whole problem this fixes.
    expect(describeMediaError(null).length).toBeGreaterThan(0)
    expect(describeMediaError(err(99)).length).toBeGreaterThan(0)
  })
})

describe('codecHint', () => {
  it('explains the container for formats that can hold undecodable codecs', () => {
    expect(codecHint('films/a.mkv')).toMatch(/Matroska/)
    expect(codecHint('films/a.mp4')).toMatch(/HEVC/)
  })

  it('is empty when there is nothing honest to add', () => {
    expect(codecHint('a.webm')).toBe('')
    expect(codecHint('a.mp3')).toBe('')
    expect(codecHint('noextension')).toBe('')
  })
})

describe('mediaErrorReport', () => {
  it('names the file, because the queue auto-advances', () => {
    const report = mediaErrorReport(err(CODES.SRC_NOT_SUPPORTED), 'films/ep1.mkv', 'ep1.mkv')
    expect(report.message.startsWith('ep1.mkv — ')).toBe(true)
    expect(report.hint).toMatch(/Matroska/)
  })

  it('drops the codec hint for a network failure', () => {
    // The hint would be a red herring exactly when the user needs to know it is not the
    // file's fault.
    expect(mediaErrorReport(err(CODES.NETWORK), 'films/ep1.mkv', 'ep1.mkv').hint).toBe('')
  })

  it('still names the file when there is no error object', () => {
    expect(mediaErrorReport(null, 'a.mp3', 'a.mp3').message.startsWith('a.mp3 — ')).toBe(true)
  })
})
