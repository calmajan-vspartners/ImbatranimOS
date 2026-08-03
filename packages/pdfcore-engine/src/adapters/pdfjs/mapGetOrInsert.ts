/**
 * `Map.prototype.getOrInsert` / `getOrInsertComputed` for engines without them.
 *
 * pdf.js 6.1 calls `getOrInsertComputed` in `getOptionalContentConfig`, which
 * `PDFPageProxy.render()` runs for every page. The methods are a TC39 proposal
 * that shipped in Chrome 142; on Chrome 141 and earlier they are absent, so
 * `render()` throws `getOrInsertComputed is not a function` and every page comes
 * out blank — verified in a production build with a 595x841 canvas containing
 * zero non-white pixels.
 *
 * Deliberately duplicated rather than imported from the OS's `core`: this
 * package is standalone by design (its consumers are the ImbatranimOS add-on
 * AND a separate web demo), and a render path that only works inside one host
 * is not a rendering engine. Additive and idempotent, so it evaporates as
 * engines catch up.
 */

type MapWithGetOrInsert<K, V> = Map<K, V> & {
  getOrInsert(key: K, value: V): V;
  getOrInsertComputed(key: K, callback: (key: K) => V): V;
};

export function installMapGetOrInsert(): void {
  const proto = Map.prototype as unknown as Partial<
    MapWithGetOrInsert<unknown, unknown>
  >;

  if (typeof proto.getOrInsert !== "function") {
    Object.defineProperty(Map.prototype, "getOrInsert", {
      value: function getOrInsert<K, V>(this: Map<K, V>, key: K, value: V): V {
        // `has` then `get`: a stored `undefined` is a present entry.
        if (this.has(key)) return this.get(key) as V;
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  if (typeof proto.getOrInsertComputed !== "function") {
    Object.defineProperty(Map.prototype, "getOrInsertComputed", {
      value: function getOrInsertComputed<K, V>(
        this: Map<K, V>,
        key: K,
        callback: (key: K) => V,
      ): V {
        if (typeof callback !== "function") {
          throw new TypeError(
            "getOrInsertComputed: callback must be a function",
          );
        }
        if (this.has(key)) return this.get(key) as V;
        const value = callback(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}
