import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';
import { RecentController } from './recent.controller';
import { RecentService } from './recent.service';

@Module({
  controllers: [FilesController, TrashController, RecentController],
  providers: [FilesService, TrashService, RecentService],
  exports: [FilesService, TrashService],
})
export class FilesModule {}
