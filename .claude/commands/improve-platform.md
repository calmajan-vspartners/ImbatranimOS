---
description: Audit a generic AI-generated platform end-to-end, then guide a phased improvement process — de-slop the visuals, fix the UX, and ship something distinctive and accessible.
argument-hint: "[path, URL, or description — e.g. './src', 'http://localhost:3000', or 'the admin dashboard']"
---
# /improve-platform

Take a platform that was generated (or heavily assisted) by AI and run it through a structured audit → roadmap → guided-improvement loop. The goal is not a rebrand from scratch: it is to find everything that makes the product feel generic, broken, or untrustworthy, then fix it in prioritized waves with the user in the loop.

**Stance**: you are the expert UI/UX designer; the user is your client. They describe goals and react to your work — you decide which disciplines apply. The phases below name the audit primitives; the execution toolbox is the `impeccable` skill and its sub-commands (`audit`, `harden`, `onboard`, `adapt`, `clarify`, `colorize`, `animate`, `layout`, `typeset`, `extract`, …), with `ui-ux-pro-max` for design-intelligence lookups and the style presets (`minimalist-ui`, `industrial-brutalist-ui`, `high-end-visual-design`) when a deliberate aesthetic lane is called for. When the client's feedback opens a new front (dark mode, motion, empty states, copy…), reach for the matching `impeccable` sub-command and fold it into the current wave rather than telling the client to run something else.

Run the phases in order. Do not start fixing anything before Phase 3 is approved.

## Phase 1 — Recon

1. **Map the surface.** Identify the stack, routes/screens, shared components, and any existing design tokens, theme files, or CSS variables. List the 5–10 screens that carry the most user traffic or business value — these anchor the audit.
2. **Capture evidence.** If a dev server is running (or can be started) and browser tooling is available, screenshot the anchor screens at desktop and mobile widths. Otherwise audit from source.
3. **Establish intent.** Read any PRODUCT.md, README, or brand material. If the product's audience, register (marketing vs. product UI), and tone are unclear, ask the user 2–3 questions now — every later judgment depends on them.

## Phase 2 — Audit

Run every dimension and collect findings into one pool. Each finding records: issue, location (file/screen), dimension, severity, and the specific fix. Use parallel subagents for independent dimensions when the surface is large.

1. **AI-slop scan** — Check every anchor screen against the `impeccable` skill's "Absolute bans" and "AI slop test" (side-stripe borders, gradient text, identical card grids, hero-metric template, eyebrow kickers on every section, cream-default backgrounds, category-reflex theming). This is the signature failure mode of AI-generated platforms; weight it accordingly.
2. **Heuristics** — Evaluate the core flows against Nielsen's heuristics using the `heuristic-evaluation` skill.
3. **Accessibility** — Audit against WCAG 2.2 AA using the `accessibility-audit` skill: contrast, focus order, labels, keyboard paths, reduced motion.
4. **Consistency & debt** — Find drift in spacing, type, color, and component variants using the `design-debt-audit` skill (it inventories one-off values, token gaps, and duplicated component variants). AI-generated codebases typically have many one-off values where tokens should be.
5. **Structure & navigation** — Check that the IA and navigation model match user tasks using the `information-architecture` skill.
6. **States & resilience** — Verify loading, empty, error, and validation states exist and behave well (route fixes through `impeccable harden` for errors/edge cases and `impeccable onboard` for empty/first-run states). Generated platforms ship the happy path; the rest is usually missing.
7. **Responsive** — Spot-check breakpoints, overflow, and touch targets; deeper responsive rework routes through `impeccable adapt`.
8. **Copy** — Review microcopy, CTAs, errors, and empty states; flag filler text and inconsistent voice, and route rewrites through `impeccable clarify`.

## Phase 3 — Roadmap

1. Deduplicate findings and rate severity:
   - **P1 — Broken or untrustworthy**: accessibility failures, dead/missing states, misleading copy, unusable flows.
   - **P2 — Generic or inconsistent**: AI-slop tells, token drift, weak hierarchy, navigation friction.
   - **P3 — Polish**: motion, refinement, delight.
2. Group the fixes into **improvement waves** of related work (e.g. "Wave 1: contrast + states", "Wave 2: tokenize + de-slop the dashboard", "Wave 3: motion + polish"). Each wave should be independently shippable.
3. Present the audit summary (counts by severity and dimension, weakest/strongest areas) and the wave plan. **Stop and get the user's approval or re-ordering before touching code.**

## Phase 4 — Guided improvement

Work one wave at a time:

1. Restate the wave's findings and the intended fixes.
2. Apply the fixes. For visual or structural redesign work, route through the `impeccable` skill (its design guidance and bans govern all new UI code). For systemic fixes, use the matching `impeccable` sub-command: `extract` to pull a token/component system out of one-off values and consolidate duplicated UI, `layout` for spacing and rhythm, `colorize` for theme/dark-mode work, `animate` for motion passes. For an existing site that needs a broad premium-quality lift, the `redesign-existing-projects` skill is the audit-and-upgrade checklist.
3. Verify: re-screenshot or re-read the affected screens and confirm each finding in the wave is resolved; re-check contrast on anything recolored. For a reworked key screen, re-run the `critique-visual-hierarchy`, `critique-composition`, and `critique-typography` skills as a final gate.
4. Report what changed, then check in with the client. Fold their feedback into the plan — adjust the next wave's scope, or open a new wave with whichever skill the feedback calls for — before continuing.

## Output

- **Audit report** — executive summary, findings grouped by severity with location and fix, per-dimension assessment naming the weakest and strongest areas.
- **Improvement roadmap** — the approved waves with scope and expected impact.
- **Per-wave reports** — what was fixed, how it was verified, what remains.

End by recommending next engagements as their designer: formalize the emerging design system with `impeccable extract` (pull tokens and reusable components out of the reworked screens) and `impeccable document` (capture the visual system in a DESIGN.md), then validate the reworked flows with real users.
