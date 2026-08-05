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

---

## Outcome — 2026-08-05

Done. Three of the four problems were real; the fourth was **already fixed** and the
brief did not know it.

### Item 4 was already done — and hid a worse bug behind it

"Floating-point artifacts are shown raw… `0.1 + 0.2` renders as
`0.30000000000000004`." Not true: `formatResult` has been rounding to 12
significant digits all along, so it read `0.3` before this brief started. Pinned
by a test now, along with a table of the other formatting cases.

But the brief's *reasoning* — "round the display, keep full precision internally"
— pointed straight at a real defect its author had not spotted: **only the rounded
string was kept.** `evaluateState` stored `result: formatResult(value)` and the next
operation re-parsed that string, so `1÷3` then `×3` produced `0.999999999999`. Twelve
digits were all that survived `=`.

Fixed by carrying the value beside the text: a number token now has an optional
`exact`, the display shows the rounded form and the evaluator receives the full one.
Measured in the browser: `1÷3` → `0.333333333333`, then `×3` shows
`0.333333333333×3` and equals exactly `1`. The display also says when it is rounded
and offers the exact value, with a copy button (`0.30000000000000004`), which is the
"full value on demand" the brief asked for.

### The layout, and which half of it was actually broken

The brief blames `BasicPad.tsx:103,115` — "the keypad is a `flex-none` block sitting
below an unbounded `flex-1` display… when space runs short the keypad is what gets
pushed out". That reading is backwards for a flex column: `flex-1` means
`flex: 1 1 0%`, so the *display* was already the element that shrinks, and
`flex-none` kept the keypad at its natural height. What the app was missing is a
**floor** for the display and, more importantly, an **honest `minSize`** — the
manifest's 320×480/280×420 predate Programmer mode and are unrelated to the height
the keys actually need.

So the numbers were measured instead of guessed. Scientific is the tallest mode:
276px of keypad + a 27px memory/tape row + a 36px display floor = 339px, plus ~29px
of tabs and ~32px of window chrome — 400px before the display shows anything.
`minSize` is now 300×430 and `defaultSize` 340×560.

Verified at the three sizes that matter, by measuring every key's rect against where
the taskbar starts: all keys inside the usable desktop at 1400×900, at 1280×577
(the walkthrough's viewport), and at exactly 300×430 — with `=` clicked at the short
size to prove it is reachable and not merely on screen.

One measurement worth passing on: a window **opened** at 1280×577 is fine, and a
window opened tall and then squeezed by shrinking the desktop is not — its keypad
ends up ~200px below the taskbar. That is brief 52's own recorded follow-up
("reflow-on-resize for already-open windows… `restoreLayout` also does not
re-clamp"), not this app's layout, and it is left alone deliberately: it belongs to
the window manager, and fixing it here would be fixing it in the wrong place.

### Scientific mode

A third tab on the **same** evaluator, as the brief asked — parentheses to any
depth, `sin cos tan asin acos atan log ln sqrt cbrt abs exp`, `^`, `!`, `π`/`e`, and
a deg/rad toggle. `evaluate(expr, angleMode)` keeps its old signature and Basic-mode
expressions are a strict subset, so nothing in Basic changed; the tests pin the old
cases beside the new ones. **No `eval`, no `new Function`** — checked by grep as
well as by reading.

Three details the tests forced out:

- **`^` is right-associative.** `2^3^2` is 512; the naive shunting-yard loop that was
  already there would have produced 64.
- **Factorial cannot be folded into the number as it is read.** That was the first
  attempt and it cannot express `(2+2)!` — at the closing paren the value does not
  exist yet. It is a postfix token that goes straight to the RPN output, which also
  gives it exactly the binding it should have.
- **Function names must be matched before constants**, or the `e` in `exp` is read as
  Euler's number and the tokenizer throws on the `x`.

Domain errors say what is wrong rather than returning `NaN`: `sqrt(-1)` reads "sqrt
needs a value that is not negative", `ln(0)` "above zero", `171!` "too large".
Unclosed parentheses are closed at `=` (`sqrt(9` is a request, not a mistake) and a
dangling operator is dropped.

Scientific input is a raw expression string, not Basic's alternating token list. That
model exists to make "the number being typed" unambiguous and it cannot represent
`sin(` or a bare `(`; a scientific calculator is expression-shaped.

### Memory, tape, and what Programmer mode does not get

Memory keys (MC/MR/M+/M−, with an `M value` indicator — otherwise there is no way to
know the register is not empty) and a collapsible tape, both session-scoped as the
brief specifies. They live at the `Calculator` level so they survive a Basic ⇄
Scientific tab switch, and **Programmer mode takes neither**: it works in BigInt at a
fixed 64-bit width, and a double from the memory register would be a number that is
right in one tab and wrong in another. Measured: zero memory keys render in that tab.

The compact toolbar row is deliberate rather than a fifth keypad row — every row
added to the keypad raises the window's honest minimum height, which is the thing
this brief exists to protect.

### A probe bug worth recording

The Programmer-mode check reported "base conversion is broken", and it was not:
**Programmer mode opens in HEX**, so typing `255` and pressing HEX changes nothing.
Diagnosed by writing a unit test for `setBase`, which is how the initial base came to
light. Programmer mode now has 9 tests of its own — base conversion in all four
bases and back, AND/OR/XOR, shifts, `NOT 0` wrapping to `18446744073709551615`
rather than `-1`, and division by zero — because it is on the must-preserve list and
had none.

### Verified in a browser, against the production bundle on the real backend

```
PASS 0.1 + 0.2 reads 0.3
PASS it also says the value is rounded, and shows the exact one
PASS a chained calculation keeps full precision (0.333333333333 × 3 = 1, not 0.999999999999)
PASS the expression still shows the rounded number while evaluating the exact one
PASS M+ then MR brings the value back
PASS MC empties the register and the indicator goes with it
PASS the tape holds the recent calculations, newest first
PASS clicking a tape entry reuses its value
PASS sin(30) in degrees = 0.5
PASS 5! = 120
PASS 2^3^2 (right-associative) = 512
PASS sqrt(9) = 3
PASS parentheses over precedence = 20
PASS an unclosed parenthesis at = = 3
PASS π = 3.14159265359
PASS the RAD toggle changes the answer (sin 30 rad = -0.988031624093)
PASS a domain error says what is wrong: "sqrt needs a value that is not negative"
PASS Programmer mode still has its bases and bitwise ops
PASS the memory keys do NOT leak into Programmer mode, where a double has no meaning
PASS 255 entered in DEC still reads FF in HEX
PASS all 17 keys are inside the usable desktop at a normal size
PASS every key including = is still inside the usable desktop at 1280×577
PASS the = key is clickable there, not just visible
PASS every key is still reachable at exactly the declared minSize
page errors: none
```

Tests: frontend vitest **568 → 647** (79 new in a package that had **none**, across
the evaluator, both input reducers and the untouched programmer engine), backend
unchanged at 208 + 46. All 96 turbo tasks green. Zero new dependencies.

Out of scope and untouched: unit and currency conversion, graphing, equation solving,
a bignum library, and persisting history across windows.
