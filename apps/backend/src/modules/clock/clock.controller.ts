import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ClockService } from './clock.service';
import {
  CreateAlarmDto,
  CreateWorldClockDto,
  ImportClockStateDto,
  UpdateAlarmDto,
} from './dto/clock.dto';

/**
 * Clock's persisted state. Session-guarded like every other route — the global
 * `SessionAuthGuard` covers this controller, and nothing here is `@Public()`.
 */
@Controller('clock')
export class ClockController {
  constructor(private readonly clock: ClockService) {}

  @Get('world-clocks')
  findWorldClocks() {
    return this.clock.findWorldClocks();
  }

  @Post('world-clocks')
  @HttpCode(HttpStatus.CREATED)
  createWorldClock(@Body() dto: CreateWorldClockDto) {
    return this.clock.createWorldClock(dto);
  }

  @Delete('world-clocks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeWorldClock(@Param('id', ParseIntPipe) id: number) {
    this.clock.removeWorldClock(id);
  }

  @Get('alarms')
  findAlarms() {
    return this.clock.findAlarms();
  }

  @Post('alarms')
  @HttpCode(HttpStatus.CREATED)
  createAlarm(@Body() dto: CreateAlarmDto) {
    return this.clock.createAlarm(dto);
  }

  @Patch('alarms/:id')
  updateAlarm(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAlarmDto,
  ) {
    return this.clock.updateAlarm(id, dto);
  }

  @Delete('alarms/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAlarm(@Param('id', ParseIntPipe) id: number) {
    this.clock.removeAlarm(id);
  }

  /**
   * One-time hand-over of a browser's old `localStorage` state. Idempotent by
   * construction (the service refuses to import into a non-empty table), so the
   * client may call it whenever it still finds a legacy key.
   */
  @Post('import')
  importState(@Body() dto: ImportClockStateDto) {
    return this.clock.importState(dto);
  }
}
