# Brief 68 — Media Player: remember the queue, name the codec, keep the volume

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
EASY/MEDIUM · add-on `apps/add-ons/media-player` (651 LOC, zero non-core deps).
Depends on brief 54 for Open.

## Problem

The foundation is right: native `<audio>`/`<video>` range-streamed through
`downloadUrl` (the backend gained HTTP Range in the 2026-07-19 QA pass so
seeking works), a custom transport, a folder queue with auto-advance, and a
remount per track so nothing leaks. Zero dependencies. The gaps are the ones you
hit in the first five minutes:

1. **Nothing persists.** Volume, mute, and playback rate reset every time a
   window opens, and the queue dies with the window. Setting the volume on every
   single track is the most-repeated annoyance in the app.
2. **No shuffle or repeat.** A folder queue without repeat-one/repeat-all/shuffle
   is a playlist that only goes forwards.
3. **An unplayable codec is a black box.** The browser silently refuses media it
   cannot decode. Nothing inspects `error.code` on the media element, so the user
   gets a dead player with no message — indistinguishable from a broken app.
   This matters more here than elsewhere because the container will happily serve
   an `.mkv`/`.flac` the browser may not decode.
4. **No metadata.** No title/artist/album from tags, no album art, no duration
   in the queue — tracks are filenames.
5. **No subtitles.** Video has no `<track>` support, so a sidecar `.vtt`/`.srt`
   next to the file is ignored.
6. **No resume.** Reopening a long video restarts it.
7. **Closing the window stops playback**, which is arguably correct (the window
   *is* the player) but is never stated, and there is no background/mini mode.

## Proposed decisions (ungrilled)

- **Persist volume, mute and rate** as user preferences, not session state — they
  belong with brief 49's durable dotfiles rather than in a per-tab session, since
  "my volume" should follow the account.
- **Shuffle + repeat (off / one / all)** on the existing folder queue.
- **Read `MediaError` and say what happened**, mapping `MEDIA_ERR_DECODE` and
  `MEDIA_ERR_SRC_NOT_SUPPORTED` to a plain message naming the file and, where
  known, the likely codec — plus a `notify()`. Do not pretend it might still work.
- **Metadata via the browser only.** Duration comes free from the element; for
  tags, prefer nothing over a tag-parsing dependency. If tags are wanted later,
  weigh a small parser explicitly against "lightweight is identity" — do not
  smuggle one in here.
- **Subtitles: auto-attach a sidecar file** with the same basename
  (`.vtt` directly; `.srt` needs a small in-app conversion, which is a
  well-understood ~30-line transform and acceptable without a dependency).
- **Resume position per file**, stored with the durable prefs, with a "start
  over" affordance. Only for items past a threshold (say 60s) so short clips do
  not accumulate state.
- **Rejected — background playback after the window closes.** It would mean an
  audio element outliving its window, which contradicts the compositor model
  (the window is the app). A future mini-player is a compositor feature, not a
  hack here.
- **Rejected — transcoding on the backend.** ffmpeg in the image is a large
  dependency and real CPU cost, against the slim-image identity. Naming the
  codec problem clearly is the honest answer.
- **Rejected — Picture-in-Picture.** It escapes the OS's own window into browser
  chrome, which breaks the illusion the project is built on.

## Fix

1. Preferences slice for volume/mute/rate/repeat/shuffle + per-file resume,
   written through whatever brief 49 establishes (until then, the existing
   persisted-store pattern), applied on mount before playback.
2. Shuffle/repeat controls in the transport; queue order derived, not mutated,
   so the underlying folder order is preserved.
3. `onError` handler reading `mediaEl.error.code` → mapped message + `notify()`
   + a visible empty/error state naming the file.
4. Sidecar subtitle detection via the folder listing already fetched for the
   queue; attach as `<track>`; convert `.srt` in-app.
5. Show duration in the queue once known; keep filenames as the title.

## Must preserve (regression surface)

- Range-streamed playback and seeking (the 2026-07-19 backend fix + its 3 e2e
  tests) keep working — do not switch to fetching whole files.
- Remount-per-track stays, so no element or listener leaks across the queue.
- All 8 audio + 6 video registered extensions still route here.
- Zero new dependencies.
- Audio keeps playing while the window is merely unfocused or behind others;
  only closing stops it.

## Verify bar

`turbo typecheck`, add-on lint + format green, `turbo build` ok. Unit tests for
the `MediaError` mapping and the `.srt` → `.vtt` conversion.

**Verified in a browser**: set volume, close and reopen, confirm it persisted;
play a folder with repeat-all and shuffle; seek a large video and confirm range
requests; open a file the browser cannot decode and read a real message; drop a
`.srt` beside a video and see subtitles; leave a video half-watched and confirm
it offers to resume.

## Out of scope

Transcoding, a media library/database, background playback, PiP, casting,
equaliser, and playlist file formats (`.m3u`).
