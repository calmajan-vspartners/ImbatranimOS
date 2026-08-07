# Brief 105 — One ContextMenu in the kit: the third copy triggered the promote rule

Status: **todo (ungrilled)** · From the 2026-08-07 research sweep. MEDIUM ·
`packages/ui` (new component + export) + migration of the three copies
(`file-manager`, core taskbar, core desktop). No backend, no protocol change
(`packages/ui/src/system.ts` untouched — a component is linked into the
bundle like the rest of the kit; nothing crosses postMessage). No new deps:
base-ui is already the kit's popup engine (Dialog, Select, Tooltip). Brief 106
builds its two desktop menus on this — land 105 first. Brief 129 (Tabs,
EmptyState) touches only `packages/ui/src/index.ts` in common.

## Problem

The OS has three hand-rolled right-click menus, and they already disagree:

1. `file-manager/src/components/ContextMenu.tsx:26-51` — positions raw at the
   cursor with **no edge clamping** (`:49-51`), so right-clicking a file near
   the bottom or right screen edge clips items off-screen, in the most-used
   menu in the OS. It also has no `role="menu"` (violates ui-conventions §39)
   and sits at `z-50` in-window.
2. `core/.../taskbar/TaskbarContextMenu.tsx` (brief 85) — clamps with
   hardcoded size guesses (`MENU_WIDTH = 190`, `MENU_HEIGHT = 210`, `:53-58`)
   that silently rot the moment an item is added, and always opens upward.
3. `core/.../desktop/DesktopContextMenu.tsx` (brief 96) — clamps against its
   own height estimate (`(available.length + 1) * 28 + 16`, `:59`) and a
   width constant (210) that already disagrees with its real `w-52`.

The taskbar menu's own doc comment (`TaskbarContextMenu.tsx:5-14`) justifies
staying local because it was "the second" copy and the repo promotes on the
**third** — brief 96 shipped the third. The rule has fired.

Felt divergences beyond positioning: three dismissal contracts (window
`mousedown` + scroll-capture vs document `pointerdown` vs document
`mousedown`), three shadow recipes (`shadow-md` vs `0_8px_24px` vs
`0_10px_30px`), three surfaces (`container-lowest` / `container` /
`container-low`), two danger recipes. And the keyboard contract is missing
everywhere: none of the three moves focus into the menu, none has
Arrow/Home/End — Escape is the only key any of them understands, which fails
§41 ("anything the mouse can do the keyboard must do") three times over.

## Proposed decisions (ungrilled)

- **One `ContextMenu` in `@imbatranim/ui`, items-as-data.** The item union is
  the file manager's (already the richest: `label/icon/onSelect/danger/
  disabled` + `separator`, `ContextMenu.tsx:4-13`) plus `checked?: boolean`
  (the desktop's `menuitemcheckbox` widgets) and a
  `{ type: 'custom', key, children }` escape hatch (the taskbar's workspace
  1–4 grid row). Rejected: a compound-components-only API —
  `buildMenuItems.tsx` already produces items as data, and forcing three call
  sites into JSX trees is churn without benefit.
- **Wrap base-ui's Menu primitives, don't hand-roll a fourth time**:
  controlled `open`, `Menu.Portal`, `Menu.Positioner` with a point
  `VirtualElement` anchor at the stored `{x, y}` (the `anchor` prop accepts
  one — `useAnchorPositioning.d.ts:75`). This keeps every caller's existing
  imperative shape (`{menu && <ContextMenu x y items onClose/>}`) and
  inherits the ARIA menu contract, focus management and floating-ui collision
  handling — clamping and the taskbar's flip-up stop being hand-maintained
  arithmetic. The precedent is §40's own argument: Dialog/Select/Tooltip wrap
  base-ui exactly so callers inherit this. Rejected: hand-rolling roving
  focus + collision math. Rejected: base-ui's `ContextMenu.Trigger` wrapper —
  all three call sites decide *whether* and *with what items* to open inside
  their own handlers (rows select-then-open, the desktop discriminates
  background from icons), which a trigger-element API cannot express.
- **Portal to body at one z: `z-[10000]`.** Select's `z-[1000]` would sit
  under the taskbar (`z-[9000]`, `Taskbar.tsx:97`); 10000 is what the taskbar
  menu already uses. The portal also removes the transformed-ancestor hazard:
  windows animate scale (`Window.tsx:236-238`), and a transform makes
  `position: fixed` descendants ancestor-relative — the file manager's
  in-window fixed menu lives inside that hazard today.
- **One dismissal contract**: outside `pointerdown` (the taskbar's documented
  reasoning — dismiss on the press, `TaskbarContextMenu.tsx:43-44`), Escape
  (focus returns to what had it), and any scroll (capture) — the
  file-manager behavior generalized, because a cursor-anchored menu whose
  anchor row scrolled away must not float detached. Right-click on the open
  menu is swallowed (`preventDefault` + `stopPropagation`), never re-opened.
- **One look, the kit's existing popup recipe** (`Select.tsx:69-74`):
  `bg-surface-container-lowest`, `border-outline-variant`,
  `shadow-[0_10px_28px_rgba(0,0,0,0.4)]` (§9's sanctioned popup shadow);
  highlight `bg-primary text-on-primary` (what StartMenu and both core menus
  already do); danger `text-error` at rest, `bg-error text-on-error`
  highlighted. Three shadow recipes become one.
- **The keyboard/ARIA contract is the point**: `role="menu"`,
  `menuitem`/`menuitemcheckbox` + `aria-checked`, `aria-label`, focus moves
  into the menu on open, Arrow/Home/End move, Enter activates, Escape closes
  and restores focus. Pinned by kit tests, inherited by every current and
  future caller (106's two menus, 111's menu key).
- **Not migrated: code-editor's `MenuButton`** — button-anchored menu-bar
  idiom with its own promote counter; its comment's reasoning
  (`MenuButton.tsx:18-25`) still holds.

## Fix

1. `packages/ui/src/components/ContextMenu.tsx` + exports in
   `packages/ui/src/index.ts` (`ContextMenu`, `ContextMenuItem`). Vitest in
   `packages/ui` pinning: separator/disabled/danger rendering, `checked` →
   `menuitemcheckbox` + `aria-checked`, custom row renders, roles present.
2. Migrate file-manager: delete `src/components/ContextMenu.tsx`;
   `buildMenuItems.tsx:22` imports the item type from `@imbatranim/ui`;
   `FileManager.tsx:849-851` renders the kit menu unchanged otherwise.
3. Migrate taskbar: `TaskbarContextMenu.tsx` becomes an items builder
   (Minimize; Close as danger) plus one custom workspace-grid row; delete the
   `MENU_WIDTH`/`MENU_HEIGHT` estimates — the positioner owns placement.
4. Migrate desktop: `DesktopContextMenu.tsx` builds checkbox items from
   `useAvailableWidgets`; drop the bounds clamp math; `Desktop.tsx:140-141`
   passes raw `clientX/clientY` (the portal positions in viewport space —
   today's container-relative conversion dies).
5. Grep-verify no other cursor-anchored menu remains; note the
   ui-conventions §27 rewrite (it prescribes the old pattern) for the
   done-time corpus update.

## Must preserve (regression surface)

- Every menu's item set and verbs byte-for-byte: the file manager's
  entry/background menus (right-click still selects the row it opened on,
  `FileList.tsx:120-131`), move-to-workspace with the current workspace
  disabled, widget toggles with `staggeredPosition` placement.
- The taskbar menu still opens fully visible above the bottom edge; the
  desktop menu never clips at desktop edges — now by measurement, not
  estimate.
- Right-click-for-something-else is untouched: Minesweeper's flag
  (`Minesweeper.tsx:168-171`), the Terminal's right-click paste
  (`Terminal.tsx:411-417`). The kit installs no global contextmenu listener.
- The eslint import boundary: add-ons import `@imbatranim/ui` (file-manager
  already does); `packages/ui` still imports nothing from core.
- No new dependency; `system.ts` untouched.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green. No
backend touched — no backend tests. New `packages/ui` vitest units as in
Fix 1.

**Verified in a browser** (production bundle + real backend): right-click a
file with the cursor ~20px from the bottom-right viewport corner — the menu
is fully on-screen (the old clip case); focus is inside the menu, ArrowDown/
Home/End move the highlight, Enter runs the item, Escape closes and returns
focus to the list. Taskbar-button right-click — menu fully above the taskbar,
workspace buttons reachable by keyboard. Desktop right-click — widget entries
expose `aria-checked` and toggling places a widget. An ARIA snapshot shows
`role="menu"`/`menuitem` on all three. Minesweeper flag-click and Terminal
paste-click show no menu. Console clean throughout (§14).

## Out of scope

Submenus (`buildMenuItems` has none; base-ui's `SubmenuRoot` is there when a
caller appears). `MenuButton` and the StartMenu (button-anchored). Tabs and
EmptyState (brief 129). The desktop menus' *contents* — icon menu, always-on
background menu, Change wallpaper (brief 106). Any `system.ts` member.
