# Brief 119 — Markdown Editor: a link to a CSV opens the CSV

> **Outcome (2026-08-07): DONE.** A relative link to anything that was not
> markdown raised a toast — *"open it from Files. Markdown links open here
> directly."* — which is the app telling the reader to go and do its job. Those
> links now go through the brief-81 association registry, the same
> `assoc.resolveOpener` the file manager's double-click uses, reached straight
> off the handle (`system.intents.associations`) so nothing had to be imported
> across an add-on boundary.
>
> Markdown links deliberately still stay in the markdown editor, even if the
> user has associated `.md` with something else: following a link inside a
> document set is reading, not launching, and a test pins that against a
> hostile registry that maps `md` to Notepad.
>
> "Nothing claims this" is an honest third answer, not a failure — the toast
> now names the file and says exactly that instead of implying the reader
> should have known where to look. Routing goes through `openApp`, which is
> also the choke point that records the OS-wide recent (brief 94), so a file
> reached from a document counts as opened.
>
> Verified: turbo 120/120, 6 new unit tests for `linkTarget` (markdown wins
> over the registry, the registry decides everything else, an unclaimed
> extension returns `none`, and matching is on the *basename* so a directory
> called `notes.csv` cannot decide the answer), and a 6-check browser probe on
> the production bundle — a `.csv` link opening Sheets, an unclaimed `.weird`
> link raising "Nothing in the system claims thing.weird" and opening no app at
> all, and no trace of the old toast. Console clean.

Status: **done** · From the 2026-08-07 research sweep. EASY ·
`markdown-editor` only. No backend, no protocol change, no new dependency.

## Problem

`MarkdownEditor.tsx`'s `openRelative` handled `.md`/`.markdown` and told the
user to go to Files for everything else. Meanwhile brief 81 built a registry
that already knows which app opens a `.png`, a `.csv` or a `.pdf`, and the
handle exposes it — so the editor was refusing to do something the OS could
already answer.

## Fix

1. `lib/linkTarget.ts`: `linkTarget(assoc, path)` → `markdown` | `app` |
   `none`, plus `baseName`. Pure, so the routing rules are testable.
2. `MarkdownEditor.tsx`: `openRelative` dispatches on that; the `none` branch
   names the file instead of pointing at Files.

## Must preserve

- The preview's other link behaviours: in-document `#anchors` still scroll
  inside the preview container, and absolute URLs still leave in a new tab
  with `noopener noreferrer` (this page holds an authenticated session).
- Image rendering and `resolveRelative`'s jail behaviour untouched.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green.

**Verified in a browser**: a `.csv` link opens Sheets; an unclaimed extension
says so and opens nothing. Console clean (§14).

## Out of scope

Following links into other filesystem roots (a relative link cannot cross
roots, by design), link previews on hover, and broken-link detection.
