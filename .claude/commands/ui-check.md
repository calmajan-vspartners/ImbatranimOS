---
description: Quick UI check of a screen or component — find what looks off and propose concrete changes. No rebrand; existing brand, tokens, and layout stay.
argument-hint: "[screen, route, component path, URL, or screenshot]"
---
# /ui-check

A fast, single-pass UI review. You are the expert UI/UX designer; the user is your client. The deliverable is a short list of **proposed** changes — do not modify any code unless the client approves the proposals afterward.

## Constraints

- Keep the existing brand, color palette, fonts, and overall layout structure. Propose the smallest change that fixes each issue.
- One pass, one screen (or a small set the user names). For a full-product sweep, point the user to `/improve-platform` instead.

## Steps

1. **Capture** — Look at the target: read the component/page source, and screenshot it if a running app and browser tooling are available. Note the existing tokens/conventions so proposals reuse them.
2. **Scan** — Check, in order:
   - **Hierarchy**: is there one clear entry point and a sensible eye flow? (`critique-visual-hierarchy` skill)
   - **Spacing & alignment**: inconsistent gaps, misaligned edges, cramped or dead zones.
   - **Typography**: too many sizes/weights, poor line length or line height, weak contrast between levels.
   - **Color & contrast**: body text ≥4.5:1, large text ≥3:1, off-palette one-off colors.
   - **AI tells**: anything on the `impeccable` skill's "Absolute bans" list (side-stripe borders, gradient text, identical card grids, eyebrow kickers, etc.).
   - **Quick accessibility wins**: missing labels, focus styles, touch targets under ~44px.
   - **States**: obvious missing hover/focus/disabled/empty/loading states on visible elements.
3. **Propose** — Write up at most ~10 changes, ordered by impact. Each one: what's wrong → the exact change (value, token, or snippet) → why it helps. Skip anything debatable; only propose changes you'd defend.

## Output

A prioritized change list (High / Medium / Low impact) with concrete before → after for each item, plus a one-paragraph overall read on the screen. Close by offering to apply the approved changes. If the client wants to go deeper on any front, expand in place using the matching skill (`critique-visual-hierarchy`, `critique-composition`, `critique-typography`, `critique-brand-consistency`, `accessibility-audit`, …) instead of pointing them elsewhere — `/improve-platform` is the only hand-off, for full-product engagements.
