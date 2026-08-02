import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

@Module({
  controllers: [FilesController, TrashController],
  providers: [FilesService, TrashService],
  exports: [FilesService, TrashService],
})
export class FilesModule {}
