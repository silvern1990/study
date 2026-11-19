import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config/configuration.js';
import { UsersService } from '../users/users.service.js';
import { buildDirectoryXml, NOT_FOUND_XML } from './directory-xml.js';

/**
 * mod_xml_curl 의 directory 바인딩이 호출하는 엔드포인트.
 * SIP REGISTER/INVITE 인증, user/<ext> 다이얼 시 FreeSWITCH 가 사용자 정보를 물어본다.
 */
@ApiExcludeController()
@Controller('freeswitch')
export class DirectoryController {
  private readonly logger = new Logger(DirectoryController.name);

  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Post('directory')
  @HttpCode(200)
  async directory(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    this.assertAuthorized(authorization);
    res.type('text/xml');

    const user = body['user'];
    const domain = body['domain'];
    if (body['section'] !== 'directory' || !user || !domain) {
      res.send(NOT_FOUND_XML);
      return;
    }

    const found = await this.users.findByExtensionWithSecret(user);
    if (!found?.extension) {
      this.logger.debug(`directory miss: ${user}@${domain} (${body['action']})`);
      res.send(NOT_FOUND_XML);
      return;
    }

    res.send(
      buildDirectoryXml(domain, {
        extension: found.extension,
        password: found.sipPassword,
        name: found.name,
        role: found.role,
      }),
    );
  }

  private assertAuthorized(authorization: string | undefined) {
    const fs = this.config.get('freeswitch', { infer: true });
    const expected = Buffer.from(
      `Basic ${Buffer.from(`${fs.xmlCurlUser}:${fs.xmlCurlPassword}`).toString('base64')}`,
    );
    const actual = Buffer.from(authorization ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException();
    }
  }
}
