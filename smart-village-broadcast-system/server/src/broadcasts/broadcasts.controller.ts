import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { BroadcastsService } from './broadcasts.service.js';
import { BroadcastReportDto, CreateBroadcastDto } from './dto/broadcast.dto.js';

// TODO: 관리자 API 와 앱 API 의 인증/권한 분리
@Controller('broadcasts')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  /** 방송 생성 (아직 발송하지 않음) */
  @Post()
  create(@Body() dto: CreateBroadcastDto) {
    return this.broadcasts.create(dto);
  }

  @Get()
  findAll() {
    return this.broadcasts.findAll();
  }

  /** 앱: 나에게 온 방송 목록 */
  @Get('inbox/:userId')
  inbox(@Param('userId', ParseIntPipe) userId: number) {
    return this.broadcasts.inbox(userId);
  }

  /** 방송 정보 + 수신 현황 */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.broadcasts.findOne(id);
  }

  @Get(':id/targets')
  targets(@Param('id', ParseIntPipe) id: number) {
    return this.broadcasts.findTargets(id);
  }

  /** 발송 시작 (scheduledAt 이 미래면 예약) */
  @Post(':id/start')
  start(@Param('id', ParseIntPipe) id: number) {
    return this.broadcasts.start(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.broadcasts.cancel(id);
  }

  /** 앱: 수신 화면에서 받음/거절/무응답 보고 */
  @Post(':id/report')
  report(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BroadcastReportDto,
  ) {
    return this.broadcasts.report(id, dto.userId, dto.result);
  }
}
