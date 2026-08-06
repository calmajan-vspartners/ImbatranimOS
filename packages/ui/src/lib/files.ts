/**
 * Pure file helpers — the parts of the file kit that never touch the OS.
 *
 * The capability half (read/upload/download over the authed backend) lives on
 * `system.fs`; these are string- and error-shaped and ship with the app bundle.
 */

/** Last path segment (the file's own name), or `fallback` when the path is empty. */
export function fileName(path: string, fallback = 'file'): string {
  return path.split('/').pop() || fallback
}

/**
 * Raised when the backend refuses an over-cap upload (413).
 *
 * Part of the protocol: `system.fs.upload` throws it, so it lives here — an app
 * catching it must be able to `instanceof` against the same class the handle
 * implementation throws, whatever transport backs the handle.
 */
export class UploadTooLargeError extends Error {
  constructor(message = 'File exceeds the maximum upload size.') {
    super(message)
    this.name = 'UploadTooLargeError'
  }
}
