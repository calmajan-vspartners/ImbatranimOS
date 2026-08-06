import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Request, Response } from 'express';
import { basename } from 'path';
import { tmpdir } from 'os';
import { pipeline } from 'node:stream';
import * as fs from 'fs/promises';
import { FilesService } from './files.service';
import { TrashService } from './trash.service';
import { MulterExceptionFilter } from './multer-exception.filter';
import {
  WriteContentDto,
  CreateDirectoryDto,
  MoveDto,
  CopyDto,
  ListQueryDto,
  RootPathQueryDto,
  SearchQueryDto,
} from './dto/files.dto';

/**
 * Upload size cap (bytes). Env-overridable; defaults to 100 MB. Uploads over
 * this are rejected by multer before they reach the service.
 */
const MAX_UPLOAD_BYTES =
  Number(process.env.FILES_MAX_UPLOAD_BYTES) || 100 * 1024 * 1024;

@Controller('files')
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly trashService: TrashService,
  ) {}

  /** GET /api/files?root=&path=  → Entry[] */
  @Get()
  list(@Query() q: ListQueryDto) {
    return this.filesService.list(q.root, q.path ?? '');
  }

  /**
   * GET /api/files/search?root=&query=&content= → { items, truncated }
   *
   * Authed by the global SessionAuthGuard (no `@Public()`). Jailed + bounded in
   * the service — see {@link FilesService.search}.
   */
  /**
   * Recursive size of a directory. Bounded like search — a huge tree returns a
   * floor with `truncated: true` rather than hanging. Consumed by Settings →
   * Storage and (per brief 55) file-manager Properties: one implementation,
   * two consumers.
   */
  @Get('size')
  dirSize(@Query() q: RootPathQueryDto) {
    return this.filesService.dirSize(q.root, q.path);
  }

  @Get('search')
  search(@Query() q: SearchQueryDto) {
    return this.filesService.search(q.root, q.query, { content: q.content });
  }

  /** GET /api/files/content?root=&path= → { path, content } (text) */
  @Get('content')
  content(@Query() q: RootPathQueryDto) {
    return this.filesService.readFile(q.root, q.path);
  }

  /**
   * GET /api/files/download?root=&path= → raw binary stream.
   *
   * Honors HTTP Range requests (206 Partial Content + Content-Range) so the
   * media player can seek: without this the browser only ever receives the
   * whole file from byte 0 and can't jump to an unbuffered position. The Files
   * "Download" button issues a plain (range-less) GET and still gets a 200.
   */
  @Get('download')
  async download(
    @Query() q: RootPathQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { abs, size } = await this.filesService.statFile(q.root, q.path);
    const filename = basename(q.path);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${sanitizeHeaderFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');

    const range = parseRangeHeader(req.headers.range, size);
    if (range === 'unsatisfiable') {
      res.setHeader('Content-Range', `bytes */${size}`);
      res.status(416).end();
      return;
    }
    if (range) {
      res.status(206);
      res.setHeader(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${size}`,
      );
      res.setHeader('Content-Length', range.end - range.start + 1);
      // stream.pipeline (not bare .pipe): a source 'error' with no listener
      // would otherwise throw and crash the process, and a client abort would
      // leak the file descriptor. pipeline destroys both ends on any error.
      pipeline(
        this.filesService.openRange(abs, range.start, range.end),
        res,
        noop,
      );
      return;
    }

    res.setHeader('Content-Length', size);
    // Open the whole file straight from the already-jailed absolute path — no
    // redundant re-resolve + re-stat — and pipe through stream.pipeline.
    pipeline(this.filesService.openFile(abs), res, noop);
  }

  /** POST /api/files/upload  multipart: root, path, file → Entry */
  @Post('upload')
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      // Stream the upload straight to a temp file on disk instead of buffering
      // the whole thing in the heap; the service moves it into the jail.
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async upload(
    @UploadedFile() file: { path: string; originalname: string },
    @Body('root') root: string,
    @Body('path') path: string,
  ) {
    if (!root || !file) {
      // The early throw skips uploadFile's finally cleanup, so multer's temp
      // file would be orphaned. Remove it here before rejecting.
      if (file) await fs.rm(file.path, { force: true });
      throw new BadRequestException('root and file required');
    }
    const virtualPath = path || file.originalname;
    return this.filesService.uploadFile(root, virtualPath, file.path);
  }

  /** PUT /api/files/content  body: { root, path, content } → Entry */
  @Put('content')
  writeContent(@Body() dto: WriteContentDto) {
    return this.filesService.writeFile(dto.root, dto.path, dto.content);
  }

  /** POST /api/files/directory  body: { root, path } → Entry */
  @Post('directory')
  createDirectory(@Body() dto: CreateDirectoryDto) {
    return this.filesService.createDirectory(dto.root, dto.path);
  }

  /** POST /api/files/move  body: { root, from, to } → Entry */
  @Post('move')
  move(@Body() dto: MoveDto) {
    return this.filesService.move(dto.root, dto.from, dto.to);
  }

  /** POST /api/files/copy  body: { root, from, to } → Entry */
  @Post('copy')
  copy(@Body() dto: CopyDto) {
    return this.filesService.copy(dto.root, dto.from, dto.to);
  }

  /** DELETE /api/files?root=&path= → 204 */
  /**
   * `?trash=1` moves the entry to the Trash instead of unlinking it; without
   * it the old permanent behaviour is unchanged, which is what Shift+Delete
   * and the `notes` root still use.
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteItem(
    @Query() q: RootPathQueryDto,
    @Query('trash') trash?: string,
  ) {
    if (trash === '1' && q.root === 'home') {
      await this.trashService.trash(q.path);
      return;
    }
    await this.filesService.delete(q.root, q.path);
  }
}

/**
 * Make a filename safe to embed in the quoted `filename=` parameter: drop
 * characters that would break the quoting or inject header structure. The
 * unrestricted UTF-8 name still travels in the `filename*=` parameter, which
 * modern browsers prefer.
 */
/**
 * stream.pipeline completion callback for the download route. Headers are
 * already sent by the time a stream can error (a client abort surfaces as
 * ERR_STREAM_PREMATURE_CLOSE), so there is nothing to respond with — pipeline
 * has already destroyed both ends. Swallow it rather than rethrow.
 */
function noop(): void {
  // intentionally empty
}

function sanitizeHeaderFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/["\\\x00-\x1f]/g, '_');
}

/**
 * Parse a single-range `Range: bytes=…` header against a known file size.
 * Returns the inclusive byte range to serve, `null` when there is no usable
 * range (serve the whole file with 200), or `'unsatisfiable'` when the range
 * is syntactically valid but outside the file (answer 416). Multi-range
 * requests are intentionally ignored (treated as no range) — the media player
 * only ever asks for one.
 */
function parseRangeHeader(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return null;

  let start: number;
  let end: number;
  if (startStr === '') {
    // Suffix form `bytes=-N`: the last N bytes.
    const suffix = Number(endStr);
    if (suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1);
  }
  if (start > end || start >= size || start < 0) return 'unsatisfiable';
  return { start, end };
}
