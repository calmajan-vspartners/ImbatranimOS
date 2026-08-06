import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ArchiveController } from './archive.controller';
import { ArchiveService } from './archive.service';

/**
 * Archive manager. Imports {@link FilesModule} to reuse `FilesService` — the
 * single source of truth for the FS jail (`resolveSafe`). Register in
 * `app.module.ts` alongside FilesModule.
 */
@Module({
  imports: [FilesModule],
  controllers: [ArchiveController],
  providers: [ArchiveService],
  exports: [ArchiveService],
})
export class ArchiveModule {}
