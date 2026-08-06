import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { DbModule } from '../../db/db.module';
import { GitController } from './git.controller';
import { GitService } from './git.service';

/**
 * Imports FilesModule to reuse its exported FilesService — specifically
 * `resolveSafe`, the FS jail — so the repo directory (used only as an execa
 * `cwd`) can never escape the home root. The jail is NOT reimplemented here.
 *
 * DbModule is for the recent-repos list only (brief 76); no git operation reads
 * or writes the database.
 */
@Module({
  imports: [FilesModule, DbModule],
  controllers: [GitController],
  providers: [GitService],
})
export class GitModule {}
