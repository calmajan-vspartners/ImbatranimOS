// In-memory DB + a scratch FILES_ROOT so this e2e never touches real data.
// Must be set before the modules (and config validation) are imported.
process.env.DB_PATH = ':memory:';
// A small upload cap so the 413 over-cap test does not have to push 100 MB.
// Read once at controller import time, hence set here at the very top.
process.env.FILES_MAX_UPLOAD_BYTES = '2048';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Server } from 'http';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from 'path';
import { ConfigModule } from '../src/config/config.module';
import { DbModule } from '../src/db/db.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { FilesModule } from '../src/modules/files/files.module';
import { SessionService } from '../src/modules/auth/session.service';

/** Shapes of the response bodies this spec reads fields off of. */
interface UploadResponse {
  path: string;
}
interface HttpErrorResponse {
  statusCode: number;
}

/**
 * superagent parser that yields the raw response bytes as a Buffer.
 *
 * `res` is typed `unknown` and narrowed here rather than declared as
 * `NodeJS.ReadableStream`. superagent's `.parse()` declares its callback's first
 * parameter as its own `Response` type, so a `ReadableStream` parameter is not
 * assignable to it — even though at runtime the object it hands over IS a readable
 * stream, which is why this worked. The narrowing keeps the code honest about the
 * cast instead of the file quietly failing to type-check.
 */
function binaryParser(
  res: unknown,
  cb: (err: Error | null, body: Buffer) => void,
) {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('Files (e2e) — auth + binary round-trip', () => {
  let app: INestApplication<Server>;
  let http: ReturnType<typeof request>;
  let jail: string;
  let cookie: string;

  beforeAll(async () => {
    jail = await fs.mkdtemp(join(os.tmpdir(), 'imb-files-e2e-'));
    process.env.FILES_ROOT = jail;

    // A Test module wiring ONLY the FS surface + auth (no AppModule), so the
    // global APP_GUARD from AuthModule protects the FilesModule routes.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, DbModule, AuthModule, FilesModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    http = request(app.getHttpServer());

    // Mint a session straight through SessionService (exported by AuthModule).
    const token = app.get(SessionService).issue().token;
    cookie = `imb_session=${token}`;
  });

  afterAll(async () => {
    await app.close();
    await fs.rm(jail, { recursive: true, force: true });
  });

  describe('authentication', () => {
    it('rejects a read route with no session (401)', async () => {
      await http.get('/api/files?root=home').expect(401);
    });

    it('rejects a mutating route with no session (401)', async () => {
      await http.delete('/api/files?root=home&path=x').expect(401);
    });

    it('allows the read route with a valid session (200)', async () => {
      await http.get('/api/files?root=home').set('Cookie', cookie).expect(200);
    });
  });

  describe('binary upload/download round-trip', () => {
    const bytes = Buffer.from([0x00, 0x10, 0xff, 0x80, 0x7f, 0x00, 0xde, 0xad]);

    it('uploads a binary file that lands on the real disk', async () => {
      await http
        .post('/api/files/upload')
        .set('Cookie', cookie)
        .field('root', 'home')
        .field('path', 'uploads/blob.bin')
        .attach('file', bytes, 'blob.bin')
        .expect(201);

      const onDisk = await fs.readFile(join(jail, 'uploads/blob.bin'));
      expect(onDisk.equals(bytes)).toBe(true);
    });

    it('downloads the same bytes back intact', async () => {
      const res = await http
        .get('/api/files/download?root=home&path=uploads/blob.bin')
        .set('Cookie', cookie)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      expect((res.body as Buffer).equals(bytes)).toBe(true);
      // Range-less GET still advertises range support so a media element knows
      // it can seek (this is what makes the Media Player scrubber work).
      expect(res.headers['accept-ranges']).toBe('bytes');
    });

    it('serves a byte range as 206 Partial Content (media seek)', async () => {
      // bytes=2-5 → the inclusive middle slice [0xff, 0x80, 0x7f, 0x00].
      const res = await http
        .get('/api/files/download?root=home&path=uploads/blob.bin')
        .set('Cookie', cookie)
        .set('Range', 'bytes=2-5')
        .buffer(true)
        .parse(binaryParser)
        .expect(206);
      expect(res.headers['content-range']).toBe(`bytes 2-5/${bytes.length}`);
      expect(res.headers['content-length']).toBe('4');
      expect((res.body as Buffer).equals(bytes.subarray(2, 6))).toBe(true);
    });

    it('answers 416 for a range past the end of the file', async () => {
      await http
        .get('/api/files/download?root=home&path=uploads/blob.bin')
        .set('Cookie', cookie)
        .set('Range', `bytes=${bytes.length}-${bytes.length + 10}`)
        .expect(416);
    });
  });

  describe('traversal refused over HTTP', () => {
    it('refuses ../ escape with 400', async () => {
      await http
        .get('/api/files?root=home&path=../../etc')
        .set('Cookie', cookie)
        .expect(400);
    });

    it('cannot escape the jail via the multipart filename (originalname)', async () => {
      // No `path` field, so the controller falls back to file.originalname —
      // which is attacker-controlled. Two layers keep it safe: busboy strips
      // the filename to a basename, and resolveSafe would reject anything that
      // still contained `../`. Either way the invariant is: nothing lands
      // outside the jail. We assert the invariant, not the specific status.
      const res = await http
        .post('/api/files/upload')
        .set('Cookie', cookie)
        .field('root', 'home')
        .attach('file', Buffer.from('pwned'), '../../../../escape.txt');
      expect([201, 400]).toContain(res.status);

      // Nothing escaped to any ancestor of the jail.
      await expect(
        fs.stat(join(jail, '..', '..', '..', '..', 'escape.txt')),
      ).rejects.toBeTruthy();

      // If it was accepted, the returned path must stay inside the jail.
      if (res.status === 201) {
        const uploadBody = res.body as UploadResponse;
        expect(uploadBody.path).not.toContain('..');
        const landed = join(jail, uploadBody.path);
        expect(landed.startsWith(jail)).toBe(true);
        await expect(fs.stat(landed)).resolves.toBeTruthy();
      }
    });
  });

  describe('over-cap upload', () => {
    it('rejects an upload above the size cap with a clean 413', async () => {
      const tooBig = Buffer.alloc(4096, 0x41); // 4 KiB > 2 KiB cap
      const res = await http
        .post('/api/files/upload')
        .set('Cookie', cookie)
        .field('root', 'home')
        .field('path', 'big.bin')
        .attach('file', tooBig, 'big.bin')
        .expect(413);
      expect((res.body as HttpErrorResponse).statusCode).toBe(413);
      // The over-cap file must not have been written.
      await expect(fs.stat(join(jail, 'big.bin'))).rejects.toBeTruthy();
    });

    it('still accepts an upload at/under the cap (201)', async () => {
      await http
        .post('/api/files/upload')
        .set('Cookie', cookie)
        .field('root', 'home')
        .field('path', 'small.bin')
        .attach('file', Buffer.alloc(1024, 0x42), 'small.bin')
        .expect(201);
    });
  });
});
