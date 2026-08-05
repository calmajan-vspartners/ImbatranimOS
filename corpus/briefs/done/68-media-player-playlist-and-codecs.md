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

---

## Outcome — 2026-08-05

Done. Six of the seven problems were real; the seventh (the codec black box) had
been **half-fixed already** by the work around brief 89, which the brief predates.

### What the brief thought was missing and was not

`describeMediaError` + an error overlay + a "Download instead" button already
existed: an undecodable file was not a *silent* black box. What was genuinely
missing is smaller and still worth having, and all of it is now in:

- **The file is named.** The queue auto-advances, so "this browser can't play this
  file format" was about an unidentified one of twelve tracks.
- **A container hint**, for `.mkv` / `.mp4` / `.mov` / `.flac` — deliberately about
  the *container*, not a claim about the codec, because nothing here parses the file
  and "this is HEVC" without looking would be a guess dressed as a diagnosis.
- **A `notify()`**, because a queued track can fail while the window is behind
  others, which is the dead-player-with-no-message state all over again.
- **Tests.** `transport.test.ts` covered `clampSeek` and nothing else; the error
  mapping the brief's verify bar asks for had none.

Deliberately **not** done: skipping a failed track and carrying on down the queue.
VLC does it, and here it would undo the entire point of this item — the diagnosis
becomes invisible again. The brief's own words: "Do not pretend it might still
work."

### Two bugs the brief did not know about

**The Open dialog offered formats the app rejects.** Its extension list was
hand-written and had drifted from `mediaKind`: it offered `avi` and `weba`, so
picking one landed on "Unsupported file type" — a dead end reached *through the
app's own dialog* — and it omitted `oga` and `ogv`, which do play. The list is now
derived from the same constants the routing uses.

**Icon-only transport buttons had no accessible name.** Prev, Next, Play/Pause and
Mute carried a `<Tooltip>` and nothing else; a tooltip is not an accessible name
and never reaches a screen reader. Found the honest way: the probe could not
address them.

And the brief understated item 1 — the playback **rate reset on every track
change**, not merely on every new window, because `TrackStage` remounts per track
by design.

### Subtitles: why there is no `<track>` element

The obvious implementation cannot work here, and both reasons were measured
against the production build rather than reasoned about:

1. `GET /files/download` serves `application/octet-stream`, and a text track is
   only parsed as `text/vtt`.
2. The usual fix — convert to a `Blob` and point at a `blob:` URL — is refused by
   the shipped CSP. There is no `media-src` directive, so `<track>` falls back to
   `default-src 'self'`, which does not include `blob:`.

So the sidecar is fetched through the authed api as text, parsed here, and pushed
into a `TextTrack` via `addTextTrack` + `VTTCue`. **No new route, no dependency,
and no CSP relaxation** — the last of those matters, because widening the policy
is human-gated in this project (SEC-9/SEC-10). One parser handles WebVTT and
SubRip, which the brief anticipated as "a well-understood ~30-line transform": the
formats differ in the `WEBVTT` header, a comma instead of a dot, and the cue
counter, and handling all three is less code than two parsers.

Verified in pixels, not by asking the API: `activeCues` stays populated when a
track's mode is `hidden`, so "are subtitles actually painted?" was answered by
screenshotting the video frame with them on and off and comparing bytes.

### Three design errors the browser caught

- **Shuffle pinned the playing track to the front** so that turning shuffle on
  would not "jump away" from it. That sounds right and is wrong: the order is then
  re-derived on every track change, so walking Next re-permutes the queue and
  revisits tracks. Measured on a three-track folder: it played **b, c, b**. The pin
  is gone; the order depends only on the paths and the seed, and a full cycle now
  provably returns to where it started.
- **Repeat-one did nothing.** The parent resolved "next" to the track already
  playing and re-selected it — which changes no state, so nothing remounted and the
  track simply stopped. Replaying belongs on the element (it also avoids re-fetching
  what is already buffered), so `TrackStage` does it.
- **Repeat-one disabled the Next button** on the last track. A repeat mode that
  disables navigation is a bug; repeat-one now wraps for *manual* moves and replays
  only on `ended`.

### The rest, briefly

- **Prefs** (volume, mute, rate, repeat, shuffle, resume map) are hand-rolled
  localStorage — this add-on still has zero non-core dependencies. The brief wants
  them on brief 49's durable dotfiles and that is right; `CONFIGS_DIR` is declared
  in the backend env schema and **used by no module**, so there is nowhere durable
  to put them today. Moving them is one function when 49 lands.
- **Resume** remembers nothing under 60s and treats the last 15s as finished, so a
  folder of short clips accumulates no state and the credits are never offered as a
  resume point. Writes are throttled to one per 5s of playback (a `timeupdate` fires
  ~4×/second), the map is capped at 200 entries with the least-recently-written
  dropped, and "Start over" both rewinds and forgets.
- **Durations in the queue** come from the only thing that already knows them: a
  detached media element with `preload="metadata"`. Sequential, capped at 60 tracks,
  cached per session — the one feature here that can otherwise fire dozens of
  requests nobody asked for.
- **Brief 89's deferred keys** landed while in here: `↑`/`↓` for volume and `F` for
  fullscreen, with a fullscreen button offered for video only. It fullscreens the
  *stage*, not the `<video>`, so this app's transport bar, keymap and subtitles stay
  on screen — the OS's player filling the screen rather than the browser's. `[`/`]`
  for speed is still not done; the select covers it.
- **Item 7 is now stated** where it belongs, in the component's own doc: closing the
  window stops playback because the window *is* the player. Background playback and
  PiP stay rejected.

### Verified in a browser, against the production bundle on the real backend

Media generated in the page and uploaded through the real API — hand-written WAV
bytes and a canvas recorded with `MediaRecorder` — so every check runs on real
files the backend range-streams, with no fixtures in the repo.

```
PASS the queue shows a duration for every track (3 rows)
PASS the durations are the real lengths of the files, not a guess
PASS the playback rate survives a track change (it used to reset to 1×)
PASS the volume survives a track change
PASS volume and rate persisted across a reload — the most-repeated annoyance in the app
PASS with shuffle off, Next walks the folder order
PASS shuffle visits every track exactly once per cycle — a derived order, not a mutated queue
PASS the shuffled order is stable: a full cycle comes back to where it started
PASS the folder listing itself is untouched — shuffle only changes what plays next
PASS the repeat button cycles through three named states
PASS repeat-one replayed the same track instead of advancing
PASS repeat-all wrapped from the last track back to the first
PASS the error names the file that failed, not just "this file"
PASS it explains why a .mkv in particular may not decode
PASS it offers the one thing that can still work — downloading the file
PASS a notification was raised too, for when the window is behind others
PASS clicking the timebar seeks a 150s file to the right place
PASS the position was remembered (90s), throttled rather than written per timeupdate
PASS nothing was remembered for the file that was never played
PASS reopening the file resumed it at 90s instead of starting over
PASS it says where it resumed from, rather than silently jumping
PASS "Start over" rewinds AND forgets the stored position
PASS the sidecar .srt was found, parsed, and attached as a real text track
PASS the SSA positioning override was stripped from the cue text
PASS the cue is active at its own timestamp — the subtitle is on screen
PASS turning subtitles off changes what is on screen — the cue really was being painted
PASS and turning them back on restores them
PASS fullscreen is offered for video and not for audio
PASS a short clip played to the end leaves no resume entry
page errors: none
```

Tests: frontend vitest **492 → 550** (58 new in this package, which had 7),
backend unchanged at 208 unit + 46 e2e. `turbo typecheck lint test format:check
build` green across 94 tasks. Zero new dependencies, as the brief requires.

Out of scope and untouched: transcoding, a media library, background playback,
PiP, casting, equaliser, `.m3u`.
