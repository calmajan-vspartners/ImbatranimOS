import type { SystemHttp } from '@imbatranim/ui'
import type { HttpMethod, ProxyResponse } from '../types'

/**
 * Send a request through the authed backend proxy. The browser cannot fetch
 * arbitrary origins directly (CSP `connect-src` is same-origin + CORS), so the
 * request is relayed by POST /api/http/request, which returns the response with
 * a base64-encoded body. All SSRF guardrails live server-side.
 *
 * Plain function, not a hook — the capability arrives as the first argument
 * (brief 48).
 */
export async function sendProxyRequest(
  http: SystemHttp,
  input: {
    method: HttpMethod
    url: string
    headers?: Record<string, string>
    body?: string
    /**
     * A binary body, base64-encoded (brief 77) — multipart and raw file uploads.
     * The proxy prefers this over `body` when both are present.
     */
    bodyBase64?: string
  }
): Promise<ProxyResponse> {
  const res = await http.post<ProxyResponse>('/http/request', input)
  return res.data
}
