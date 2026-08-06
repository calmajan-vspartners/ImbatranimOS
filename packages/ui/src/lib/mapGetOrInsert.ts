/**
 * `Map.prototype.getOrInsert` / `getOrInsertComputed`, for browsers that do not
 * have them yet.
 *
 * ## Why this exists
 *
 * pdf.js 6.1 calls `getOrInsertComputed` on hot paths — including
 * `getOptionalContentConfig`, which `PDFPageProxy.render()` runs for **every
 * page**. The methods are a TC39 proposal that shipped in Chrome 142; on Chrome
 * 141 (October 2025, current at the time of writing) they are absent, so
 * `render()` threw `this[#t].getOrInsertComputed is not a function` and **every
 * PDF page came out blank**. A 595×841 canvas with zero non-white pixels, no
 * error surfaced to the user, in the shipped production build.
 *
 * That affects all three PDF surfaces (`pdf-viewer`, `norpdf`,
 * `packages/pdfcore-engine`) because they share the library. Requiring the
 * newest Chrome is not an option for an OS that ships its own kiosk browser and
 * is meant to be reachable from any machine.
 *
 * ## Why a polyfill rather than pinning pdf.js back
 *
 * The semantics are small and specified, so a polyfill is a faithful
 * implementation rather than a guess; downgrading the library would trade a
 * ten-line shim for losing every fix since. Installed additively — if the engine
 * already has the methods, this does nothing, so it disappears on its own as
 * browsers catch up.
 *
 * ## Known remaining gap
 *
 * pdf.js also calls these inside its **worker** (chunked range requests and
 * AcroForm field parsing). The worker is loaded from a vendored URL, so this
 * module cannot reach it without wrapping it in a shim worker; those paths are
 * conditional rather than per-render, and none of them are the blank-page bug.
 * If a PDF with form fields or a byte-range fetch ever reports the same
 * TypeError, the fix is a shim module that imports this file and then the real
 * worker, pointed at by `GlobalWorkerOptions.workerPort`.
 */

type MapWithGetOrInsert<K, V> = Map<K, V> & {
  getOrInsert(key: K, value: V): V
  getOrInsertComputed(key: K, callback: (key: K) => V): V
}

/**
 * Install the methods if they are missing. Idempotent and safe to call from
 * every entry point that is about to load pdf.js.
 */
export function installMapGetOrInsert(): void {
  const proto = Map.prototype as unknown as Partial<MapWithGetOrInsert<unknown, unknown>>

  if (typeof proto.getOrInsert !== 'function') {
    Object.defineProperty(Map.prototype, 'getOrInsert', {
      value: function getOrInsert<K, V>(this: Map<K, V>, key: K, value: V): V {
        // `has` then `get`, not `get() ?? insert`: a stored `undefined` is a
        // present entry and must not be overwritten.
        if (this.has(key)) return this.get(key) as V
        this.set(key, value)
        return value
      },
      writable: true,
      configurable: true,
      enumerable: false,
    })
  }

  if (typeof proto.getOrInsertComputed !== 'function') {
    Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
      value: function getOrInsertComputed<K, V>(
        this: Map<K, V>,
        key: K,
        callback: (key: K) => V
      ): V {
        if (typeof callback !== 'function') {
          throw new TypeError('getOrInsertComputed: callback must be a function')
        }
        if (this.has(key)) return this.get(key) as V
        const value = callback(key)
        // Re-check: the callback can mutate this map (pdf.js's own callbacks
        // push into structures that may touch it). The spec sets unconditionally
        // after computing, and so does this — last write wins, matching it.
        this.set(key, value)
        return value
      },
      writable: true,
      configurable: true,
      enumerable: false,
    })
  }
}
