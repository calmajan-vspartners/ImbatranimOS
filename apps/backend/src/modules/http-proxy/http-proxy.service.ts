import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type {
  HttpProxyRequestDto,
  HttpProxyResponse,
} from './dto/http-proxy.dto';

// ---------------------------------------------------------------------------
// SSRF stance (recorded decision — see wiki/decisions.md).
//
// This proxy is a deliberate outbound tool for the *single logged-in owner*
// (it sits behind the global SessionAuthGuard — owner-only). It is the owner's
// own `curl`, not an open relay, so reaching LAN / localhost / private ranges
// is INTENTIONAL and NOT blocked — blocking them would gut the tool (a dev
// testing a local service) and the caller is already the trusted owner.
//
// The guardrails below do NOT pretend to be a public-safe SSRF filter; they
// BOUND THE BLAST RADIUS so a hostile *target* (or a redirect chain) cannot
// escalate scheme, hang us, OOM us, or smuggle headers:
//   1. Scheme allowlist (http/https) — re-checked on EVERY redirect hop.
//   2. Response size cap (stream + abort past MAX_BODY_BYTES → truncated).
//   3. Timeout via AbortController.
//   4. Redirect cap (manual, <= MAX_REDIRECTS, scheme re-validated per hop).
//   5. Header hygiene (hop-by-hop stripped; OS session cookie / Authorization
//      never forwarded — outbound headers are built ONLY from user input).
// ---------------------------------------------------------------------------

/** Hard body cap — past this we stop reading, mark `truncated`, and return. */
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB
/** Whole-request timeout, applied across all redirect hops. */
const REQUEST_TIMEOUT_MS = 30_000; // 30 s
/** Max redirect hops we follow ourselves (redirect: 'manual'). */
const MAX_REDIRECTS = 5;

/** Statuses that carry a Location we follow. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Hop-by-hop headers (RFC 7230 §6.1) plus proxy-specific ones. These describe
 * a single transport hop and must never be relayed to the target — forwarding
 * them enables request smuggling / connection confusion. Any `proxy-*` header
 * is dropped too (covers proxy-authorization/authenticate/connection).
 */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'proxy-connection',
  'proxy-authorization',
  'proxy-authenticate',
]);

/**
 * Decode a base64 body to a standalone ArrayBuffer.
 *
 * The slice matters: `Buffer.from(...).buffer` may be a view into a larger pooled
 * allocation, so handing it straight to `fetch` can send bytes that are not the
 * body. Copying to an exact-size buffer is the only correct reading.
 */
function bytesOf(base64: string): ArrayBuffer {
  const buf = Buffer.from(base64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** RFC 7230 token — valid header field-name characters. */
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

@Injectable()
export class HttpProxyService {
  /**
   * Perform the outbound request on the owner's behalf and return the response
   * with a base64 body. Every security guardrail is enforced here (and, for
   * scheme/redirects, re-enforced on each hop).
   */
  async request(dto: HttpProxyRequestDto): Promise<HttpProxyResponse> {
    const start = Date.now();

    // Guardrail 1: parse + scheme allowlist on the *initial* URL.
    let currentUrl = this.parseAndValidateUrl(dto.url);
    let method: string = dto.method;
    // A binary body (brief 77) wins over the string one. Decoded once, here, and
    // then treated exactly as the string body is — opaque bytes handed to `fetch`.
    // Every guardrail (scheme, size, timeout, redirects, headers) is upstream of it.
    // `ArrayBuffer` rather than `Uint8Array`: undici's `BodyInit` accepts the former
    // directly, and going through a view would need a cast that hides the intent.
    let body: string | ArrayBuffer | undefined =
      dto.bodyBase64 !== undefined ? bytesOf(dto.bodyBase64) : dto.body;

    // Guardrail 5: outbound headers are derived ONLY from user input — the
    // incoming request (and thus the OS session cookie / Authorization) is
    // never read here, so it can never be forwarded to the target.
    const headers = this.sanitizeHeaders(dto.headers);

    // Guardrail 3: single AbortController spans all hops (timeout budget).
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      // Guardrail 4: manual redirect loop, at most MAX_REDIRECTS hops.
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const res = await fetch(currentUrl.toString(), {
          method,
          headers,
          body: this.methodAllowsBody(method) ? body : undefined,
          redirect: 'manual',
          signal: controller.signal,
        });

        const location = res.headers.get('location');
        if (REDIRECT_STATUSES.has(res.status) && location) {
          if (hop === MAX_REDIRECTS) {
            throw new BadGatewayException('Too many redirects');
          }
          // Guardrail 1 (re-applied): resolve relative Location against the
          // current URL and re-run the scheme allowlist. A redirect to
          // file:/gopher:/data: (scheme downgrade) is rejected right here.
          const next = this.parseAndValidateUrl(location, currentUrl);

          // Cross-host redirect: drop the user's own Authorization/Cookie so
          // their credentials don't follow to a different origin (matches
          // curl >= 7.58). Same-host redirects keep them.
          if (next.host !== currentUrl.host) {
            for (const k of Object.keys(headers)) {
              const lk = k.toLowerCase();
              if (lk === 'authorization' || lk === 'cookie') delete headers[k];
            }
          }

          // Normalise method/body across the redirect per RFC 7231.
          if (
            res.status === 303 ||
            ((res.status === 301 || res.status === 302) &&
              method !== 'GET' &&
              method !== 'HEAD')
          ) {
            method = 'GET';
            body = undefined;
          }

          currentUrl = next;
          // Free the socket for the redirect response we're discarding.
          await res.body?.cancel().catch(() => undefined);
          continue;
        }

        // Terminal response — read the body under the size cap.
        const { bodyBase64, truncated } = await this.readCappedBody(res);
        return {
          status: res.status,
          statusText: res.statusText,
          headers: this.headersToRecord(res.headers),
          bodyBase64,
          truncated,
          elapsedMs: Date.now() - start,
        };
      }

      // Unreachable (the loop returns or throws), but keeps the type checker
      // and defends against an off-by-one in the bound above.
      throw new BadGatewayException('Too many redirects');
    } catch (err) {
      // Guardrail 3: our own abort surfaces as a 504, distinct from the
      // target simply erroring.
      if (timedOut) {
        throw new GatewayTimeoutException('Upstream request timed out');
      }
      // Our own validation errors (bad scheme, CRLF, too many redirects) are
      // already HttpExceptions — re-throw them verbatim.
      if (err instanceof HttpException) throw err;
      const message = err instanceof Error ? err.message : 'unknown error';
      throw new BadGatewayException(`Upstream request failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Parse `raw` (optionally resolved against `base` for a redirect Location)
   * and enforce the scheme allowlist. Rejects on:
   *   - a raw CR/LF in the string (header/URL injection), before parsing;
   *   - `new URL()` parse failure;
   *   - any scheme other than http: / https:.
   * Returns the parsed URL so callers reuse the canonical form.
   */
  private parseAndValidateUrl(raw: string, base?: URL): URL {
    // Reject CRLF (and bare CR/LF) up front — never let it reach the parser
    // or a socket, where it could split a request line / smuggle a header.
    if (/[\r\n]/.test(raw)) {
      throw new BadRequestException('Illegal control character in URL');
    }
    let url: URL;
    try {
      url = base ? new URL(raw, base) : new URL(raw);
    } catch {
      throw new BadRequestException('Invalid URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException(
        `Scheme not allowed: ${url.protocol} (only http/https)`,
      );
    }
    return url;
  }

  /**
   * Build the outbound header set from user input only. Drops hop-by-hop and
   * proxy-* headers, validates names (RFC 7230 token) and rejects CRLF in
   * values (header smuggling). Crucially it NEVER adds the OS's own session
   * cookie or Authorization — the only credentials sent are ones the owner
   * typed themselves (their own curl).
   */
  private sanitizeHeaders(
    input?: Record<string, string>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    if (!input) return out;
    for (const [rawName, value] of Object.entries(input)) {
      if (typeof value !== 'string') {
        throw new BadRequestException(
          `Header "${rawName}" must have a string value`,
        );
      }
      const name = rawName.trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      // Strip hop-by-hop + any proxy-* header, even if the user set it.
      if (HOP_BY_HOP_HEADERS.has(lower) || lower.startsWith('proxy-')) continue;
      if (!HEADER_NAME_RE.test(name)) {
        throw new BadRequestException(`Invalid header name: "${rawName}"`);
      }
      if (/[\r\n]/.test(value)) {
        throw new BadRequestException(
          `Illegal control character in header "${name}"`,
        );
      }
      out[name] = value;
    }
    return out;
  }

  /**
   * Stream the response body, stopping once MAX_BODY_BYTES is reached. On
   * overflow we truncate to exactly the cap, cancel the stream (so we neither
   * buffer nor download the rest), and flag `truncated`. Returns base64.
   */
  private async readCappedBody(
    res: Response,
  ): Promise<{ bodyBase64: string; truncated: boolean }> {
    if (!res.body) return { bodyBase64: '', truncated: false };

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = MAX_BODY_BYTES - total;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        total = MAX_BODY_BYTES;
        truncated = true;
        // Stop pulling from the target — bounds download + memory.
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }

    return { bodyBase64: Buffer.concat(chunks).toString('base64'), truncated };
  }

  /** GET/HEAD carry no body; everything else may. */
  private methodAllowsBody(method: string): boolean {
    return method !== 'GET' && method !== 'HEAD';
  }

  /** Flatten a fetch Headers object into a plain record for the JSON reply. */
  private headersToRecord(headers: Headers): Record<string, string> {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
}
