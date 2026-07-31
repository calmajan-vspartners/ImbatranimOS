import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem as PdfJsTextItem } from "pdfjs-dist/types/src/display/api.js";
import type { Rect, TextHit, TextSearchOptions } from "../../api/types.js";

/**
 * In-document search over `pdfjs-dist` `getTextContent()` (brief 16).
 *
 * pdf.js hands back text as a flat, per-page array of items in reading order —
 * `.str` plus a transform matrix (`(e,f)` = PDF-space anchor) and measured
 * `.width`/`.height`. A query can span more than one item (a font/style change
 * mid-word splits a run into separate items with no space between them), so we
 * don't match item-by-item: we flatten each page into one normalized character
 * stream, search THAT, then map a match's character span back to the item(s)
 * it touches to build highlight rects.
 *
 * Line grouping (needed so a match spanning several *lines* yields one rect
 * per line, per the `Text.search` contract) uses pdf.js's own `hasEOL` flag —
 * it already runs the layout heuristics we'd otherwise have to reinvent — plus
 * a small y-coordinate fallback in case a producer never sets it.
 *
 * Known approximations (documented, not hidden):
 *  - Sub-item rect edges are prorated by character *count*, not measured glyph
 *    width (proportional fonts aren't perfectly uniform-width) — good enough
 *    for highlight rects, not pixel-exact.
 *  - Diacritic folding assumes NFD decomposes a letter into exactly one base
 *    codepoint + combining marks (true for common Latin accents), so index
 *    alignment between normalized and original text is preserved.
 */

/** One text item's PDF-space geometry, plus the pdf.js line-break flag. */
interface PageItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hasEOL: boolean;
}

/** One character of a page's flattened search text. */
interface FlatChar {
  /** Normalized (case/diacritic-folded) form used for matching. */
  ch: string;
  /** Original character, used to render `context`. */
  raw: string;
  /** Source item index, or -1 for a synthetic joiner (space/line-break). */
  itemIndex: number;
  /** Character offset within the source item's `str`, or -1 for a joiner. */
  charInItem: number;
}

export async function searchDocument(
  doc: PDFDocumentProxy,
  query: string,
  opts?: TextSearchOptions,
): Promise<TextHit[]> {
  if (query === "") return [];
  const wanted = opts?.pages ?? range(1, doc.numPages);
  const hits: TextHit[] = [];

  for (const pageNumber of wanted) {
    if (pageNumber < 1 || pageNumber > doc.numPages) continue;
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PageItem[] = [];
    for (const raw of content.items) {
      if (!isTextItem(raw)) continue;
      if (raw.str === "") continue;
      const [, , , , e, f] = raw.transform as number[];
      items.push({
        str: raw.str,
        x: e ?? 0,
        y: f ?? 0,
        w: raw.width,
        h: raw.height,
        hasEOL: Boolean((raw as { hasEOL?: boolean }).hasEOL),
      });
    }
    hits.push(...searchPage(pageNumber, items, query, opts));
  }
  return hits;
}

function searchPage(
  pageNumber: number,
  items: PageItem[],
  query: string,
  opts?: TextSearchOptions,
): TextHit[] {
  if (items.length === 0) return [];
  const { flat, lineOf } = buildFlatText(items, opts);
  const flatText = flat.map((f) => f.ch).join("");
  const normQuery = normalizeQuery(query, opts);
  if (normQuery === "") return [];

  const matches = findMatches(flatText, normQuery, opts?.wholeWord ?? false);
  return matches.map((m) => ({
    page: pageNumber,
    rects: computeRects(flat, lineOf, items, m.start, m.end),
    context: buildContext(flat, m.start, m.end),
  }));
}

/* ─────────────────────────────────────────────────── flatten + normalize ── */

function buildFlatText(
  items: PageItem[],
  opts?: TextSearchOptions,
): { flat: FlatChar[]; lineOf: number[] } {
  const caseSensitive = opts?.caseSensitive ?? false;
  const ignoreDiacritics = opts?.ignoreDiacritics ?? false;
  const flat: FlatChar[] = [];
  const lineOf: number[] = [];
  let line = 0;

  let prev: PageItem | undefined;
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex] as PageItem;
    if (prev) {
      const newLine =
        prev.hasEOL ||
        Math.abs(item.y - prev.y) > 0.5 * Math.max(prev.h, item.h, 1);
      if (newLine) {
        line++;
        flat.push(joiner());
      } else {
        const gap = item.x - (prev.x + prev.w);
        const threshold = 0.25 * Math.max(prev.h, item.h, 1);
        if (gap > threshold) flat.push(joiner());
        // else: contiguous run (e.g. a mid-word style change) — no joiner,
        // so the query can match straight across the item boundary.
      }
    }
    lineOf[itemIndex] = line;
    for (let c = 0; c < item.str.length; c++) {
      const rawChar = item.str[c] as string;
      flat.push({
        ch: normalizeChar(rawChar, caseSensitive, ignoreDiacritics),
        raw: rawChar,
        itemIndex,
        charInItem: c,
      });
    }
    prev = item;
  }
  return { flat: collapseWhitespace(flat), lineOf };
}

function joiner(): FlatChar {
  return { ch: " ", raw: " ", itemIndex: -1, charInItem: -1 };
}

/** Collapse runs of whitespace to a single space (normalize across items). */
function collapseWhitespace(flat: FlatChar[]): FlatChar[] {
  const out: FlatChar[] = [];
  let prevWasSpace = false;
  for (const f of flat) {
    const isSpace = /\s/.test(f.ch);
    if (isSpace) {
      if (prevWasSpace) continue;
      out.push({ ...f, ch: " ", raw: " " });
      prevWasSpace = true;
    } else {
      out.push(f);
      prevWasSpace = false;
    }
  }
  return out;
}

function normalizeChar(
  ch: string,
  caseSensitive: boolean,
  ignoreDiacritics: boolean,
): string {
  let c = ch;
  if (!caseSensitive) c = c.toLowerCase();
  if (ignoreDiacritics) c = foldDiacritics(c);
  return c;
}

function foldDiacritics(ch: string): string {
  // Strip Unicode combining diacritical marks (U+0300-U+036F) left behind
  // by NFD-decomposing an accented letter.
  const folded = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return folded === "" ? ch : folded;
}

function normalizeQuery(query: string, opts?: TextSearchOptions): string {
  const caseSensitive = opts?.caseSensitive ?? false;
  const ignoreDiacritics = opts?.ignoreDiacritics ?? false;
  const collapsed = query.trim().replace(/\s+/g, " ");
  return Array.from(collapsed)
    .map((c) => normalizeChar(c, caseSensitive, ignoreDiacritics))
    .join("");
}

/* ─────────────────────────────────────────────────────────── matching ──── */

function findMatches(
  flatText: string,
  query: string,
  wholeWord: boolean,
): Array<{ start: number; end: number }> {
  const matches: Array<{ start: number; end: number }> = [];
  let idx = 0;
  while (idx <= flatText.length - query.length) {
    const found = flatText.indexOf(query, idx);
    if (found === -1) break;
    const end = found + query.length;
    if (!wholeWord || isWordBoundaryMatch(flatText, found, end)) {
      matches.push({ start: found, end });
      idx = end; // non-overlapping, continue after this match
    } else {
      idx = found + 1;
    }
  }
  return matches;
}

function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[\p{L}\p{N}_]/u.test(ch);
}

function isWordBoundaryMatch(
  text: string,
  start: number,
  end: number,
): boolean {
  const before = start > 0 ? text[start - 1] : undefined;
  const after = end < text.length ? text[end] : undefined;
  return !isWordChar(before) && !isWordChar(after);
}

/* ────────────────────────────────────────────────────── rects + context ── */

interface ItemSpan {
  itemIndex: number;
  minChar: number;
  maxChar: number;
}

function computeRects(
  flat: FlatChar[],
  lineOf: number[],
  items: PageItem[],
  start: number,
  end: number,
): Rect[] {
  const spans: ItemSpan[] = [];
  for (let i = start; i < end; i++) {
    const f = flat[i];
    if (!f || f.itemIndex === -1) continue;
    const last = spans[spans.length - 1];
    if (last && last.itemIndex === f.itemIndex) {
      last.minChar = Math.min(last.minChar, f.charInItem);
      last.maxChar = Math.max(last.maxChar, f.charInItem);
    } else {
      spans.push({
        itemIndex: f.itemIndex,
        minChar: f.charInItem,
        maxChar: f.charInItem,
      });
    }
  }
  if (spans.length === 0) return [];

  const rects: Rect[] = [];
  let run: ItemSpan[] = [spans[0] as ItemSpan];
  for (let i = 1; i < spans.length; i++) {
    const span = spans[i] as ItemSpan;
    const prevLine = lineOf[(run[run.length - 1] as ItemSpan).itemIndex];
    const curLine = lineOf[span.itemIndex];
    if (curLine === prevLine) {
      run.push(span);
    } else {
      rects.push(runToRect(run, items));
      run = [span];
    }
  }
  rects.push(runToRect(run, items));
  return rects;
}

function runToRect(run: ItemSpan[], items: PageItem[]): Rect {
  const first = run[0] as ItemSpan;
  const last = run[run.length - 1] as ItemSpan;
  const firstItem = items[first.itemIndex] as PageItem;
  const lastItem = items[last.itemIndex] as PageItem;
  const len1 = firstItem.str.length || 1;
  const len2 = lastItem.str.length || 1;
  const left = firstItem.x + (first.minChar / len1) * firstItem.w;
  const right = lastItem.x + ((last.maxChar + 1) / len2) * lastItem.w;

  let y1 = Infinity;
  let y2 = -Infinity;
  for (const span of run) {
    const it = items[span.itemIndex] as PageItem;
    y1 = Math.min(y1, it.y);
    y2 = Math.max(y2, it.y + it.h);
  }
  return [left, y1, right, y2];
}

function buildContext(
  flat: FlatChar[],
  start: number,
  end: number,
  radius = 24,
): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(flat.length, end + radius);
  const text = flat
    .slice(from, to)
    .map((f) => f.raw)
    .join("");
  return `${from > 0 ? "…" : ""}${text}${to < flat.length ? "…" : ""}`;
}

/* ──────────────────────────────────────────────────────────── helpers ──── */

function isTextItem(item: unknown): item is PdfJsTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    "transform" in item
  );
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
