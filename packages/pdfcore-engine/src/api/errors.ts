/**
 * Public error types for `@pdfcore/engine`.
 *
 * Errors are part of the public surface so callers (and later briefs) can
 * branch on them. No backend-library error type is ever re-thrown directly.
 */

/** Base class for all errors thrown by `@pdfcore/engine`. */
export class PdfEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfEngineError";
  }
}

/**
 * Thrown by a capability method that exists in the interface but is not yet
 * implemented by the current backend adapter. The message names the capability
 * method and the brief that will add it, so callers get an actionable signal
 * rather than a silent no-op.
 *
 * @example
 *   throw new NotImplemented("Pages.rotate", "added by brief 11");
 */
export class NotImplemented extends PdfEngineError {
  constructor(what: string, detail?: string) {
    super(`${what} is not implemented yet${detail ? ` — ${detail}` : ""}.`);
    this.name = "NotImplemented";
  }
}

/**
 * Thrown when a capability cannot run on the current platform (e.g. canvas
 * rendering without a bound platform, or a Node-only feature in the browser).
 * Fails fast rather than silently degrading (see architecture.md platform
 * matrix / DEC-34).
 */
export class UnsupportedPlatform extends PdfEngineError {
  constructor(what: string, detail?: string) {
    super(
      `${what} is not available on this platform${detail ? ` — ${detail}` : ""}.`,
    );
    this.name = "UnsupportedPlatform";
  }
}

/**
 * Thrown when a document cannot be opened for editing because it is encrypted.
 * The pdf-lib write-parse throws its own `EncryptedPDFError`; per this module's
 * contract no backend error is ever re-thrown directly, so {@link PdfDoc.load}
 * catches it and raises this typed engine error instead.
 */
export class EncryptedDocument extends PdfEngineError {
  constructor(detail?: string) {
    super(
      `Document is encrypted and cannot be opened for editing${detail ? ` — ${detail}` : ""}.`,
    );
    this.name = "EncryptedDocument";
  }
}

/**
 * Base class for non-fatal warnings surfaced by the engine. A warning does not
 * abort the operation; it is collected and exposed via `PdfDoc.warnings()` so a
 * caller can react (e.g. tell the user their signature will break) without the
 * load/save failing.
 */
export class PdfEngineWarning extends PdfEngineError {
  constructor(message: string) {
    super(message);
    this.name = "PdfEngineWarning";
  }
}

/**
 * Raised (as a warning, not thrown) when a document carrying an existing
 * digital signature is loaded: the engine's `save()` is a full rewrite, which
 * necessarily invalidates any `/ByteRange` signature. Surfaced at load so the
 * caller is warned before it saves over a signed file.
 */
export class SignatureInvalidationWarning extends PdfEngineWarning {
  constructor(detail?: string) {
    super(
      `Document contains a digital signature that a save will invalidate (the engine rewrites the whole file)${detail ? ` — ${detail}` : ""}.`,
    );
    this.name = "SignatureInvalidationWarning";
  }
}
