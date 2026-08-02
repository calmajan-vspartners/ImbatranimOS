# Brief 70 — Calculator: make every key reachable, then make it worth reaching

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
EASY/MEDIUM · add-on `apps/add-ons/calculator` (1123 LOC / 10 files, zero
non-core deps). Depends on brief 52 for the window clamp.

## Problem

**1. The `=` key is unreachable at short viewports.** The 2026-07-19 walkthrough
found Calculator's bottom row (`0 . =`) fully hidden under the taskbar at
1280×577. Brief 52 fixes the platform half (a new window is clamped to the
desktop), but this app also loses its own layout battle: the keypad is a
`flex-none` block sitting *below* an unbounded `flex-1` display
(`BasicPad.tsx:103,115`), so when space runs short the display keeps its size
and the keypad — the entire point of the app — is what gets pushed out
(`ui-conventions.md` §20c names this exact pattern). The app must also declare an
honest `minSize`.

**2. It cannot do the arithmetic people open a calculator for.** Basic mode is a
correct shunting-yard evaluator with no `eval` — keep that — and Programmer mode
covers BigInt/HEX/DEC/OCT/BIN with bitwise ops. But there is no **scientific**
mode: no trig, no log/ln, no powers/roots beyond the basics, no parentheses
depth, no constants. That is the single most common reason to reach past a
phone's calculator.

**3. No memory keys and no tape.** M+/MR/MC are absent, and there is no history
of previous results — so a multi-step calculation cannot be checked or reused.

**4. Floating-point artifacts are shown raw.** A shunting-yard evaluator over
IEEE doubles renders `0.1 + 0.2` as `0.30000000000000004`. Technically honest,
practically wrong for a desktop calculator.

## Proposed decisions (ungrilled)

- **Fix the layout so the keypad is privileged.** The keypad gets the fixed
  space it needs; the *display* shrinks (and scrolls its text horizontally) when
  the window is short. Inverting the current priority is the actual fix — the
  clamp alone only stops the window being too big.
- **Add a Scientific mode** as a third tab beside Basic and Programmer, reusing
  the existing evaluator with added functions and constants rather than a second
  engine. **No `eval`, ever** — that property is why the current evaluator was
  hand-written and it is not up for revisiting.
- **Memory keys + a scrollable tape** of recent expressions and results, click to
  reuse a value. The tape is session state (it dies with the window), which
  matches how a physical calculator behaves and avoids inventing storage.
- **Round the display, keep full precision internally.** Present results at a
  sensible significant-figure count so `0.1 + 0.2` reads `0.3`, while the
  underlying value stays exact for chained operations. Show the full value on
  demand (copy, or a details affordance).
- **Deferred — unit conversion.** Useful and self-contained, but it is a data
  table plus its own UI; it deserves its own decision rather than riding along.
- **Rejected — currency conversion.** It needs live network rates, which means
  an outbound dependency and a CSP hole for a feature the OS has no business
  owning.
- **Rejected — an arbitrary-precision decimal library.** Sensible rounding solves
  the visible problem; a bignum dependency for display cosmetics fails the
  lightweight test. (Programmer mode already uses BigInt where exactness
  genuinely matters.)

## Fix

1. Restructure `BasicPad.tsx` (and the Programmer pad equivalently): keypad
   `flex-none` with a real minimum, display `flex-1 min-h-0` and shrinkable;
   verify at exactly `minSize`.
2. Honest `minSize`/`defaultSize` in the manifest, measured at the point every
   key is still clickable.
3. Scientific tab: extend the tokenizer/evaluator with `sin cos tan asin acos
   atan log ln sqrt cbrt x^y n! π e`, degree/radian toggle, and nested
   parentheses. Unit-test the evaluator hard — it is pure and this is where
   correctness bugs hide.
4. Memory keys wired to the evaluator; tape component with click-to-reuse.
5. Display formatting layer with a full-precision copy action.
6. Keyboard coverage audit: every on-screen key reachable from the keyboard,
   scoped to the top window via the existing `useTopWindowKeydown`.

## Must preserve (regression surface)

- **No `eval`** anywhere in the evaluation path.
- Programmer mode's BigInt 64-bit semantics, base switching, and bitwise/shift
  behaviour are unchanged — scientific functions must not leak into it.
- Existing keyboard bindings stay window-scoped so two calculators do not fight.
- Zero new dependencies.
- Operator precedence and associativity in the existing evaluator are unchanged
  for expressions that already worked.

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok. Substantial
unit tests for the evaluator: precedence, unary minus, nested parens, each new
function, degrees vs radians, division by zero, overflow, and a table of
formatting cases including `0.1 + 0.2`.

**Verified in a browser**: at 1280×577 every key including `=` is visible and
clickable, and at exactly `minSize` too; run a multi-step calculation using the
tape and memory; check `0.1 + 0.2` displays `0.3`; confirm Programmer mode is
untouched.

## Out of scope

Unit and currency conversion, graphing, equation solving, a bignum library, and
persisting history across windows.
