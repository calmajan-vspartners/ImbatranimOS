# Attribution

This plugin vendors third-party skills. Each retains its original license.

The plugin's commands — `/the-one-move`, `/improve-platform`, and `/ui-check` — and the
`the-one-move`, `corpus-flow`, and `bootstrap-vps-deploy` skills are original to this plugin.
The commands orchestrate the vendored skills below.

> **Consolidation note (v0.11.0):** the plugin was trimmed to a lean frontend
> design-and-ship core. The vendored suites were pruned to the build engine
> (`impeccable`), the taste suite, `ui-ux-pro-max`, and a small set of audit
> primitives the commands actually use. Build/UX details previously held in
> standalone designer-skills (typography, color, spacing, motion, states, copy,
> responsive, …) are now owned by `impeccable`'s sub-commands; the unused
> research / strategy / design-ops / toolkit skills were removed. All removals
> are recoverable from git history.

## designer-skills (MIT)

Source: https://github.com/Owl-Listener/designer-skills — © MC Dean.
See [LICENSE-designer-skills](LICENSE-designer-skills).

Vendored skills retained (the audit/review primitives the commands invoke by name):

- **design-systems** — `accessibility-audit` (WCAG 2.2 audit).
- **prototyping-testing** — `heuristic-evaluation` (Nielsen's 10 heuristics).
- **ux-strategy** — `information-architecture` (sitemap, navigation model, taxonomy).
- **design-ops** — `design-debt-audit` (product-wide consistency/token-drift audit).
- **visual-critique** — `critique-brand-consistency`, `critique-composition`,
  `critique-typography`, `critique-visual-hierarchy` (single-screen, single-dimension reviews).

The rest of the upstream designer-skills suites (ui-design primitives, the broader
ux-strategy / design-research / design-systems / interaction-design / prototyping-testing /
design-ops / designer-toolkit sets) were removed in the v0.11.0 consolidation — their
build/UX scope is covered by `impeccable`, and the research / strategy / process skills
were out of scope for this plugin.

## ui-ux-pro-max (MIT)

Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill — © Next Level Builder.
See [LICENSE-ui-ux-pro-max](LICENSE-ui-ux-pro-max).

Vendored skill: `ui-ux-pro-max` (v2.5.0) — searchable design-intelligence database.

## taste-skill (MIT)

Source: https://github.com/leonxlnx/taste-skill — © Leonxlnx.
See [LICENSE-taste-skill](LICENSE-taste-skill).

Vendored skills (verbatim, the Claude-relevant subset of the upstream collection):

- **`design-taste-frontend`** — the flagship anti-slop frontend skill (brief inference,
  three design dials, real design-system selection map, strict pre-flight checklist) for
  landing pages, portfolios, and redesigns.
- **`minimalist-ui`** — clean editorial style preset.
- **`industrial-brutalist-ui`** — Swiss-print + terminal brutalist style preset.
- **`high-end-visual-design`** — high-end agency style preset.
- **`redesign-existing-projects`** — audit-and-upgrade an existing site to premium quality.

Each style preset carries a **Precedence** note: when used inside the `impeccable` workflow,
impeccable's Absolute bans and general rules win on any conflict (e.g. eyebrow-on-every-section,
universal scroll-reveal, glassmorphism-as-default, warm-cream body backgrounds).

The upstream platform-specific skills (`gpt-taste`, `image-to-code`, `stitch-design-taste`,
`design-taste-frontend-v1`), the image-generation skills (`imagegen-frontend-web`,
`imagegen-frontend-mobile`, `brandkit`), and `full-output-enforcement` were intentionally
not vendored — they target other agents (GPT/Codex/Stitch) or capabilities outside this plugin's scope.

## impeccable (Apache-2.0)

See `skills/impeccable/LICENSE` and `skills/impeccable/NOTICE`.
