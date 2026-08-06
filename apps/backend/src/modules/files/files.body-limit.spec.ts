// In-memory DB + a scratch FILES_ROOT so this never touches real data.
// Must be set before the modules (and config validation) are imported.
process.env.DB_PATH = ':memory:';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Server } from 'http';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from 'path';
import { ConfigModule } from '../../config/config.module';
import { DbModule } from '../../db/db.module';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from './files.module';
import { SessionService } from '../auth/session.service';

/**
 * T0-4: Express defaults JSON bodies to a 100 KB cap, which 413s Notepad saves
 * (PUT /files/content), the http-proxy DTO and `git apply` patches. main.ts
 * raises it to 16 MB via `app.use(json({ limit: '16mb' }))`, placed before the
 * built-in parser so it wins. This spec replicates that same wiring (as the
 * other e2e specs replicate main.ts) and asserts a >1 MB body is NOT rejected.
 */
describe('Files body-size cap (T0-4)', () => {
  let app: INestApplication<Server>;
  let http: ReturnType<typeof request>;
  let jail: string;
  let cookie: string;

  beforeAll(async () => {
    jail = await fs.mkdtemp(join(os.tmpdir(), 'imb-bodylimit-'));
    process.env.FILES_ROOT = jail;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, DbModule, AuthModule, FilesModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    // The fix under test — same limit and placement as main.ts.
    app.use(json({ limit: '16mb' }));
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    http = request(app.getHttpServer());

    cookie = `imb_session=${app.get(SessionService).issue().token}`;
  });

  afterAll(async () => {
    await app.close();
    await fs.rm(jail, { recursive: true, force: true });
  });

  it('accepts a >1 MB JSON body on PUT /files/content (not 413)', async () => {
    const content = 'x'.repeat(2 * 1024 * 1024); // 2 MB, well past 100 KB
    const res = await http
      .put('/api/files/content')
      .set('Cookie', cookie)
      .send({ root: 'home', path: 'big.txt', content });

    expect(res.status).not.toBe(413);
    expect(res.status).toBe(200);
    // And the whole payload actually landed on disk, byte-for-byte.
    const onDisk = await fs.readFile(join(jail, 'big.txt'), 'utf-8');
    expect(onDisk.length).toBe(content.length);
  });
});
