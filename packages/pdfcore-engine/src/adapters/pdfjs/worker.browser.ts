import { GlobalWorkerOptions } from "pdfjs-dist";
import { installMapGetOrInsert } from "./mapGetOrInsert.js";

/**
 * Browser pdf.js worker ownership.
 *
 * The Render adapter (via the browser platform binding) OWNS
 * `GlobalWorkerOptions.workerSrc` so consumers — the web demo AND the
 * ImbatranimOS add-on — never re-wire it and never fetch worker assets from a
 * CDN.
 *
 * ── Vendoring approach (chosen; documented in the handoff) ──────────────────
 * We resolve the worker with `new URL("pdfjs-dist/build/pdf.worker.min.mjs",
 * import.meta.url)`. `pdfjs-dist` is an external, so this specifier resolves in
 * the CONSUMER's dependency graph; every modern bundler (Vite, webpack 5,
 * Rollup, esbuild) rewrites `new URL(<bare>, import.meta.url)` at build time and
 * EMITS the worker file into the consumer's own output directory. Result:
 *   • single source of truth — the worker ships straight from the installed
 *     `pdfjs-dist`, always version-matched to the API build;
 *   • zero-dependency, single-dir, self-hosted bundle — no CDN, no runtime
 *     fetch of a floating version;
 *   • nothing for the consumer to configure.
 *
 * Escape hatch: a consumer whose bundler does not understand the URL pattern
 * (or who self-hosts the asset at a known path) can call {@link configureWorker}
 * with an explicit URL BEFORE first use; we won't override an explicit choice.
 *
 * (WASM note: pdf.js v4+ uses no WASM for the core render/text/outline paths we
 * ship in v1 — only the optional JPEG2000/JBIG2 decoders do, and those are not
 * on the v1 path. If a future capability needs them, vendor `pdfjs-dist`'s
 * `wasm/` dir the same way — resolved from node_modules, emitted by the
 * consumer bundler — never from a CDN.)
 */

let configured = false;

/** Explicitly set the worker source (escape hatch). Wins over auto-config. */
export function configureWorker(src: string): void {
  GlobalWorkerOptions.workerSrc = src;
  configured = true;
}

/** Idempotently point pdf.js at the vendored worker. Called by the Render path. */
export function ensureBrowserWorker(): void {
  // Runs even when the worker is already configured: this is about the engine's
  // own missing Map methods, not the worker URL, and every render needs them.
  installMapGetOrInsert();
  if (configured || GlobalWorkerOptions.workerSrc) {
    configured = true;
    return;
  }
  GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  configured = true;
}
