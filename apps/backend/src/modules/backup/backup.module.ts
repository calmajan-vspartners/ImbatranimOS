import { Module } from '@nestjs/common';
import { ArchiveModule } from '../archive/archive.module';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

/**
 * Backup and restore (brief 80).
 *
 * Imports rather than reimplements: `FilesService` for the FS jail,
 * `ArchiveService` for the hardened tar extraction restore runs through, and
 * `SessionService` so a restore can revoke the sessions the swapped-in database
 * no longer knows about. `DbService` is global.
 */
@Module({
  imports: [FilesModule, ArchiveModule, AuthModule],
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
