# Brief 77 — REST Client: history, variables, and getting requests in and out

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · add-on `apps/add-ons/rest-api-client` (784 LOC / 11 files) + the backend
HTTP proxy module. Standalone.

## Problem

The backend proxy is hardened and reviewed: a scheme allowlist re-checked on
every redirect hop, size/timeout/redirect caps, cookies and auth headers never
forwarded cross-host, 13 tests. Its SSRF stance **deliberately allows private
ranges**, because the owner types every URL — a locked decision in
`wiki/decisions.md`, and the opposite of what brief 50's browser will do for
good reason. None of that changes here.

Collections persist sensibly too, as a JSON file in the home volume via the
files API (`api/collectionsApi.ts:8` → `.config/rest-client/collections.json`),
so the data is in the container and inside the backup.

What is missing is the workflow around a request:

1. **No environments or variables.** Every request hardcodes its host, token and
   ids, so switching between local and a deployed instance means editing every
   saved request. This is the feature that makes a REST client usable rather
   than a curiosity.
2. **History exists in the data model** (`EMPTY_DATA = { collections, history }`)
   — verify how much of it is actually surfaced; a stored history with no UI to
   replay from is a half-feature either way.
3. **No import/export.** A user's requests live in curl commands, Postman
   collections or an OpenAPI spec. Without at least curl in/out, every request
   must be retyped, and nothing can leave — the same interop argument as CSV for
   Sheets, ICS for Calendar and Netscape HTML for Bookmarks.
4. **No auth helpers.** Bearer and Basic have to be hand-typed as headers every
   time.
5. **Body types are probably limited.** Confirm whether multipart and raw binary
   are supported; a client that cannot upload a file cannot exercise half of a
   real API.
6. **Response viewing is thin** — pretty-printed JSON, headers, status, timing
   and size should all be present and easy to scan, and a large response needs
   an honest truncation message rather than a hang.
7. **No streaming / SSE / WebSocket.** Worth naming as deliberate scope rather
   than an oversight.

## Proposed decisions (ungrilled)

- **Environments first.** A named set of key/value variables with `{{var}}`
  interpolation in URL, headers and body, plus an active-environment selector.
  Store them beside collections in the same home-volume file.
- **Secrets in an environment are still plaintext on disk** — say so in the UI.
  Encrypting them would need a key, and the honest place for that is the
  account-derived key brief 50 proposes for the browser profile; until that
  exists, do not imply protection that is not there. Do exclude secret values
  from any export by default.
- **curl import and export** as the interop baseline: paste a curl command to
  build a request, copy any request as curl. Small, well-understood, and it is
  what people actually paste to each other. OpenAPI and Postman import are
  bigger and can follow.
- **Auth helpers for Bearer and Basic**, writing the header for you, with the
  value drawn from an environment variable so tokens are not embedded in saved
  requests.
- **History with replay**, capped and stored with collections, one click to
  reload a past request into the editor.
- **Rejected — reversing the SSRF stance.** Private ranges stay allowed here.
  The owner types every URL; that is exactly why this differs from brief 50, and
  both stances are recorded on purpose. Do not "harmonise" them.
- **Deferred — SSE and WebSocket.** Both need a different transport than the
  request/response proxy (a streamed or upgraded connection), which is a real
  backend change. Name it out of scope now.

## Fix

1. Environments: model, selector UI, `{{var}}` interpolation applied at send
   time (not stored interpolated, so a saved request stays portable), with an
   unresolved-variable warning before sending.
2. Auth helper UI producing the header, sourced from environment variables.
3. curl parse and serialise (pure functions, heavily unit-tested — this is where
   quoting bugs live).
4. History panel with replay; cap the stored entries and note the cap.
5. Response viewer pass: pretty JSON with collapse, headers table, status/time/
   size, and an explicit truncation notice tied to the proxy's size cap.
6. Confirm and, if missing, add multipart and raw-binary bodies — reusing the
   existing upload path rather than inventing a second one.

## Must preserve (regression surface)

- **The proxy's guarantees**: scheme allowlist per redirect hop, size/timeout/
  redirect caps, and cookies/auth never leaked cross-host. Interpolation must
  happen *before* the URL reaches the proxy and must not be able to smuggle a
  scheme the allowlist would reject (`{{var}}` expanding to `file://` is exactly
  the trick a reviewer will try).
- The route stays owner-authed; no `@Public()`.
- Collections keep round-tripping through `.config/rest-client/collections.json`
  under the home root, and a malformed file degrades to `EMPTY_DATA` rather than
  crashing the app.
- Single-instance behaviour (`index.ts:14`) is unchanged.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok, backend tests green.
Unit tests for curl parse/serialise (quoted bodies, multiple headers, `--data`
vs `-d`, methods) and for interpolation, including the scheme-smuggling case.

**Security review before commit** — the reviewer will try: a variable expanding
to a disallowed scheme, a variable injecting a newline into a header, a redirect
chain that changes host and should drop auth, and a response large enough to hit
the size cap.

**Verified in a browser**: define two environments and switch between them
without editing a request; import a curl command and send it; copy a request out
as curl and run it in the Terminal; replay from history; upload a file via
multipart.

## Out of scope

SSE/WebSocket, OpenAPI and Postman import, scripting/pre-request hooks, test
assertions, mock servers, and any change to the SSRF stance.
