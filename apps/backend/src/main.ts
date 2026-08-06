import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { AppModule } from './app.module';
import { securityHeaders } from './security-headers';
import type { Env } from './config/env.schema';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<Env, true>);

  // Behind a TLS-terminating reverse proxy, trust X-Forwarded-* so req.ip
  // (rate-limit key) and the secure-cookie decision reflect the real client.
  if (config.get('TRUST_PROXY')) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.use(securityHeaders);
  app.use(cookieParser());
  // Raise Express's 100 KB default JSON body cap. Registered here (before
  // listen/init) so it runs ahead of Nest's built-in body parser and sets
  // req._body first, which makes the built-in 100 KB parser skip. Without this,
  // Notepad saves (PUT /files/content), the http-proxy DTO (10 MB body /
  // 14 MB bodyBase64) and `git apply` (1 MB patch) all 413 past ~100 KB.
  app.use(json({ limit: '16mb' }));
  app.setGlobalPrefix('api');
  // credentials:true is required for the session cookie to flow cross-origin
  // in dev (Vite 5173 -> API 3001). In prod everything is same-origin.
  app.enableCors({ origin: config.get('FRONTEND_URL'), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Wire SIGTERM/SIGINT to Nest's lifecycle so onModuleDestroy actually runs in
  // prod (PtyGateway child reaping, WS close, the DB handle) — otherwise
  // `docker stop` hangs the full 10s until SIGKILL and children are orphaned.
  app.enableShutdownHooks();

  // Health check outside global prefix
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get(
    '/health',
    (_req: unknown, res: { json: (data: unknown) => void }) => {
      res.json({ status: 'ok' });
    },
  );

  await app.listen(config.get('PORT'));
}
void bootstrap();
