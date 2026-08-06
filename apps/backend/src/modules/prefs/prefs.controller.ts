import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import { PrefsService } from './prefs.service';
import { PutPrefsDto } from './dto/prefs.dto';

/**
 * The dotfile store (brief 49).
 *
 * Authed by the global `SessionAuthGuard`; no `@Public()`. Your wallpaper is not
 * a secret, but the disabled-app set and icon layout describe how the machine is
 * used, and a route that lets an unauthenticated caller **write** them could
 * rearrange someone's desktop from across the internet.
 */
@Controller('prefs')
export class PrefsController {
  constructor(private readonly prefs: PrefsService) {}

  /** GET /api/prefs → { [key]: serialisedJson } */
  @Get()
  all() {
    return this.prefs.all();
  }

  /** PUT /api/prefs { entries: [{ key, value }] } → { written } */
  @Put()
  @HttpCode(HttpStatus.OK)
  put(@Body() dto: PutPrefsDto) {
    return this.prefs.put(dto.entries);
  }

  /** DELETE /api/prefs/:key — reset one dotfile to its built-in default */
  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('key') key: string) {
    this.prefs.remove(key);
  }
}
