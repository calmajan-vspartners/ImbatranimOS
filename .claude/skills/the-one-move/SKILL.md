---
name: the-one-move
description: Use BEFORE building a new frontend (landing page, marketing site, hero, campaign, portfolio) to commit a non-generic STRUCTURE first — the one bold structural move, the composition skeleton, the concrete subject, the hierarchy — so the build doesn't default to the AI template (centered hero stack, equal-box grids, eyebrow-on-every-section). Generative and upfront, not an audit. Produces a short structural brief, then hands off to the `impeccable` skill to build it. Reach for it when a design "looks AI-generated", "too generic", "like a template", or when starting a brand/marketing surface from scratch. Narrow by design — it decides STRUCTURE, not palette/type/copy polish (that's impeccable). Not for app/dashboard/product UI where the layout is constrained by the task, and not for backend work.
version: 0.1.0
user-invocable: true
argument-hint: "[target — what you're about to build, e.g. 'a product landing hero', 'a landing page for X']"
license: Apache 2.0
---

Commit the **structure** of a frontend before writing it, so the result is *designed* rather than *generated*. This is the upfront, generative complement to `impeccable`'s audit-side bans: where impeccable catches slop after the fact, this forces a non-generic skeleton before any code exists.

## Stance

You are the design director making the call that the AI default would never make on its own. The deliverable is a **one-page structural brief** the user approves, then `impeccable` builds. You decide structure; you do NOT pick the final palette, fonts, or write body copy here — that is impeccable's job, and duplicating it makes this skill bloated and slow. Stay in your lane: **layout, composition, hierarchy, the subject, the one move.**

This skill is short on purpose. If you find yourself producing a full design system, stop — you've left the lane.

## Why this exists (the failure it prevents)

AI-generated frontends converge on the same skeleton regardless of brief:

> eyebrow kicker → big centered headline → one paragraph → two buttons → a row of 3 stats → a grid of 4 identical icon-cards → a 3-step row → a 4-badge trust strip → centered CTA → footer.

Every block is centered or evenly gridded. Decoration (gradients, glows, grain, blur) is layered on to *feel* designed without changing the skeleton. The palette and fonts can be excellent and it will **still** read as AI, because the tell is the **structure**, not the surface. This skill refuses that skeleton up front.

## The setup

1. **Read the brief and the register.** What is being built, for whom, and what is the ONE thing a visitor must do or feel? If unclear, ask 2–3 sharp questions before proceeding — the whole brief hangs on intent.
2. **Find the concrete subject.** A page about something with no *thing* to look at defaults to typographic boxes. Name the literal subject the composition is built around (a product shot, a 3D object, a photograph, a map, a large data object, a custom illustration system, or — deliberately — type itself as the object). "There is no subject" is a valid answer ONLY if type or a graphic system is then named as the subject on purpose.
3. **Check for committed brand.** If the project already has DESIGN.md / tokens / a brand, respect it — you are deciding structure within that identity, not restyling.

## The seven structural tells (name them, then break them)

Diagnose what the *default* build of this surface would do, then commit the opposite. For each tell the brief must state the specific structural decision that breaks it — not "avoid this", but "instead, this".

1. **The centered hero stack.** eyebrow→H1→p→2 buttons→stats, all centered. → Commit a real composition: full-bleed subject with UI in a corner / lower-third; or an asymmetric split (oversized type bleeding off one edge, subject on the other); or type-as-hero where one word *is* the composition. Pick one and describe the frame.
2. **Equal-box grids.** N identical cards (icon+title+text) repeated. → Impose hierarchy: one item is large/featured, the rest demoted to a tighter list; or a real layout (bento with intentional size variation, a table, an editorial run). No row of clones. **When the repeated elements are visual objects** (illustrations, avatars, 3D props, buildings, product shots), differentiate them by **silhouette / form** — roofline, outline, attached structure, props — not by hue. A recolour is not differentiation: if the set only reads as distinct once colour is applied, it is still a row of clones. Test with colour stripped (squint / grayscale) — each element must read as its own shape. (A good palette on same-shaped objects still reads as sameness; the user has flagged exactly this.)
3. **Stacked equal sections.** Every section the same full-width centered block, top to bottom. → Vary the rhythm: alternate alignment (left / right / full-bleed), let one section pin/stick or scroll horizontally, give sections different heights and entry points. The page should not be a stack of interchangeable bands.
4. **Decoration doing structure's job.** Glow / grain / gradient / blur added to make a generic layout feel designed. → Decoration is allowed ONLY on top of a structure that already works in plain wireframe. The brief's skeleton must read as non-generic in pure black-and-white boxes.
5. **Symmetry everywhere.** Everything centered, evenly gridded, balanced. → Introduce deliberate tension: asymmetry, overlap, an element breaking the grid or bleeding off-canvas, an off-center optical anchor.
6. **No concrete subject.** Covered in setup step 2 — if the brief can't name the subject, it will become boxes.
7. **Scaffolding by reflex.** Eyebrow kicker on every section, `01 / 02 / 03` numbered markers everywhere, "trust badge" strip, hero-metric template. → Use a kicker/number ONLY where the content genuinely is a named sequence; otherwise choose a different cadence. (These overlap `impeccable`'s Absolute bans — defer to that list for the full set.)

## The one move

Every memorable design has **one bold structural move** you could describe in a sentence to someone who can't see it — and that the generic version would never make. Not a color, not an effect: a structural commitment.

- *"The hero is a full-screen night-road scene and the headline sits in the lower-third like a film title."*
- *"The whole page hangs off one continuous vertical line; sections alternate left and right of it."*
- *"There is no hero — the first screen is a single word at 40vw and nothing else."*
- *"Services scroll horizontally while the page is pinned; the truck advances as you scroll."*

The brief MUST name exactly one such move and make everything else serve it. If you can't state it in one sentence, you don't have it yet. Two competing bold moves is noise — pick the one that serves the register and demote the other to a supporting detail.

## Anti-monoculture guard

Breaking the AI template must not install a *new* template. Do not reflexively reach for brutalism, horizontal-scroll, giant-type, or dark-mode just to look non-generic — that is the second-order tell (see impeccable's category-reflex check). Test: *"If someone guessed my 'bold move' from the category plus 'not the AI default', would they get it?"* If yes, it's the predictable anti-move; go one level deeper. The move must fit THIS brief's register and subject, not a fashion.

Also weigh the register's real constraints against the move. A phone-first emergency service whose visitor needs the number in two seconds cannot bury it behind a horizontal-scroll narrative — the move must not fight the primary task. State the one risk the move introduces and how the build mitigates it (mobile fallback, reduced-motion path, the primary action staying reachable).

## Output — the structural brief

Keep it to one screen. No palette, no font names, no copy:

1. **Intent** — one line: who, and the one thing they must do/feel.
2. **The subject** — the concrete thing the composition is built around.
3. **The one move** — one sentence. The bold structural commitment.
4. **Composition skeleton** — section by section, as plain wireframe boxes: what's where, alignment, what breaks the grid, where the eye enters. Describe it so it would read as non-generic even with zero styling. Note the desktop→mobile structural change for any pinned/horizontal/asymmetric section.
5. **Hierarchy** — what is biggest / first / unmissable, and what is deliberately demoted.
6. **Tells broken** — a short list: each of the seven tells this surface was at risk of, and the specific decision that breaks it.
7. **The risk** — the one downside the move introduces, and the mitigation.

Then: present it, get approval or iterate. On approval, **hand off to `impeccable`** (its `shape`/`craft` flow) to build to this skeleton — impeccable owns palette, type, motion, copy, and the slop bans during execution. State the handoff explicitly; do not start building UI inside this skill.
