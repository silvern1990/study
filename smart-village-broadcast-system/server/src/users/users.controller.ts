import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { CreateUserDto, UpdatePushTokenDto } from './dto/user.dto.js';
import { UsersService } from './users.service.js';

// TODO: 인증/인가. 지금은 PoC 라 누구나 호출 가능하다.
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** 사용자 생성 + SIP 계정 발급 */
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.users.findOne(id);
  }

  /** 앱 로그인 후 SIP 접속 정보 조회 */
  @Get(':id/sip-config')
  sipConfig(@Param('id', ParseIntPipe) id: number) {
    return this.users.getSipConfig(id);
  }

  /** 앱 실행 시 푸시 토큰 등록/갱신 */
  @Put(':id/push-token')
  updatePushToken(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePushTokenDto,
  ) {
    return this.users.updatePushToken(id, dto);
  }
}
