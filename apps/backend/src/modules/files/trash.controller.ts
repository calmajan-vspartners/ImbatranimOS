import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { TrashService, type TrashEntry } from './trash.service';

/**
 * Trash routes.
 *
 * No `@Public()` anywhere: these read and move the user's files, so they sit
 * behind the same global session guard as the rest of the files surface.
 */
@Controller('files/trash')
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @Get()
  list(): Promise<TrashEntry[]> {
    return this.trash.list();
  }

  @Post(':id/restore')
  restore(@Param('id') id: string): Promise<{ path: string }> {
    return this.trash.restore(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.trash.remove(id);
  }

  @Delete()
  empty(): Promise<{ removed: number }> {
    return this.trash.empty();
  }
}
