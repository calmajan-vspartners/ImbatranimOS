# Brief 77 — REST Client: history, variables, and getting requests in and out

Status: **done 2026-08-05** · From the 2026-07-31 app+OS improvement sweep.
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

---

## Outcome — done 2026-08-05

All seven items addressed. The proxy's guarantees are untouched and re-verified
against the running backend; the SSRF stance is unchanged, deliberately.

### Item 2 was half wrong, and the half that was right hid a real bug

The brief asked to "verify how much of history is actually surfaced". It **was**
surfaced — a sidebar section with a click-to-replay handler. But `HistoryEntry` stored
only `method`, `url`, `status` and `ts`, so "replay" set the method and URL and
**left whatever headers and body happened to be in the builder**. Click a GET from
history while a POST body and an `Authorization` header are loaded, press Send, and
you send something other than what you clicked — with the previous request's
credentials attached. That is worse than having no replay at all.

History now carries `headers`, `body` and `elapsedMs`. Both are optional, so entries
written before this brief still load; those reset the builder to empty rather than
inheriting, because a visible blank beats an invisible leftover. The elapsed time is
shown in the row, since comparing timings is half of why anyone opens history.

### Environments, and the guard the review is aimed at

`{{var}}` substitution in URL, headers and body, applied **at send time and never
stored**, so a saved request keeps its placeholders and works against local and a
deployed instance unchanged. The live preview shows what the URL becomes.

The security-relevant part is that a variable ends up inside a URL the proxy then
fetches. The reviewer's trick is a value that smuggles a scheme:

```
url  = "{{base}}/users"          ← innocent template
base = "file:///etc/passwd#"     ← not innocent value
```

`interpolateRequest` refuses it, and so does the proxy — **defence in depth where the
shallower layer gives the better message**: the user is told which scheme and where,
at the moment they can fix it, instead of an opaque backend error. The same applies to
a variable injecting `\r\n` into a header value or name: refused here, and the poisoned
header is dropped rather than "cleaned". Both were then re-verified end-to-end against
the real proxy, which refuses them too.

A missing variable is a **warning, not a block** — sending is still the user's call,
and the strip offers "add them to the environment" in one click. Only smuggling and
CRLF actually disable Send.

### Secrets: what the flag does and does not buy

Stated in the dialog, at the top, unmissable: values are stored **unencrypted** in
`~/.config/rest-client/collections.json`. Encrypting them needs a key, and the honest
home for that key is the account-derived one brief 50 proposes; until then, implying
protection would be worse than admitting there is none. What `secret` does buy is
real and listed: masked in the editor, **excluded from an export by default** (name
kept, so the recipient can fill in their own), and never baked into a saved request —
the request holds `{{token}}` and interpolates at send.

### Auth helpers

Bearer writes `Authorization: Bearer {{var}}` — a *reference*, which is the whole
point: the saved request is safe to share and correct in every environment. Basic has
to be base64-encoded, so it cannot reference a variable; passing one is **refused
loudly** rather than encoding the literal `{{token}}` into a header that looks fine
and is nonsense.

**Found while probing my own work:** the Bearer dialog defaulted to `varNames[0]`,
which in a normal environment is `base` — producing `Authorization: Bearer
{{base}}`, a header built from the base URL. Wrong in a way that still looks
plausible in the field. It now defaults to the first variable that `looksSecret`.

### curl, where the quoting bugs live

Hand-written reader and writer, 40 tests. It is explicitly **not a shell**: `$(…)`,
backticks and pipes stay literal text, because a pasted curl command is untrusted
input and the only safe reading of it is as data.

**Found by the round-trip test**: the tokenizer handled `\` only before a newline, so
`shellQuote("it's")` — which emits `'it'\''s'` — came back with a stray backslash.
Outside quotes a backslash escapes the *next* character, whatever it is. The
parse → serialise → parse test caught it before any user did.

Import shows a **preview of what it parsed before applying it**, and names anything it
had to drop (`-o out.json`, `--cacert`, an unknown flag) so nothing vanishes silently.
`-u` becomes a real Basic header, `-G` moves the data into the query string, `--json`
adds the two headers curl would, and a flag whose value is ignored still consumes that
value — so `-o out.json` cannot leave `out.json` looking like the URL.

### Multipart and raw binary

The brief asked to confirm; confirmed missing — the proxy took `body?: string`, so no
upload was possible. The proxy DTO gained `bodyBase64`, decoded once and handed to
`fetch` exactly as the string body was. **It bypasses nothing**: the scheme allowlist,
size cap, timeout, redirect cap and header sanitising are all upstream of the body,
and the review re-checked that a `bodyBase64` request to `file://` is still refused.
The multipart envelope is built client-side (`multipart.ts`), which keeps the proxy a
dumb relay whose guardrails are about *where* a request goes, not what is in it.
`FormData` was deliberately not used: its bytes are only reachable by handing it to
`fetch`, which this app cannot do.

### Found while probing, in no brief

- Every `notify()` in this app was missing `appId`, so its toasts had no icon and no
  click-to-open (§23). Fixed throughout.
- A malformed collections file degraded to a hand-written empty literal in one place
  and `EMPTY_DATA` in another; they are now one constant, and each field is validated
  independently so a pre-brief-77 file keeps its collections and history instead of
  being discarded wholesale. A dangling `activeEnvId` is dropped at load, so the send
  path never has to cope with one.

### Verified in a browser, against a real echo server

```
PASS one request, {{base}}/users?page=1, with a live interpolated preview
PASS the auth helper writes Bearer {{token}} (not the token, not {{base}})
PASS sent under "Local": authorization = Bearer local-token, host 127.0.0.1:4599
PASS switched to "Alt" WITHOUT editing the request
PASS sent under "Alt": authorization = Bearer alt-token, host localhost:4599
PASS copy-as-curl emits the UNINTERPOLATED {{base}} / {{token}} — portable
PASS importing a curl command previews it, reports the dropped -o, and loads
PASS the imported {"it's":"quoted"} body arrives byte-identical
PASS history shows status, method, url and elapsed ms
PASS replaying restores the headers too (Bearer {{token}}), not just the URL
PASS multipart: correct boundary, text field, filename, and the file's real bytes
page errors: none
```

### Security review, against the running backend

```
REFUSED  a variable expanding to file:, data:, gopher:, jar:
REFUSED  a variable injecting \r\n or \n into a header value
REFUSED  a URL containing CRLF
OK       a redirect that changes host DROPS authorization and cookie
OK       …while an ordinary header (X-Keep) still travels
OK       a 14 MB response is capped at 10 MB and flagged truncated — no hang
ALLOWED  http://127.0.0.1 and http://localhost — the SSRF stance is UNCHANGED
REFUSED  bodyBase64 to a file: URL, and a bodyBase64 that is not base64
401      POST /api/http/request without a session
SECURITY REVIEW CLEAN
```

Tests: frontend vitest **916 → 1022** (106 new in a package that had **zero** — curl
tokenising and round trips, interpolation including every smuggling case, the
environment/secret model, and the multipart writer). Backend unit **282 → 287** (5 new
on the binary body path). Backend e2e unchanged at 138. All 103 turbo tasks green.
Zero new dependencies.

Out of scope and untouched, as specified: SSE and WebSocket (they need a streamed or
upgraded transport, which is a real backend change — named, not forgotten), OpenAPI and
Postman import, scripting and pre-request hooks, test assertions, mock servers, and any
change to the SSRF stance.
