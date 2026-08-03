import { UploadTooLargeError } from './fileBytes'
import { notify } from '../shared/store/notificationStore'

/**
 * One way for a document app to report an open or save failure.
 *
 * Docs, Sheets and Slides each caught their failures into local component state
 * plus `console.error` and nothing else (briefs 62-64 share this headline). An
 * inline banner is the right *in-view* signal, but it is not sufficient on its
 * own: the window that failed may not be the window the user is looking at, and
 * for a save that means closing a document believing it was written. Error-level
 * notifications are sticky in the notification centre by design, so a background
 * failure survives until it is acknowledged.
 *
 * These helpers return the banner text *and* raise the notification, so the two
 * cannot drift and neither can be forgotten — the same reasoning as brief 86's
 * `useRegisteredHotkeys`, where documenting and binding are one call.
 */

export type FileFailureOptions = {
  /** Raising app's id, so the notification carries its icon and opens it. */
  appId: string
  /** What the user calls the thing: `document`, `spreadsheet`, `presentation`. */
  noun: string
  /** Filename, when known. A background failure has to say which file. */
  name?: string
}

/** True when an error carries an axios-style HTTP status matching `status`. */
function statusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('response' in err)) return undefined
  return (err as { response?: { status?: number } }).response?.status
}

/**
 * A message the backend wrote for a human, if there is one.
 *
 * The files service translates `ENOSPC`/`EDQUOT` into a 503 whose message says
 * the volume is full (brief 83). Passing that through beats replacing it with a
 * generic failure, which is what discards the one useful sentence.
 */
function serverMessage(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('response' in err)) return undefined
  const data = (err as { response?: { data?: unknown } }).response?.data
  if (typeof data !== 'object' || data === null) return undefined
  const message = (data as { message?: unknown }).message
  if (typeof message === 'string' && message.trim() && message.length < 300) return message
  if (Array.isArray(message)) {
    const first = message.find((m) => typeof m === 'string')
    if (typeof first === 'string' && first.trim()) return first
  }
  return undefined
}

/**
 * Human sentence for a failed read or write, without notifying.
 *
 * Exported for tests and for callers that already have their own message; most
 * callers want {@link reportFileFailure}, which also raises the notification.
 */
export function describeFileFailure(action: 'open' | 'save', err: unknown, noun: string): string {
  if (err instanceof UploadTooLargeError) return err.message

  const status = statusOf(err)
  const fromServer = serverMessage(err)

  switch (status) {
    case 403:
      return `You do not have permission to ${action} this ${noun}.`
    case 404:
      return action === 'open'
        ? `This ${noun} no longer exists.`
        : `The folder this ${noun} lives in no longer exists.`
    case 413:
      return `This ${noun} is too large to save.`
    case 503:
      // Disk-full arrives here with a message worth reading verbatim.
      return fromServer ?? `The OS could not ${action} this ${noun} right now.`
  }

  if (fromServer) return fromServer
  if (status === undefined) {
    // No response at all: the backend is down, restarting, or unreachable.
    return `Could not reach the OS to ${action} this ${noun}.`
  }
  return `Could not ${action} this ${noun}.`
}

/**
 * Report a failed open or save: raise a sticky error notification and return
 * the text for the app's inline banner.
 *
 * Always use the return value — a caller that drops it has an app that notified
 * and then showed nothing in the window that failed.
 */
export function reportFileFailure(
  action: 'open' | 'save',
  err: unknown,
  opts: FileFailureOptions
): string {
  const message = describeFileFailure(action, err, opts.noun)
  console.error(`[${opts.appId}] failed to ${action}`, err)
  notify({
    level: 'error',
    appId: opts.appId,
    title: action === 'save' ? 'Save failed' : 'Could not open',
    body: opts.name ? `${opts.name} — ${message}` : message,
  })
  return message
}

/**
 * Report a refusal that is not an error: an unsupported format, a file the app
 * will not load. Warning level, because nothing broke and nothing was lost.
 */
export function reportFileRefusal(message: string, opts: Omit<FileFailureOptions, 'noun'>): string {
  notify({
    level: 'warning',
    appId: opts.appId,
    title: 'Cannot open this file',
    body: opts.name ? `${opts.name} — ${message}` : message,
  })
  return message
}
