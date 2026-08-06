import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { ClaimDto } from './dto/claim.dto';

/**
 * Brief 93. One route: claim an occurrence before toasting it. Session-authed
 * by the global guard like everything else.
 */
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  @Post('claim')
  @HttpCode(200)
  claim(@Body() dto: ClaimDto): { claimed: boolean } {
    return {
      claimed: this.schedule.claim(dto.domain, dto.itemId, dto.occurrenceMs),
    };
  }
}
