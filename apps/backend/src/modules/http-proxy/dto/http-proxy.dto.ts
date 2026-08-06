import {
  IsBase64,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Methods the proxy will relay. Kept to the common verbs a REST client needs;
 * an enum (not a free string) so the ValidationPipe rejects anything exotic
 * (`CONNECT`, `TRACE`, made-up verbs) before it reaches the service.
 */
export enum HttpProxyMethod {
  GET = 'GET',
  HEAD = 'HEAD',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
  OPTIONS = 'OPTIONS',
}

/**
 * POST /api/http/request body. The URL is only shape-checked here (non-empty
 * string, bounded length); the real scheme allowlist + CRLF rejection happens
 * in the service, because it must also run on every redirect hop — validation
 * that lives only on the DTO would be bypassed by a redirect.
 */
export class HttpProxyRequestDto {
  @IsEnum(HttpProxyMethod)
  method: HttpProxyMethod;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  url: string;

  /**
   * User-supplied outbound headers. Validated as a flat object here; each
   * value is type-/CRLF-checked and hop-by-hop names are stripped in the
   * service (see HttpProxyService.sanitizeHeaders).
   */
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  /** Optional raw request body (sent verbatim for non-GET/HEAD methods). */
  @IsOptional()
  @IsString()
  @MaxLength(10 * 1024 * 1024)
  body?: string;

  /**
   * A **binary** request body, base64-encoded (brief 77).
   *
   * The REST client could previously only send a string, which meant no multipart
   * upload and no raw binary — "a client that cannot upload a file cannot exercise
   * half of a real API". The body is entirely opaque to this service either way: it
   * is passed to `fetch` and never parsed, so accepting bytes adds no attack surface.
   * It does NOT bypass any guardrail — the scheme allowlist, size caps, timeout,
   * redirect cap and header sanitising are all upstream of the body.
   *
   * When both are present `bodyBase64` wins, and the client is expected to send only
   * one. The cap is the base64 length, so the decoded body is ~3/4 of it.
   */
  @IsOptional()
  @IsBase64()
  @MaxLength(14 * 1024 * 1024)
  bodyBase64?: string;
}

/** Shape returned to the caller. Body is always base64 (may be binary). */
export interface HttpProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64: string;
  truncated: boolean;
  elapsedMs: number;
}
