# Brief 89 — Media Player: a transport that behaves like VLC

Status: **todo (user-requested 2026-08-02)** · MEDIUM ·
add-on `apps/add-ons/media-player`. Standalone. Supersedes the transport half of
brief 68; **68 keeps** the queue/persistence/codec-error work.

## Problem

The player streams correctly (HTTP Range, no buffering) but the transport is
minimal. The user asked specifically for ±5s skip and a VLC-grade timebar. Today
there is no skip control at all, and the seek bar is a plain input with no hover
preview, no buffered indication, and no keyboard control.

## Decisions

- **Skip buttons and keys**: ±5s as asked, plus ±10s on the arrow keys and ±60s
  on the shifted arrows — VLC's own tiering, so muscle memory transfers.
- **Timebar**: scrub with the pointer, a hover tooltip showing the time under the
  cursor, and a buffered range drawn behind the played range (from
  `HTMLMediaElement.buffered`, already available and currently unused).
- **Keyboard set**, VLC-shaped: Space play/pause · ← → ±10s · Shift+← → ±60s ·
  ↑ ↓ volume · M mute · F fullscreen · `[` `]` speed down/up. Scoped to the top
  window through the existing hotkey guard, and registered in the brief-86
  registry so they appear in the `?` overlay.
- **Playback speed** 0.25×–4× with a reset, since it is the VLC feature people
  actually use daily.
- **Time display shows current / total**, with hours only when the media is long
  enough — `1:04:07` for a film, `3:12` for a track.
- **Rejected — VLC's filters, equaliser, and subtitle-delay tuning.** Those need
  an audio graph and a rendering pipeline this app does not have, for a single
  user watching a file. Subtitle *loading* stays in brief 68.
- **Rejected — transcoding unsupported codecs.** Restated from brief 68: ffmpeg
  in the image is a large dependency and real CPU cost. Report the codec clearly
  instead.

## Fix

1. `TransportBar.tsx`: skip-back/skip-forward buttons around play/pause; speed
   control; current/total time.
2. `Timebar.tsx`: pointer scrub (pointerdown/move/up so a drag keeps tracking
   outside the element), hover tooltip, buffered ranges behind the progress fill,
   `role="slider"` with `aria-valuenow`/`aria-valuetext` so it is keyboard- and
   screen-reader-usable.
3. `useMediaHotkeys(windowId, el)` registering the set above through
   `useRegisteredHotkeys`.
4. Guard every seek: clamp to `[0, duration]`, ignore while `duration` is `NaN`
   (metadata not yet loaded), and no-op on a live/unseekable stream.

## Must preserve (regression surface)

- Range-streamed seeking (the 2026-07-19 backend fix + its 3 e2e tests).
- Remount-per-track — no element or listener leaks across the queue.
- Playback continues while the window is unfocused; only closing stops it.
- Zero new dependencies.
- Keys must not fire while the user is typing elsewhere, and must not steal keys
  from another window.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. Unit tests for the
seek clamp (before 0, past duration, NaN duration) and the time formatter
(seconds, minutes, hours).

**Verified in a browser**: play a real file; ±5s buttons move exactly 5s; drag
the timebar and release outside it; hover shows the time under the cursor;
buffered range is visible; every keyboard shortcut works and appears in `?`.

## Out of scope

Filters, equaliser, subtitle-delay tuning, transcoding, playlists as files,
casting, and the queue/persistence work that stays in brief 68.
