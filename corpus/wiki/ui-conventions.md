---
summary: The house UI style as enforceable rules, derived from the code 2026-07-31 — import rule and core export surface, the real token/accent names, type + density scale, in-window layout (incl. the unclamped-defaultSize trap), the one canonical answer for confirm/prompt/toast/empty/loading/context-menu/hotkey/save-spine, icon sizing, the accessibility floor, the anti-patterns to copy around, and a 14-item pre-flight checklist.
updated: 2026-07-31
---

# ImbatranimOS UI conventions — the house style, as rules

Derived by reading the code, 2026-07-31. Identity is **locked**: Win7-classic layout, B&W tokens + ONE accent (crimson), dark-first, zero border radius. Implement inside it.

**Copy `apps/add-ons/clock`** — the best-behaved app: pure core kit, correct tokens, honest `minSize`, `notify()` for async events. `file-manager` is the richest but violates §8. `sticky-notes` is inherited and is NOT a template.

## 1. The import rule

1. Import **only** `@imbatranim/core`, `lucide-react`, `react`, `@tanstack/react-query`, and your own declared deps. `apps/add-ons/calculator/eslint.config.js:32-50` blocks
   `@imbatranim/core/*` deep paths, sibling add-ons, and `../../core/*` escapes.
2. Never re-implement anything on the surface (`apps/core/src/index.ts:11-64`): types `AppConfig`/`AddonManifest`/`CommandSource`/`CommandItem`; plumbing `api`, `queryClient`,
   `cn`; kit `Button`, `Checkbox`, `Dialog`, `Input`, `ScrollArea`, `Select`, `Separator`, `Tooltip`, `ConfirmDialog`/`useConfirm`, `PromptDialog`/`usePrompt`; shell
   `openApp`, `useIntentStore`, `useWindowStore`; `notify`, `useNotificationStore`; files `fetchFileBytes`, `uploadFileBytes`, `UploadTooLargeError`, `downloadUrl`,
   `fileName`; spine `createOpenedFileStore`, `useOpenIntent`, `useSaveHotkey`, `useUnsavedGuard`, `useVirtualList`.
3. One import statement per specifier: `import { Button, Input, cn } from '@imbatranim/core'` (`calculator/src/BasicPad.tsx:2` right; `file-manager/src/FileManager.tsx:12-19`
   wrong — nine statements, same specifier).
4. **Missing from the kit** — propose adding to core, don't grow a private copy: a shared **ContextMenu** (sole copy `file-manager/src/components/ContextMenu.tsx`, whose own
   doc comment at :23 admits it is unstyled); **Tabs** (hand-rolled 3×: `calculator/src/Calculator.tsx:31-52`, `clock/src/Clock.tsx:67-81`,
   `markdown-editor/src/MarkdownEditor.tsx:129-147`); an **EmptyState**; a **file-open picker** (every viewer just says "Open a file from Files", `MarkdownEditor.tsx:104`); a
   **top-window keydown hook** (`calculator/src/hooks/useTopWindowKeydown.ts:16` duplicates the private `isTopWindow` in `apps/core/src/shared/hooks/useSaveHotkey.ts:5`); a
   `Tooltip` that can render as a non-button (§8).

## 2. Tokens and colour

5. Only semantic token classes. Real names, `apps/core/src/index.css:15-58` — surfaces `surface`, `surface-dim`, `surface-bright`,
   `surface-container-lowest`/`-low`/`surface-container`/`-high`/`-highest`; text `on-surface` (primary), `on-surface-variant` (muted), `inverse-surface`/`inverse-on-surface`
   (tooltips); borders `outline-variant` (default hairline) and `outline` (stronger); accent `primary` + `on-primary`, `primary-container` + `on-primary-container`; `error`,
   `on-error`, `error-container`, `on-error-container`. As utilities: `bg-surface-container-low`, `text-on-surface-variant`, `border-outline-variant`, `bg-primary text-on-primary`.
6. **The accent is a runtime CSS var, never a literal.** `--accent`/`--accent-on` are stamped on `<html>` by `applyAppearance()`
   (`apps/core/src/shared/store/appearanceStore.ts:53-55`), and `--color-primary` maps to `var(--accent)` (`index.css:37`). So `bg-primary` tracks the user's accent choice; a
   hex does not. Four presets (`appearanceStore.ts:20-25`), crimson default (:27).
7. **Dark is the shipped default** (`appearanceStore.ts:28`, `index.css:79-100`). Light is the same token names swapped under `:root[data-theme='light']` (`index.css:103-123`)
   — tokens alone buy you light mode. Never add a `dark:` variant; never test only in dark.
8. Forbidden: hex (`repl-interpreter/src/Terminal.tsx:117` `bg-[#0d0d0e]` violates), Tailwind palette colours (`bg-red-500`, `text-slate-400`), gradients, and `rounded-*` —
   `index.css:126` forces `* { border-radius: 0 !important }`, so radius classes are dead code.
9. **Shadows only on floating layers**, and only the existing recipes: dialog `shadow-[0_24px_60px_rgba(0,0,0,0.55)]` (`ui/Dialog.tsx:33`), popup
   `shadow-[0_10px_28px_rgba(0,0,0,0.4)]` (`ui/Select.tsx:53`), toast `shadow-[0_6px_24px_rgba(0,0,0,0.35)]` (`notifications/ToastHost.tsx:27`). In-window content is flat —
   separation is a 1px `border-outline-variant` plus a surface-container step.
10. Never invent a colour to mean a state. Levels are told apart by **icon shape**; only `error` gets colour (`notifications/levelStyle.ts:11-18`). Success is `text-primary`,
    not green.

## 3. Typography and spacing

11. `font-ui` = Space Grotesk (chrome, labels, numbers); `font-content` = Inter (user-authored prose); `font-mono` for code panes (`MarkdownEditor.tsx:179`). Declared at
    `index.css:61-62`.
12. Root is **13px** (`index.css:141`); the scale is explicit arbitrary sizes — `text-[11px]` labels/meta/status bars/toolbars/tabs · `text-[12px]` buttons/list rows/menu
    items/dialog titles · `text-[13px]` body, inputs, checkbox labels · `text-[10px]`/`text-[9px]` shell chrome only (`taskbar/StartMenu.tsx:103,132`). Larger type only for a
    real display value: `text-3xl` calculator readout (`calculator/src/BasicPad.tsx:106`), `text-[36px]` timer (`clock/src/tabs/Timer.tsx:36`), both with `tabular-nums`.
13. Weights: `font-medium` for controls, `font-semibold` for titles/labels, `font-bold` only in the taskbar brand (`taskbar/Taskbar.tsx:78`). Never `font-light`.
14. The house field label is `font-ui text-on-surface-variant text-[11px] font-semibold tracking-wider uppercase` (`ui/Input.tsx:15`, `ui/Select.tsx:30`,
    `modules/settings/Settings.tsx:66`).
15. **Compact density.** Toolbar `px-2 py-1` + `gap-1` (`FileManager.tsx:325`); status bar `px-2 py-0.5` (:524); list row `px-2 py-1` (`FileList.tsx:163`); menu item `px-3 py-1` (`ContextMenu.tsx:65`); dialog body `p-3` (`ui/Dialog.tsx:48`); icon-only button `className="h-5 w-5 p-0"` (`FileManager.tsx:398`). Gaps are `gap-0.5/1/2/3`;
    `mb-3`/`mb-4` inside dialogs. `p-6`+ belongs to Settings-style full pages (`Settings.tsx:83`), not to an app toolbar.

## 4. Layout inside a window

16. Core hands you a flex column whose body is `min-h-0 flex-1` (`window/Window.tsx:316`), so your root is always `<div className="bg-surface-container-lowest flex h-full flex-col">` (`FileManager.tsx:323`, `clock/src/Clock.tsx:62`, `calculator/src/Calculator.tsx:29`). `h-full` — never `h-screen`, never `100vh`
    (`snipping-tool/src/components/AnnotationStage.tsx:415` uses `calc(100vh - 140px)`: wrong, the window is not the viewport).
17. Chrome order is toolbar → optional breadcrumb/tabs → body → status bar. Toolbar: `border-outline-variant bg-surface-container-low flex items-center gap-1 border-b px-2 py-1`. Status bar: the same with `border-t px-2 py-0.5` and `text-[11px]`. Both `shrink-0`/`flex-none`; only the body flexes.
18. Every intermediate flex wrapper needs `min-h-0` (plus `min-w-0` horizontally) or the body pushes past the window and clips controls (`FileManager.tsx:445`,
    `MarkdownEditor.tsx:163,174`).
19. **Scroll containment**: `ScrollArea` goes inside the flexed body, never around the whole app — `<ScrollArea className="h-full w-full" viewportRef={ref}>`
    (`FileManager.tsx:460`). Virtualizing? pass `viewportRef` and feed it to `useVirtualList({ getScrollElement: () => viewportRef.current })` (`FileManager.tsx:292,306-311`);
    never query base-ui's internal DOM. Prefer `ScrollArea` to raw `overflow-y-auto` — 17 add-on files still use the raw version and get the browser scrollbar instead of the
    themed one.
20. **Content must survive a short window.** `apps/core/src/shared/store/windowStore.ts:211` sets `size` from `defaultSize` **verbatim, with no viewport clamp**, and the
    taskbar eats 44px (`windowStore.ts:27`, `taskbar/Taskbar.tsx:11`). Therefore: (a) `defaultSize.height` must fit a 720px-tall viewport with room to spare — ≤620 is safe,
    `code-editor` 680 and `norpdf` 720 are already too tall; (b) `minSize` must be **honest** — the measured smallest height at which every control is still reachable, not a
    round number, and you must test at exactly `minSize`; (c) never put a control in a `flex-none` block *below* an unbounded `flex-1` block, because the primary action must
    survive first — Calculator's keypad is `flex-none` under a `flex-1` display (`BasicPad.tsx:103,115`), which is why `0 . =` vanishes; (d) never rely on window-level
    scrolling to reach a button.

## 5. Interaction patterns — the one canonical answer each

21. **Confirm** → `useConfirm()`: `const { confirm, confirmDialog } = useConfirm()`, `await confirm({ title, message, destructive: true })`, render `{confirmDialog}`
    (`ui/ConfirmDialog.tsx:68-114`; use at `sticky-notes/src/StickyNotes.tsx:122-134`). Never a bespoke `<Dialog>` + two buttons; never `window.confirm`.
22. **Text prompt** → `usePrompt()` — resolves the trimmed string or `null`, Enter confirms, empty disables confirm (`ui/PromptDialog.tsx:202-250`; use at
    `notepad/src/components/FileBrowser.tsx:24,147`).
23. **Toast / error / async completion** → `notify({ title, body?, appId, level })`, level `info|success|warning|error`
    (`apps/core/src/shared/store/notificationStore.ts:122`). Errors are sticky, others auto-dismiss at 6s (`ToastHost.tsx:10,16`). Always pass `appId` so the item gets your
    icon and click-to-open (`clock/src/useClockNotifications.ts`). A `console.error` is never a user-facing signal (`sticky-notes/src/StickyNotes.tsx:142` fails this). An
    inline banner is acceptable only for errors bound to the visible view (`FileManager.tsx:430-442`); a toast is the default.
24. **Destructive action** → `variant="destructive"` (`ui/Button.tsx:24-27`) **and** `destructive: true` on the confirm. Both, always.
25. **Empty state** → centred column, one big thin glyph, one 12px line — `<div className="text-on-surface-variant flex flex-col items-center justify-center gap-2 py-12"><Folder size={32} strokeWidth={1} /><span className="font-ui text-[12px]">Empty folder</span></div>` (`file-manager/src/components/FileList.tsx:105-112`; 40/1
    variant at `docs/src/Docs.tsx:146`). Say what is empty; do not apologise.
26. **Loading** → centred `text-on-surface-variant font-ui text-[12px]` "Loading…", plus `<Loader2 size={16} className="animate-spin" />` when the wait can exceed ~1s
    (`MarkdownEditor.tsx:165-167`; text-only at `FileManager.tsx:462`). An in-place refresh spins the existing icon instead: `<RefreshCw className={cn(isFetching && 'animate-spin')} />` (`FileManager.tsx:411`). No skeleton shimmers.
27. **Context menu** → `onContextMenu={e => { e.preventDefault(); … }}`, store `{x: e.clientX, y: e.clientY}`, render a cursor-anchored `fixed` panel that closes on outside
    mousedown / Escape / scroll (`ContextMenu.tsx:29-44`). Build items as data with a `separator` type and a `danger` flag (`file-manager/src/lib/buildMenuItems.tsx`);
    right-click must also select the row it opened on (`FileList.tsx:150-155`).
28. **Keyboard shortcut** → scope it to the top-most window or two instances fight over keystrokes. Ctrl/⌘+S is `useSaveHotkey(windowId, onSave)`
    (`hooks/useSaveHotkey.ts:16`); other keys follow the capture-phase + `isTopWindow` guard in `calculator/src/hooks/useTopWindowKeydown.ts:16`. Never bind a bare `window`
    keydown.
29. **Dirty / unsaved** → `useUnsavedGuard(windowId, dirty, name)` (`hooks/useUnsavedGuard.ts:47`) appends ` •` to the window + taskbar title and registers a close guard.
    Mirror it in your toolbar as `{name}{dirty ? ' •' : ''}` at `text-[11px] text-on-surface-variant` (`MarkdownEditor.tsx:156-159`).
30. **File/save spine**, in this order (`markdown-editor/src/MarkdownEditor.tsx:25-99`): `const source = useOpenIntent(windowId)` → `const name = source ? fileName(source.path, 'untitled.md') : ''` → `await fetchFileBytes(source.root, source.path)` → `await uploadFileBytes(source.root, source.path, out, name)` (catch
    `UploadTooLargeError`) → `useSaveHotkey(windowId, handleSave)` + `useUnsavedGuard(windowId, dirty, name)`. `downloadUrl()` is unauthed by design, only for a real `<a download>` (`lib/fileBytes.ts:75`); every in-app byte read goes through `fetchFileBytes` (:21). Per-window state → `createOpenedFileStore()`. Cross-app handoff →
    `openApp(appId, { openPath, root })` (`FileManager.tsx:159`).
31. **Form** → `Input` with the `label` prop (renders the house label and wires `htmlFor` to your `id`; `ui/Input.tsx:9-19`); `Select` with `options={[{value,label}]} value onValueChange placeholder` (`clock/src/tabs/ClockTab.tsx:23-29`); `Checkbox` with `label`. Actions right-aligned in `<div className="flex justify-end gap-2">`, Cancel
    `variant="default"` first, then primary/destructive, disabled while invalid or pending (`FileManager.tsx:553-565`).

## 6. Icons

32. `lucide-react` only — no hand-written SVG (`ui/Checkbox.tsx:25-27` is the one sanctioned existing exception), no icon fonts, no emoji as UI.
33. Size by context: **11–12** in buttons/rows/tabs (`FileManager.tsx:348`, `FileList.tsx:197`, `Clock.tsx:36`) · **13** window controls (`window/Window.tsx:297`) · **14–16**
    menus and toasts (`StartMenu.tsx:119`, `ToastHost.tsx:32`) · **18–22** section headers and desktop icons (`Settings.tsx:57`, `DesktopIcon.tsx:68`) · **32–40** empty
    states. `strokeWidth`: `2` on controls, `1.75` in shell chrome, `1.5` on file-type glyphs, `1` on empty-state glyphs.
34. The manifest icon is a lucide **component reference**, typed `ComponentType<{size?, strokeWidth?, className?}>` (`contract.ts:15`). Pick the most literal glyph and alias
    on collision (`import { Calculator as CalculatorIcon }`, `calculator/src/index.ts:2`). No baked-in size or colour — core renders it at several sizes.

## 7. Accessibility floor (minimum, not aspiration)

35. Everything clickable is a real `<button type="button">`, an `<a>`, or a kit component. A `<div onClick>` row is a defect (`sticky-notes/src/StickyNotes.tsx:204-206`). If a
    row must be a `<tr>`/`<div>`, give it `tabIndex`, a key handler, and a `role`.
36. Focus must be visible, as a ring not an outline: `outline-none focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset` (`ui/Select.tsx:39`,
    `StartMenu.tsx:117`, `Settings.tsx:106`). `Button` ships it per variant (`ui/Button.tsx:17,21,27`) — do not `className`-override it away.
37. Icon-only controls need an accessible name: `aria-label` (`ToastHost.tsx:44`, `Settings.tsx:131`) or a `Tooltip`, plus `title` when it is also a mouse affordance
    (`window/Window.tsx:296`). Never ship a bare glyph button.
38. Toggles carry `aria-pressed` (`MarkdownEditor.tsx:135`, `Settings.tsx:132`); grouped toggles get `role="group"` (`MarkdownEditor.tsx:129`).
39. Lists and menus carry roles: `role="listbox"`/`option`/`aria-selected` (`CommandPalette.tsx:183,199-200`), `role="menu"`/`menuitem`/`aria-label`
    (`StartMenu.tsx:61-62,87`); virtualizer spacer rows get `aria-hidden` (`FileList.tsx:127,247`).
40. Dialogs: use core `Dialog` so you inherit base-ui's focus trap, Escape, and backdrop dismissal (`ui/Dialog.tsx:25-37`), and `autoFocus` the first field
    (`ui/PromptDialog.tsx:163`). Never portal your own modal.
41. Anything the mouse can do the keyboard must do — Enter opens, arrows move, Escape cancels (`file-manager/src/hooks/useListKeyboardNav.ts`). Never encode meaning in colour
    alone (§10). Keep the pairs: `text-on-primary` on `bg-primary`.

## 8. Anti-patterns in the code today — copy around these

42. **`<Tooltip>` around a `<Button>` emits `<button>` inside `<button>`.** `ui/Tooltip.tsx:15` renders `BaseTooltip.Trigger` with no `render` prop, and base-ui defaults that
    trigger to a `button` (`node_modules/@base-ui/react/tooltip/trigger/TooltipTrigger.js:220`). `file-manager/src/components/FileList.tsx:190-240` does it five times per row,
    plus `FileManager.tsx:414` and `MarkdownEditor.tsx:116,131`. This is the source of the walkthrough's console errors — invalid HTML, and the inner button can swallow
    clicks. **Until core's `Tooltip` forwards `render`, use `title=` on an icon-only `Button`.** Add no new `Tooltip`-around-`Button` sites.
43. **`useUnsavedGuard` uses the native `window.confirm`** (`hooks/useUnsavedGuard.ts:65`), so the one dialog every editor shows is the only unthemed dialog in the OS;
    `code-editor/src/CodeEditor.tsx:250` repeats the native call directly. Do not add a third — use `useConfirm` in new code.
44. **`file-manager` hand-rolls what core exports**: a bespoke delete confirm (`FileManager.tsx:569-596`) instead of `useConfirm`, and a custom error banner whose comment at
    :104 still claims "no toast system here" though `notify()` shipped in brief 34. Copy its *layout* (toolbar / body / status bar), not its dialogs.
45. **`sticky-notes` is off-style**: `<div onClick>` rows (`StickyNotes.tsx:204-206`), raw `overflow-y-auto` instead of `ScrollArea` (:172), `console.error` as the only
    failure signal (:142), and a raw `<button>` where a ghost `Button` belongs (:212-219). It does use `useConfirm` (:122) — that part is fine. Not a template.
46. Literal colour: `repl-interpreter/src/Terminal.tsx:117`, `norpdf/src/editor/SignatureDialog.tsx:186`. Dead radius classes: `code-editor/src/CodeEditor.tsx:345,350`,
    `norpdf/src/editor/AnnotateToolbar.tsx:109,157`. `TASKBAR_HEIGHT = 44` is declared twice (`windowStore.ts:27`, `taskbar/Taskbar.tsx:11`) and is not exported to add-ons —
    do not add a third copy; size with `h-full`.

## 9. Pre-flight checklist — all fourteen must be "yes"

1. Does the add-on import **only** `@imbatranim/core` + `lucide-react` + its declared deps, with no deep path into core?
2. Did I reuse every applicable core export (`Button`, `Input`, `Select`, `Checkbox`, `Dialog`, `ScrollArea`, `useConfirm`, `usePrompt`, `notify`, `useVirtualList`) instead of
   hand-rolling one?
3. Are **all** colours semantic token classes — zero hex, zero Tailwind palette colours, zero gradients, zero `dark:` variants, zero `rounded-*`?
4. Does the accent appear only via `primary`/`on-primary`/`primary-container`, so switching accent in Settings restyles it with no code change?
5. Did I open it in **light** theme and confirm nothing is invisible or unreadable?
6. Is type inside the 11/12/13px scale, `font-ui` for chrome and `font-content` for user prose, at toolbar density (`px-2 py-1`, `gap-1`)?
7. Is the root `flex h-full flex-col` with `min-h-0` on every flexed wrapper, and no `h-screen`/`100vh` anywhere?
8. Does scrolling happen inside a `ScrollArea` in the body — never on the window itself — with `viewportRef` wired if the list is virtualized?
9. At exactly `minSize`, is **every** control still visible and clickable without resizing, and does `defaultSize.height` fit a 720px-tall viewport minus the 44px taskbar?
10. Is every destructive action both `variant="destructive"` and gated by `confirm({ destructive: true })`?
11. Do async successes and failures reach the user through `notify({ …, appId })` rather than only a console log or a silent no-op?
12. Can I complete every task keyboard-only — tab to each control, visible `focus-visible` ring, Enter/Escape working, no `<div onClick>` as the only path?
13. Does every icon-only button have an `aria-label` or `title`, and does every list/menu/tree carry its `role` + `aria-selected`/`aria-label`?
14. Does the console stay **clean** on mount, interaction, and unmount — in particular no nested-`<button>` warning (§42) — and are `turbo typecheck`, lint, format, and `turbo build` green?
