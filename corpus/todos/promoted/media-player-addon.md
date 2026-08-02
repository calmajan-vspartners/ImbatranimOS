---
title: Media player add-on (audio/video)
created: 2026-07-17
status: promoted
tags: [add-on, normal-user, media]
---

# Media player add-on (audio/video)

An audio/video player with real transport controls (play/pause, seek, volume)
and a playlist/queue from a folder. Today AV only plays inline in the preview
pane — no player app.

## Context

Normal-user daily-driver completeness. Uses the browser's native `<audio>`/
`<video>` — no heavy decode deps needed for common web-playable formats.

**Constraints to respect when this is grilled into a brief:**
- Register in the file-manager ext→app map so media files open here.
- Stream from the FS API by range where possible for large files rather than
  loading whole into memory (respects the file-content memory cap posture).
- No gaming/GPU ambitions — this is plain media playback.

From the 2026-07-17 daily-driver research pass.
