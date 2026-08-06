import type { FieldValue } from "../capabilities/Forms.js";

/**
 * In-memory form edit model. Holds pending field-value changes and the set of
 * fields to flatten; `PdfDoc.save()` commits them into AcroForm field values
 * (DEC-39). Brief 09 provides the store; **brief 13** wires read/commit.
 */
export class FormModel {
  /** Pending value changes, keyed by fully-qualified field name. */
  readonly #pending = new Map<string, FieldValue>();
  /** Fields queued for flattening (empty set + `#flattenAll` decides scope). */
  readonly #flatten = new Set<string>();
  #flattenAll = false;

  /** Stage a value change for a field. */
  set(name: string, value: FieldValue): void {
    this.#pending.set(name, value);
  }

  /** Read a staged (pending) value, if any. */
  pending(name: string): FieldValue | undefined {
    return this.#pending.get(name);
  }

  /** All staged changes, for the committer. */
  entries(): [string, FieldValue][] {
    return [...this.#pending.entries()];
  }

  /** Queue fields for flattening; no names ⇒ flatten everything. */
  queueFlatten(names?: string[]): void {
    if (!names || names.length === 0) {
      this.#flattenAll = true;
      return;
    }
    for (const n of names) this.#flatten.add(n);
  }

  /** Whether `name` should be flattened on save. */
  shouldFlatten(name: string): boolean {
    return this.#flattenAll || this.#flatten.has(name);
  }

  /** Whether every field should be flattened. */
  get flattenAll(): boolean {
    return this.#flattenAll;
  }

  /**
   * Whether the model holds any staged work (value edits or queued flattens).
   * The committer short-circuits when false so a merely-read Forms accessor
   * never mutates the document on save (e.g. by creating an AcroForm).
   */
  hasWork(): boolean {
    return this.#pending.size > 0 || this.#flattenAll || this.#flatten.size > 0;
  }
}
