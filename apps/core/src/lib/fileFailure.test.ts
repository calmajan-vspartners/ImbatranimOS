import { beforeEach, describe, expect, it } from 'vitest'
import { describeFileFailure, reportFileFailure, reportFileRefusal } from './fileFailure'
import { UploadTooLargeError } from './fileBytes'
import { useNotificationStore } from '../shared/store/notificationStore'

/** An axios-shaped rejection: what the api client actually throws. */
const http = (status: number, message?: string | string[]) => ({
  response: { status, data: message === undefined ? {} : { message } },
})

beforeEach(() => {
  useNotificationStore.setState({ notifications: [], toasts: [], dnd: false })
})

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
    // A save 404 is a missing *folder*, not a missing document — the document is
    // in front of the user.
    expect(describeFileFailure('save', http(404), 'document')).toContain('folder')
  })

  it('distinguishes "the backend did not answer" from "the backend said no"', () => {
    // No `response` at all: down, restarting, or unreachable. Telling the user
    // the save failed without that distinction sends them looking at the file.
    expect(describeFileFailure('save', new Error('Network Error'), 'document')).toBe(
      'Could not reach the OS to save this document.'
    )
    expect(describeFileFailure('save', http(500), 'document')).toBe('Could not save this document.')
  })

  it('reads the first entry of a validation-array message', () => {
    expect(describeFileFailure('save', http(400, ['path must be a string']), 'document')).toBe(
      'path must be a string'
    )
  })

  it('ignores a server message too long to be a sentence', () => {
    // An HTML error page or a stack trace is not a user-facing message.
    expect(describeFileFailure('save', http(500, 'x'.repeat(400)), 'document')).toBe(
      'Could not save this document.'
    )
  })

  it('uses the noun it was given, so each app sounds like itself', () => {
    expect(describeFileFailure('open', http(403), 'presentation')).toContain('presentation')
  })
})

describe('reportFileFailure', () => {
  it('raises a sticky error notification and returns the banner text', () => {
    const message = reportFileFailure('save', http(403), {
      appId: 'docs',
      noun: 'document',
      name: 'Q3.docx',
    })
    const { notifications } = useNotificationStore.getState()
    expect(notifications).toHaveLength(1)
    expect(notifications[0].level).toBe('error')
    expect(notifications[0].appId).toBe('docs')
    expect(notifications[0].title).toBe('Save failed')
    // The filename has to be in the notification: the window that failed may not
    // be the window the user is looking at.
    expect(notifications[0].body).toContain('Q3.docx')
    expect(notifications[0].body).toContain(message)
    expect(message).toContain('permission')
  })

  it('titles an open failure differently from a save failure', () => {
    reportFileFailure('open', http(404), { appId: 'sheets', noun: 'spreadsheet' })
    expect(useNotificationStore.getState().notifications[0].title).toBe('Could not open')
  })

  it('still notifies when no filename is known', () => {
    const message = reportFileFailure('open', http(500), { appId: 'docs', noun: 'document' })
    expect(useNotificationStore.getState().notifications[0].body).toBe(message)
  })
})

describe('reportFileRefusal', () => {
  it('is a warning, not an error — nothing broke and nothing was lost', () => {
    const message = reportFileRefusal('Docs reads .docx files.', {
      appId: 'docs',
      name: 'old.odt',
    })
    const [item] = useNotificationStore.getState().notifications
    expect(item.level).toBe('warning')
    expect(item.title).toBe('Cannot open this file')
    expect(item.body).toBe('old.odt — Docs reads .docx files.')
    expect(message).toBe('Docs reads .docx files.')
  })
})
