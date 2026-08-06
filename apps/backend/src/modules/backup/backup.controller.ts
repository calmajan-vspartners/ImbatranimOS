import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import type { Request, Response } from 'express';
import { MulterExceptionFilter } from '../files/multer-exception.filter';
import { SESSION_COOKIE_NAME } from '../auth/auth.constants';
import { BackupService } from './backup.service';
import { RestoreApplyDto } from './dto/backup.dto';

/**
 * Upload cap for a restore, in bytes. Deliberately its own knob rather than the
 * file-manager's 100 MB: a backup of a real home volume is routinely larger than
 * any single file a user uploads, and sharing the cap would make restore fail on
 * exactly the machines that most need it.
 */
const MAX_BACKUP_UPLOAD_BYTES =
  Number(process.env.BACKUP_MAX_UPLOAD_BYTES) || 4 * 1024 * 1024 * 1024;

/**
 * Back up and restore the home volume (brief 80).
 *
 * Every route is authenticated by the global `SessionAuthGuard`; none carries
 * `@Public()`. This is the most security-sensitive controller in the OS — the
 * download is the whole machine in one file — so it is worth writing down why
 * there is no second password prompt on it: the archive contains nothing the
 * session cannot already read. `db.sqlite`, credential hash and TOTP secret
 * included, sits inside the home volume and is already reachable through
 * `/api/files`. A re-prompt here would be theatre. Restore is different, and
 * does require a typed confirmation, because it is destructive rather than
 * merely revealing.
 */
@Controller('backup')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  /** GET /api/backup/info → sizes and exclusions, before committing to a download */
  @Get('info')
  info() {
    return this.backup.info();
  }

  /**
   * GET /api/backup → streams `imbatranim-home-YYYY-MM-DD.tar.gz`.
   *
   * Chunked, with no `Content-Length`: the size is not known until tar has
   * finished, and buffering the archive to learn it would defeat the point.
   */
  @Get()
  async download(@Res() res: Response): Promise<void> {
    const backup = await this.backup.openBackupStream();
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${backup.filename}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    // A proxy that buffered this would reintroduce the disk/memory cost the
    // streaming design exists to avoid.
    res.setHeader('X-Accel-Buffering', 'no');

    backup.stream.pipe(res);
    try {
      await backup.done;
    } catch {
      // Headers are already out, so the status cannot be changed. Destroying the
      // socket truncates the gzip stream, which fails its own CRC at the client
      // — a partial backup can never look like a complete one.
      res.destroy();
    } finally {
      await backup.dispose();
    }
  }

  /**
   * POST /api/backup/restore/inspect (multipart `file`) → what a restore would do.
   *
   * Two steps rather than one so the manifest, the date and the list of things
   * that would be replaced can be shown *before* the user commits — and so the
   * archive is uploaded once, not twice.
   */
  @Post('restore/inspect')
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: MAX_BACKUP_UPLOAD_BYTES },
    }),
  )
  inspect(@UploadedFile() file?: { path: string }) {
    if (!file) throw new BadRequestException('Choose a backup file to restore');
    return this.backup.inspect(file.path);
  }

  /** POST /api/backup/restore/apply { id, confirm: 'RESTORE' } → what was restored */
  @Post('restore/apply')
  @HttpCode(HttpStatus.OK)
  async apply(
    @Body() dto: RestoreApplyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.backup.apply(dto.id);
    // Every session was revoked with the database swap. Clearing the cookie here
    // means the browser is not left holding a token that now belongs to nothing,
    // and the UI can send the user straight to the lock screen.
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      sameSite: 'lax',
      path: '/',
    });
    return { ...result, signedOut: true };
  }
}
