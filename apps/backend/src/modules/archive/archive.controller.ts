import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ArchiveService } from './archive.service';
import { CompressDto, ExtractDto, ListDto } from './dto/archive.dto';

/**
 * Archive extract/compress, run server-side inside the FS jail. Authenticated
 * by the global {@link SessionAuthGuard} (no `@Public()`); mutating POSTs also
 * pass the guard's Origin/CSRF check.
 */
@Controller('archive')
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  /** GET /api/archive/list?root=&path= → what is inside, extracting nothing */
  @Get('list')
  list(@Query() q: ListDto) {
    return this.archive.list(q.root, q.path);
  }

  /** POST /api/archive/extract { root, path, dest?, entries? } → result */
  @Post('extract')
  extract(@Body() dto: ExtractDto) {
    return this.archive.extract(dto.root, dto.path, dto.dest, dto.entries);
  }

  /**
   * POST /api/archive/extract-job { … } → { id }
   *
   * Same work as `extract`, but returns immediately with an id to poll. For a
   * large archive the synchronous call is indistinguishable from a hang.
   */
  @Post('extract-job')
  extractJob(@Body() dto: ExtractDto) {
    return this.archive.startExtractJob(
      dto.root,
      dto.path,
      dto.dest,
      dto.entries,
    );
  }

  /** GET /api/archive/job/:id → progress, result, or the failure message */
  @Get('job/:id')
  job(@Param('id') id: string) {
    return this.archive.getJob(id);
  }

  /** POST /api/archive/compress { root, paths[], dest, format } → { dest, entries, bytes } */
  @Post('compress')
  compress(@Body() dto: CompressDto) {
    return this.archive.compress(dto.root, dto.paths, dto.dest, dto.format);
  }
}
