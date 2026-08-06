import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { ThrottleService } from './throttle.service';
import { SessionAuthGuard } from './auth.guard';
import { LogsModule } from '../logs/logs.module';

/**
 * Auth (Brief 10). Registers the global {@link SessionAuthGuard} so every
 * route is authenticated by default. SessionService is exported so future
 * modules (terminal/files WebSocket gateways) can validate upgrade requests.
 */
@Module({
  // Explicit, not relying on LogsModule being @Global: the e2e suites build a
  // partial module graph, where a global module that was never imported does
  // not exist. AuthController genuinely requires the logger — every sign-in
  // outcome is an audit event — so the dependency is declared.
  imports: [LogsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    ThrottleService,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
  exports: [SessionService, AuthService],
})
export class AuthModule {}
