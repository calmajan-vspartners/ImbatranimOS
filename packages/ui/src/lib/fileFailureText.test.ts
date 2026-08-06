import { describe, expect, it } from 'vitest'
import { describeFileFailure } from './fileFailureText'
import { UploadTooLargeError } from './files'
import { reportFileFailure, reportFileRefusal } from '../hooks/systemHooks'
import type { SystemNotifyInput } from '../system'

/** An axios-shaped rejection: what the http capability actually throws. */
const http = (status: number, message?: string | string[]) => ({
  response: { status, data: message === undefined ? {} : { message } },
})

/** A capturing stand-in for the handle's notify — the SDK never sees a store. */
function fakeSystem() {
  const seen: SystemNotifyInput[] = []
  return {
    seen,
    notify: (input: SystemNotifyInput) => {
      seen.push(input)
      return 'id'
    },
  }
}

describe('describeFileFailure', () => {
  it('uses the upload-cap error verbatim — it is already a human sentence', () => {
    const err = new UploadTooLargeError('File exceeds the maximum upload size.')
    expect(describeFileFailure('save', err, 'document')).toBe(
      'File exceeds the maximum upload size.'
    )
  })

  it('passes the disk-full message through instead of replacing it', () => {
    // The files service translates ENOSPC/EDQUOT into a 503 whose message says
    // the volume is full (brief 83). Overwriting that with "could not save"
    // throws away the one sentence that tells the user what to do.
    const err = http(503, 'The disk is full. Free some space and try again.')
    expect(describeFileFailure('save', err, 'spreadsheet')).toBe(
      'The disk is full. Free some space and try again.'
    )
  })

  it('falls back to a generic 503 line when the server sent no message', () => {
    expect(describeFileFailure('save', http(503), 'document')).toBe(
      'The OS could not save this document right now.'
    )
  })

  it('names permission and missing-file cases', () => {
    expect(describeFileFailure('save', http(403), 'document')).toContain('permission')
    expect(describeFileFailure('open', http(404), 'document')).toBe(
      'This document no longer exists.'
    )
    expect(describeFileFailure('save', http(404), 'document')).toContain('folder')
  })

  it('says the OS is unreachable when there was no response at all', () => {
    expect(describeFileFailure('open', new Error('network'), 'document')).toBe(
      'Could not reach the OS to open this document.'
    )
  })

  it('prefers a first server sentence from a message array', () => {
    expect(describeFileFailure('save', http(400, ['path escapes the jail']), 'file')).toBe(
      'path escapes the jail'
    )
  })
})

describe('reportFileFailure', () => {
  it('raises a sticky error through the HANDLE and returns the banner text', () => {
    const system = fakeSystem()
    const message = reportFileFailure(system, 'save', http(503), {
      noun: 'document',
      name: 'report.docx',
    })
    expect(message).toBe('The OS could not save this document right now.')
    expect(system.seen).toHaveLength(1)
    expect(system.seen[0].level).toBe('error')
    expect(system.seen[0].title).toBe('Save failed')
    expect(system.seen[0].body).toContain('report.docx')
    // No appId anywhere: the handle stamps it, the SDK cannot forge it.
    expect('appId' in system.seen[0]).toBe(false)
  })
})

describe('reportFileRefusal', () => {
  it('warns rather than errors — nothing broke, nothing was lost', () => {
    const system = fakeSystem()
    reportFileRefusal(system, 'This is not a PDF.', { name: 'x.bin' })
    expect(system.seen[0].level).toBe('warning')
    expect(system.seen[0].body).toBe('x.bin — This is not a PDF.')
  })
})
