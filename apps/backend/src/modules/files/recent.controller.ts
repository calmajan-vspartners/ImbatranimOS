import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { RecentService, type RecentFile } from './recent.service';
import { RecordRecentDto, RemoveRecentQueryDto } from './dto/recent.dto';

/**
 * OS-wide recent files (brief 94). Session-authed by the global guard.
 * `DELETE /files/recent/all` is a separate route rather than "DELETE with no
 * params" so clearing everything can never be an accidental validation hole.
 */
@Controller('files/recent')
export class RecentController {
  constructor(private readonly recent: RecentService) {}

  @Get()
  list(): RecentFile[] {
    return this.recent.list();
  }

  @Post()
  @HttpCode(204)
  record(@Body() dto: RecordRecentDto): void {
    this.recent.record(dto.root, dto.path, dto.appId);
  }

  @Delete('all')
  @HttpCode(204)
  clear(): void {
    this.recent.clear();
  }

  @Delete()
  @HttpCode(204)
  remove(@Query() query: RemoveRecentQueryDto): void {
    this.recent.remove(query.root, query.path);
  }
}
