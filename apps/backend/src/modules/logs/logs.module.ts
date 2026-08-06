import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LogService } from './log.service';
import { LogsController } from './logs.controller';
import { AuditExceptionFilter } from './audit-exception.filter';

/**
 * The system log (brief 84).
 *
 * `@Global` for the same reason `DbModule` is: auditing is cross-cutting, and it
 * depends on nothing itself, so there is no cycle to create. Modules whose
 * providers take `LogService` as a **required** constructor argument import it
 * explicitly as well, which is not redundancy — `@Global` only reaches a module
 * that is in the graph, and the e2e suites build partial graphs from a handful of
 * modules. Relying on Global alone made every one of them fail to boot.
 */
@Global()
@Module({
  controllers: [LogsController],
  providers: [
    LogService,
    { provide: APP_FILTER, useClass: AuditExceptionFilter },
  ],
  exports: [LogService],
})
export class LogsModule {}
