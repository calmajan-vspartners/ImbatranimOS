import { describeFileFailure, type FileFailureOptions } from '@imbatranim/ui'
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

// The pure half (describeFileFailure + FileFailureOptions) moved to
// @imbatranim/ui (brief 48). The notifying half below stays with the OS until
// every app takes it from the SDK, because it needs `notify`.
export { describeFileFailure } from '@imbatranim/ui'
export type { FileFailureOptions } from '@imbatranim/ui'

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
