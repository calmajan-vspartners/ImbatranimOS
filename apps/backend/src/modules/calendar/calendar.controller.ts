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
import { CalendarService } from './calendar.service';
import {
  CreateEventDto,
  ImportEventsDto,
  UpdateEventDto,
} from './dto/calendar.dto';

/**
 * Calendar events. Session-guarded like every other route — the global
 * `SessionAuthGuard` covers this controller, and nothing here is `@Public()`.
 */
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('events')
  findAll() {
    return this.calendar.findAll();
  }

  @Post('events')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateEventDto) {
    return this.calendar.create(dto);
  }

  @Patch('events/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEventDto) {
    return this.calendar.update(id, dto);
  }

  @Delete('events/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number) {
    this.calendar.remove(id);
  }

  /**
   * Bulk insert: the one-time `localStorage` hand-over (with `onlyIfEmpty`) and
   * ICS import (without it). One endpoint because the behaviour is the same apart
   * from that guard.
   */
  @Post('import')
  importEvents(@Body() dto: ImportEventsDto) {
    return this.calendar.importEvents(dto);
  }
}
