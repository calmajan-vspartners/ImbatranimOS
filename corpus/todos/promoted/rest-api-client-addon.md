---
title: REST/API client add-on (Postman/Hoppscotch-style)
created: 2026-07-17
status: promoted
tags: [add-on, developer, web]
---

# REST/API client add-on (Postman/Hoppscotch-style)

The web dev's Postman: compose HTTP requests (method, URL, headers, body),
send, inspect the response (status, headers, pretty-printed JSON), save a
collection/history of requests.

## Context

A daily tool for web developers. Fits the "real computer" story — the box can
already `curl` anything.

**Constraints to respect when this is grilled into a brief:**
- Requests should go through a backend proxy so arbitrary hosts work without
  CORS limits (same spirit as running curl on the machine). Auth the proxy
  route; be mindful it's an outbound-request surface (SSRF considerations —
  see the security posture in `wiki/decisions.md`).
- Persist collections/history in the home FS (or the app's own store), owned by
  `imbatranim`.
- Keep it lazy-loaded; don't grow the eager bundle.

From the 2026-07-17 daily-driver research pass.
