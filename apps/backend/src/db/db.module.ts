import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DbService } from './db.service';
import { StorageHealthGuard } from './storage-health.guard';

@Global()
@Module({
  providers: [
    DbService,
    // Every API request answers an honest 503 while a migration has failed
    // (brief 110) — the same APP_GUARD pattern auth and logs already use.
    { provide: APP_GUARD, useClass: StorageHealthGuard },
  ],
  exports: [DbService],
})
export class DbModule {}
