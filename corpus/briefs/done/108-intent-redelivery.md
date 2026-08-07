# Brief 108 — Intent re-delivery: Archive Manager subscribes instead of consuming once

> **Outcome (2026-08-07): DONE.** `onIntent` has its first consumer. The
> consume-once effect and `startedRef` are gone; the app subscribes through a
> stable ref-indirected callback (subscribe once per handle, no re-subscribe
> churn), and `onIntent` delivering the pending launch payload on subscribe is
> what makes the StrictMode guard unnecessary. One deviation from the Fix
> list, in the repo's helper-first spirit: `normaliseIntent` moved out of the
> component into `lib/intentDelivery.ts` alongside a pure `deliveryFor(phase,
> intent)` returning run/defer/ignore, so the rule is unit-testable in node
> without mounting React (archive-manager gained its first vitest config for
> it — 6 units). Mid-extraction arrivals defer and collapse to the newest;
> everything else runs immediately after a total state reset. `flushPending()`
> is called at all three settle points (extract done, compress done, and
> `fail`). Verified: turbo 120/120 and a 10/10 Playwright pass on the
> production bundle — a.zip lists A, then b.zip switches the SAME window to B
> with A's listing gone, Extract all still completes after the switch, and a
> further delivery in the `done` phase switches back to A.

Status: **done 2026-08-07** · From the 2026-08-07 research sweep. EASY · one
add-on (`archive-manager`) — no core change, no protocol change (`onIntent`
shipped with brief 48 and has **zero consumers**; this is its first).
Interacts with brief 78 (list-and-wait) and brief 81 (`opens` declaration);
establishes the pattern briefs 107 (Clock Snooze) and 50 (bookmarks → browser
payloads) land on next.

## Problem

The shell's half of re-delivery works: `openApp` to a single-instance app
that is already open focuses the window and re-sets its intent
(`openApp.ts:47-55` — `focusWindow` + `setIntent`). The app's half does not:
`ArchiveManager.tsx:214-222` drains the intent exactly once behind
`startedRef` and never subscribes, so a re-delivered payload sits unread in
the intent map until the window closes and `windowStore.ts:454` clears it.

Archive Manager is the **only** manifest with both `multiInstance: false` and
`opens` (`archive-manager/src/index.ts:16-17`; the other four `consume()`
callers — notepad, paint, file-manager, diff — are all multi-instance, so
every open mints a fresh window and a fresh drain). So it is the one app
where a user hits this today: open zip A, then double-click zip B in Files —
the window focuses **still showing A**, and B's payload is silently dropped.
That is the exact "dead double-click reads as a broken OS" failure brief 81
was written to kill, reintroduced through the side door; 81's own outcome
records the lesson — "`opens` is a promise the app can act on the generic
payload" — and today the promise holds only for the first archive.

`system.intents.onIntent` exists precisely for this
(`createSystemHandle.ts:188-200`: pending payload delivered at once, then
every re-delivery), documented in `system.ts:171-186`. A grep across
`apps/add-ons` finds zero callers.

## Proposed decisions (ungrilled)

- **Subscribe, don't drain**: replace the consume-once effect with an
  `onIntent` subscription; every delivery goes through the existing
  `normaliseIntent` (`ArchiveManager.tsx:50-58`, unchanged) and a state reset
  before running. Rejected: teaching the file manager to close-and-reopen the
  window (fixes one caller, not the seam — and 107/50 need the seam).
- **Mid-extraction rule: defer, then latest-wins.** A payload arriving while
  `phase === 'running'` is stashed and applied when the job settles
  (done or error). Two reasons this beats a confirm-abandon dialog: there is
  **no job-cancel endpoint** (`lib/archiveApi.ts` has `startExtractJob` /
  `fetchJob` only), so "abandon" could not actually stop the backend job —
  it would only orphan a running write; and the poll loop
  (`ArchiveManager.tsx:124-154`) is a closure that keeps running regardless.
  In every other phase (idle / listing / browsing / done / error) the new
  intent wins immediately — browsing A and opening B switches. Several
  arrivals while running collapse to the newest: the intent map holds one
  slot per window (`intentStore.ts:14-20`), so a deeper queue would be
  invented state the store cannot back. Rejected: a payload queue; rejected:
  confirm-abandon.
- **The reset is explicit and total** — `listing`, `selected`, `source`,
  `outcome`, `errorText`, `percent`, `label` all return to their initial
  values before `run(intent)`. A switched-to archive must never show the
  previous archive's selection or outcome.
- **`startedRef` retires.** `onIntent` consumes the pending payload on
  subscribe, so a StrictMode remount finds nothing to double-run; the
  unsubscribe returned by `onIntent` is the effect's cleanup. Rejected:
  keeping the ref beside the subscription (two guards for one job).

## Fix

1. `ArchiveManager.tsx`: extract `deliver(raw)` — normalise; if
   `phase === 'running'`, store in a `pendingIntentRef` (overwriting any
   previous); else reset state (decision above) and `void run(intent)`.
2. Replace the `startedRef` effect (`:214-222`) with
   `useEffect(() => system.intents.onIntent(deliver), …)` returning the
   unsubscriber.
3. Where `runExtract` settles (`setPhase('done')` / `fail(...)`), check
   `pendingIntentRef` and deliver it.
4. Unit tests (add-on vitest, mocked `system`): a second generic
   `{ openPath, root }` delivery during `browsing` resets and lists the new
   archive; a delivery during `running` is deferred and runs after the poll
   resolves; two deliveries during `running` keep only the newest; a compress
   intent after a browse still runs.
5. Playwright probe (production bundle + real backend): create `a.zip` and
   `b.zip` in home; double-click `a.zip` → Archive Manager lists A's entries;
   without closing it, double-click `b.zip` → the **same window** now lists
   B's entries; Extract all still works after the switch. This is the
   open-A-then-open-B probe the backlog row names.

## Must preserve (regression surface)

- Brief 78's list-and-wait: an extract intent still lists first and waits;
  Extract selected/all, the encrypted-archive guard, and the polled progress
  UI are untouched.
- Brief 81's normalisation: the generic open payload still means **browse**
  (`action: 'extract'`, no `dest`); typed compress intents from Files still
  run immediately.
- Close cleanup: a pending intent still dies with the window
  (`windowStore.ts:454` — no change, just don't break it).
- The multi-instance `consume()` callers stay on `consume()` — correct for
  them, a fresh window per open; this brief converts nobody else.
- StrictMode: no double-started jobs, no leaked subscriptions (cleanup
  unsubscribes).
- No protocol change; `system.ts` is not edited.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green (no
backend change — no backend tests owed). The add-on unit tests in Fix 4.

**Verified in a browser**: the Fix 5 probe, with no page errors — the A→B
switch visibly happens in one window, and the extraction completion toast
still fires after the switch.

## Out of scope

A job-cancel endpoint (would unlock confirm-abandon later; separate
decision); converting notepad/paint/file-manager/diff (multi-instance,
correct as-is); Clock and bookmarks adoption (briefs 107 and 50); a
multi-payload intent queue in core; any change to `openApp` or the intent
store.
