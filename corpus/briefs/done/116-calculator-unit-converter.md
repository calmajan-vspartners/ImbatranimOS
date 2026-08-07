# Brief 116 — Calculator: the fourth tab

> **Outcome (2026-08-07): DONE.** A `Conv` tab beside Basic / Sci / Prog, over
> `engine/units.ts` — static tables and two functions, no evaluator of its own.
> Four categories: length, mass, temperature, data.
>
> The shape follows the physics rather than being forced flat. Length, mass and
> data convert through a base unit by one multiplication, so they are a factor
> table; **temperature does not**, because its scales have different zero
> points, so it is modelled as real functions pivoting through Celsius instead
> of being given a factor it does not have. Every factor is exact by
> definition — the 1959 international agreement for inch and pound, SI and IEC
> prefixes for data — and the tests assert the *definitions* (an inch is
> 25.4 mm, a mile is 5280 ft, a pound is 0.45359237 kg, water boils at 212 °F,
> −40 is the fixed point) rather than whatever number the code happens to emit.
>
> Data lists decimal **and** binary prefixes side by side, which is the reason
> the category is worth having: a "500 GB" disk really is 465.66 GiB, and a
> converter that quietly conflates them is worse than none. That exact case is
> both a unit test and a probe check.
>
> Two deliberate refusals. `convert` returns **null** for an unknown unit or a
> non-finite input rather than 0 or NaN — a converter that silently answers
> zero is the failure mode worth designing out — and the pad shows an empty
> field plus "That is not a number" instead of a stale result. And the tab
> takes neither the memory register nor the tape, for the same reason
> Programmer does not: a conversion is a *pair* of numbers with units attached,
> and putting half of it on the tape would record something the user never
> computed.
>
> Both sides are live — type into either and the other follows — so it reads as
> one conversion rather than an input and an output, and Swap keeps the number
> the user is looking at on the side they are looking at.
>
> Verified: turbo 120/120 with 27 new unit tests (including table-integrity
> checks: exactly one base unit per category, unique ids, both defaults present,
> and no factor anywhere in temperature), and a 12-check browser probe on the
> production bundle — 1 m → 3.2808 ft on open, typing into the To side driving
> the From side, 100 °C → 212 °F, −40 → −40, 500 GB → 465.66 GiB, swap, the
> not-a-number path, and Basic still working. Console clean.

Status: **done** · From the 2026-08-07 research sweep. EASY · `calculator`
only. No backend, no protocol change, no new dependency.

## Problem

Every OS calculator ships a converter tab; this one had three modes and no way
to answer "how many feet is that". The evaluator and the tape already exist,
and a converter needs neither — it is a table.

## Fix

1. `engine/units.ts`: `CATEGORIES`, `convert`, `formatResult`, plus lookups.
2. `engine/units.test.ts`: definitions, table integrity, refusals, formatting.
3. `ConverterPad.tsx` + a fourth entry in `Calculator.tsx`'s `MODES`.

## Must preserve

- Basic and Scientific keep sharing the memory register and the tape; the
  converter joins Programmer in taking neither.
- The 300px minimum width: four short tab labels still fit on one row, which
  is why they were shortened to Basic / Sci / Prog when the third arrived.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green; the new
unit tests named in the outcome.

**Verified in a browser**: the definitions above, both directions, swap, and
a non-number rejected. Console clean (§14).

## Out of scope

Currency (needs a live rate source and an offline story), area/volume/speed
(the same table, addable later without redesign), and a converter mode in the
command palette.
