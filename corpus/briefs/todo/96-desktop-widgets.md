# Brief 96 — Desktop widgets (the second consumer of `desktopLayer`)

Status: **todo (ungrilled)** · From the 2026-08-06 feature exploration
([wiki page](../../wiki/feature-exploration-2026-08-06.md)). MEDIUM · CORE
(widget host) + small widget implementations. Wants brief 49 (durable
dotfiles) for placement persistence; check interaction with brief 85
(workspaces) before building — both touch the desktop layer.

## Problem

Brief 74 built a real seam — `desktopLayer` on `AppConfig`, an app painting
between the icon grid and the windows, with a tested clamp and
persist-on-release drag — and exactly one thing uses it (sticky notes). Every
comparable web desktop puts glanceable state on the desktop, CasaOS/Umbrel's
most-loved surface is the at-a-glance dashboard, and the Win7 identity had a
name for this: gadgets. The OS has the data (clock, `/api/system/stats`,
calendar/todo tables) and the seam; it lacks only the host.

## Proposed decisions (ungrilled)

- **Core owns a widget host layer; widgets are declared, not free-painted.**
  A `widgets?: WidgetConfig[]` field on `AppConfig` ({id, name, component,
  defaultSize}) rendered by a core host that owns placement, drag, clamp and
  persistence — reusing the sticky-notes patterns (clamp module,
  `setPointerCapture`, persist once on release) rather than each widget
  reimplementing them. Sticky notes keep their bespoke layer (grill: migrate
  them onto the host later; not this brief).
- **v1 widget set, all reading existing surfaces**: analog/digital clock
  (Clock add-on), today's agenda (calendar events + due todos), system
  sparkline (CPU/RAM from `/api/system/stats`, reusing brief 58's ring-buffer
  pattern). Three is enough to prove the seam is generic.
- **Add/remove via desktop context menu** ("Add widget →") and a Settings
  list; off by default — the desktop ships clean.
- **Placement persists durably**: per brief 49's direction this is user
  config (a dotfile/prefs row), not session state. If 49 hasn't landed,
  localStorage with the same key shape the 49 migration will sweep.
- **Widgets are not windows**: no taskbar presence, no focus, no z-order
  among windows; they live below every window, above the icon grid, and
  never steal clicks outside their bounds (the pointer-events discipline the
  layer already established).
- **Budget**: a widget that polls does so at the tray's existing cadence or
  slower; no widget may hold a WebSocket.

## Fix

1. Core: widget host in `components/desktop/`, contract field, registry
   filter honoring disabled add-ons (a disabled app's widgets vanish too).
2. The three v1 widgets in their owning add-ons (clock, calendar, system
   -monitor packages) — core imports nothing from add-ons, same as apps.
3. Context menu + Settings section; persistence per above.
4. Unit tests: clamp reuse, add/remove, disabled-addon filtering.

## Must preserve (regression surface)

- Sticky notes' desktop behaviour untouched.
- Icon grid click/drag/marquee territory unaffected outside widget bounds.
- Window snap/drag unaffected (widgets never capture those pointers).
- Eager bundle unchanged: widget components lazy-load with their add-on.

## Verify bar

`turbo` gates green; store/clamp tests. **Verified in a browser**: add all
three widgets, drag each, reload — positions survive; disable the clock
add-on — its widget disappears; windows drag/snap over widgets normally;
1280×577 and a large viewport both clamp sanely.

## Out of scope

Third-party widgets (that is the install-from-GitHub story), a widget
gallery/marketplace, per-workspace widget sets, and migrating sticky notes
onto the host.
