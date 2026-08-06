import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
} from '@nestjs/common';
import { HttpProxyService } from './http-proxy.service';
import { HttpProxyMethod } from './dto/http-proxy.dto';

/** A minimal successful text Response. */
function okResponse(body = 'hello', init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/plain', ...init.headers },
    ...init,
  });
}

describe('HttpProxyService', () => {
  let service: HttpProxyService;
  const realFetch = global.fetch;

  beforeEach(() => {
    service = new HttpProxyService();
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  describe('scheme allowlist', () => {
    it('rejects a file:// URL before any request is made', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      await expect(
        service.request({
          method: HttpProxyMethod.GET,
          url: 'file:///etc/passwd',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects non-http schemes (gopher, data)', async () => {
      global.fetch = jest.fn();
      await expect(
        service.request({
          method: HttpProxyMethod.GET,
          url: 'gopher://example.com/',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a URL containing CRLF (request-splitting)', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;
      await expect(
        service.request({
          method: HttpProxyMethod.GET,
          url: 'http://example.com/\r\nHost: evil',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects an unparseable URL', async () => {
      global.fetch = jest.fn();
      await expect(
        service.request({ method: HttpProxyMethod.GET, url: 'not a url' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('redirects', () => {
    it('re-applies the scheme allowlist on each hop — https→file is rejected', async () => {
      const fetchMock = jest.fn().mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'file:///etc/passwd' },
        }),
      );
      global.fetch = fetchMock;

      await expect(
        service.request({
          method: HttpProxyMethod.GET,
          url: 'https://example.com/redirect',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      // The first (https) hop was made; the file: hop was refused before fetch.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('follows redirects up to the cap, then fails with 502', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/next' },
        }),
      );
      global.fetch = fetchMock;

      await expect(
        service.request({
          method: HttpProxyMethod.GET,
          url: 'https://example.com/start',
        }),
      ).rejects.toBeInstanceOf(BadGatewayException);
      // Initial hop + 5 follows = 6 fetches, then the cap trips.
      expect(fetchMock).toHaveBeenCalledTimes(6);
    });

    it('follows a redirect to a valid http(s) target', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 301,
            headers: { location: 'https://example.com/final' },
          }),
        )
        .mockResolvedValueOnce(okResponse('landed'));
      global.fetch = fetchMock;

      const res = await service.request({
        method: HttpProxyMethod.GET,
        url: 'https://example.com/old',
      });
      expect(res.status).toBe(200);
      expect(Buffer.from(res.bodyBase64, 'base64').toString()).toBe('landed');
      expect(fetchMock).toHaveBeenLastCalledWith(
        'https://example.com/final',
        expect.anything(),
      );
    });
  });

  describe('response size cap', () => {
    it('truncates a body larger than the cap and flags truncated', async () => {
      // Emit 1 MB chunks on demand until the reader stops pulling.
      const chunk = new Uint8Array(1024 * 1024).fill(65); // 'A'
      let emitted = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (emitted >= 12) {
            controller.close();
            return;
          }
          emitted++;
          controller.enqueue(chunk);
        },
      });
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          new Response(stream, { status: 200, statusText: 'OK' }),
        );

      const res = await service.request({
        method: HttpProxyMethod.GET,
        url: 'http://example.com/huge',
      });
      expect(res.truncated).toBe(true);
      // Exactly the 10 MB cap, no more.
      expect(Buffer.from(res.bodyBase64, 'base64').byteLength).toBe(
        10 * 1024 * 1024,
      );
    });

    it('does not flag truncated for a small body', async () => {
      global.fetch = jest.fn().mockResolvedValue(okResponse('small'));
      const res = await service.request({
        method: HttpProxyMethod.GET,
        url: 'http://example.com/small',
      });
      expect(res.truncated).toBe(false);
    });
  });

  describe('timeout', () => {
    it('aborts and surfaces a 504 when the target hangs', async () => {
      jest.useFakeTimers();
      // A fetch that only ever rejects when its signal is aborted.
      global.fetch = jest.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      ) as unknown as typeof fetch;

      const promise = service.request({
        method: HttpProxyMethod.GET,
        url: 'http://example.com/hang',
      });
      // Let the service kick off fetch + arm the timeout timer.
      await Promise.resolve();
      jest.advanceTimersByTime(30_000);

      await expect(promise).rejects.toBeInstanceOf(GatewayTimeoutException);
      jest.useRealTimers();
    });
  });

  describe('header hygiene', () => {
    it('strips hop-by-hop headers and never injects the OS session cookie / Authorization', async () => {
      let sentHeaders: Record<string, string> = {};
      global.fetch = jest.fn(
        (_url: string | URL | Request, init?: RequestInit) => {
          sentHeaders = (init?.headers ?? {}) as Record<string, string>;
          return Promise.resolve(okResponse('ok'));
        },
      );

      await service.request({
        method: HttpProxyMethod.GET,
        url: 'http://example.com/',
        headers: {
          Connection: 'keep-alive',
          'Keep-Alive': 'timeout=5',
          'Transfer-Encoding': 'chunked',
          TE: 'trailers',
          'Proxy-Authorization': 'Basic sneaky',
          'X-Custom': 'keep-me',
        },
      });

      // The one legitimate user header survives...
      expect(sentHeaders['X-Custom']).toBe('keep-me');
      // ...every hop-by-hop / proxy header is gone...
      const lowerKeys = Object.keys(sentHeaders).map((k) => k.toLowerCase());
      for (const banned of [
        'connection',
        'keep-alive',
        'transfer-encoding',
        'te',
        'proxy-authorization',
      ]) {
        expect(lowerKeys).not.toContain(banned);
      }
      // ...and the OS's own credentials are never present (we build outbound
      // headers ONLY from user input — the request cookie is never read).
      expect(lowerKeys).not.toContain('cookie');
      expect(lowerKeys).not.toContain('authorization');
    });

    it('rejects a header value containing CRLF (header smuggling)', async () => {
      global.fetch = jest.fn();
      await expect(
        service.request({
          method: HttpProxyMethod.GET,
          url: 'http://example.com/',
          headers: { 'X-Evil': 'a\r\nX-Injected: yes' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('binary request body (brief 77)', () => {
    it('sends the decoded bytes, not the base64 text', async () => {
      // Without this, the REST client could only send a string — no multipart, no
      // file upload. The bytes must arrive byte-for-byte, including a NUL and a
      // 0xFF that no UTF-8 string round trip would survive.
      const raw = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x41, 0x42]);
      const base64 = Buffer.from(raw).toString('base64');
      const fetchMock = jest.fn().mockResolvedValue(okResponse('ok'));
      global.fetch = fetchMock;

      await service.request({
        method: HttpProxyMethod.POST,
        url: 'https://example.com/upload',
        bodyBase64: base64,
      });

      const sent = (
        fetchMock.mock.calls[0] as [string, { body: ArrayBuffer }]
      )[1].body;
      expect(sent).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(sent))).toEqual(Array.from(raw));
    });

    it('sends an exact-size buffer, not a window into a pooled one', async () => {
      // Buffer.from(...).buffer can be a view into a larger pooled allocation, so
      // handing it to fetch unsliced would send trailing bytes that are not the body.
      const raw = new Uint8Array([1, 2, 3]);
      const fetchMock = jest.fn().mockResolvedValue(okResponse('ok'));
      global.fetch = fetchMock;
      await service.request({
        method: HttpProxyMethod.POST,
        url: 'https://example.com/x',
        bodyBase64: Buffer.from(raw).toString('base64'),
      });
      const sent = (
        fetchMock.mock.calls[0] as [string, { body: ArrayBuffer }]
      )[1].body;
      expect(sent.byteLength).toBe(3);
    });

    it('prefers bodyBase64 over a string body when both arrive', async () => {
      const fetchMock = jest.fn().mockResolvedValue(okResponse('ok'));
      global.fetch = fetchMock;
      await service.request({
        method: HttpProxyMethod.POST,
        url: 'https://example.com/x',
        body: 'string body',
        bodyBase64: Buffer.from('bytes body').toString('base64'),
      });
      const sent = (
        fetchMock.mock.calls[0] as [string, { body: ArrayBuffer }]
      )[1].body;
      expect(Buffer.from(new Uint8Array(sent)).toString()).toBe('bytes body');
    });

    it('still refuses a disallowed scheme — the body changes no guardrail', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;
      await expect(
        service.request({
          method: HttpProxyMethod.POST,
          url: 'file:///etc/passwd',
          bodyBase64: Buffer.from('x').toString('base64'),
        }),
      ).rejects.toThrow(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('omits the body entirely for GET, as before', async () => {
      const fetchMock = jest.fn().mockResolvedValue(okResponse('ok'));
      global.fetch = fetchMock;
      await service.request({
        method: HttpProxyMethod.GET,
        url: 'https://example.com/x',
        bodyBase64: Buffer.from('x').toString('base64'),
      });
      const init = (fetchMock.mock.calls[0] as [string, { body?: unknown }])[1];
      expect(init.body).toBeUndefined();
    });
  });

  describe('happy path', () => {
    it('performs a GET and returns a parsed, base64-encoded response', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        okResponse('hello world', {
          headers: { 'content-type': 'application/json' },
        }),
      );

      const res = await service.request({
        method: HttpProxyMethod.GET,
        url: 'http://example.com/api',
      });

      expect(res.status).toBe(200);
      expect(res.statusText).toBe('OK');
      expect(res.headers['content-type']).toBe('application/json');
      expect(Buffer.from(res.bodyBase64, 'base64').toString()).toBe(
        'hello world',
      );
      expect(res.truncated).toBe(false);
      expect(typeof res.elapsedMs).toBe('number');
    });
  });
});
