import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { LogService } from './log.service';
import { ClientErrorDto, LogQueryDto } from './dto/logs.dto';

/**
 * Read the system log, and let the browser report its own crashes (brief 84).
 *
 * Authed by the global `SessionAuthGuard`; neither route carries `@Public()`.
 * That is not boilerplate here — **log content is as sensitive as the events it
 * records**. It names the IPs that tried to log in, which files were deleted and
 * when the machine was restored, so an unauthenticated read would be a
 * reconnaissance endpoint for the exact attacker the log exists to catch.
 */
@Controller('logs')
export class LogsController {
  constructor(private readonly logs: LogService) {}

  /** GET /api/logs?level=&q=&limit= → the tail, newest first */
  @Get()
  tail(@Query() q: LogQueryDto) {
    return this.logs.tail({ level: q.level, q: q.q, limit: q.limit });
  }

  /**
   * POST /api/logs/client-error { appId, message } → { recorded }
   *
   * Brief 47's error boundary calls this so a crashed app leaves a trace the user
   * can find later, rather than only a toast they may have missed. `recorded:
   * false` means the per-process budget is spent — a render loop cannot turn the
   * browser into a disk-filling tool, and the honest answer to "did you write
   * it" is no rather than a silent success.
   */
  @Post('client-error')
  @HttpCode(HttpStatus.OK)
  clientError(@Body() dto: ClientErrorDto) {
    const recorded = this.logs.recordFromClient(
      'app.crashed',
      `${dto.appId} crashed`,
      { appId: dto.appId, message: dto.message },
    );
    return { recorded };
  }
}
