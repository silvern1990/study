import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { In, Repository } from 'typeorm';
import type { AppConfig } from '../config/configuration.js';
import { CreateUserDto, UpdatePushTokenDto } from './dto/user.dto.js';
import { User } from './user.entity.js';

/** 내선번호는 2로 시작 (FreeSWITCH dialplan 의 ^(2\d{4,6})$ 와 맞춰야 함) */
const EXTENSION_BASE = 20000;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async create(dto: CreateUserDto) {
    const user = await this.users.save(
      this.users.create({
        name: dto.name,
        phone: dto.phone ?? null,
        role: dto.role ?? 'resident',
        sipPassword: randomBytes(12).toString('base64url'),
      }),
    );
    user.extension = String(EXTENSION_BASE + user.id);
    await this.users.update(user.id, { extension: user.extension });
    return this.getSipConfig(user.id);
  }

  findAll() {
    return this.users.find({ order: { id: 'ASC' } });
  }

  async findOne(id: number) {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException(`user ${id} not found`);
    return user;
  }

  findByIds(ids: number[]) {
    return this.users.findBy({ id: In(ids) });
  }

  findByExtension(extension: string) {
    return this.users.findOneBy({ extension });
  }

  /** FreeSWITCH 디렉터리 조회용: 비밀번호 포함 */
  findByExtensionWithSecret(extension: string) {
    return this.users
      .createQueryBuilder('u')
      .addSelect('u.sipPassword')
      .where('u.extension = :extension', { extension })
      .getOne();
  }

  /** 앱이 SIP 클라이언트를 설정할 때 받아가는 정보 */
  async getSipConfig(id: number) {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.sipPassword')
      .where('u.id = :id', { id })
      .getOne();
    if (!user) throw new NotFoundException(`user ${id} not found`);
    const fs = this.config.get('freeswitch', { infer: true });
    return {
      userId: user.id,
      name: user.name,
      role: user.role,
      extension: user.extension,
      sipPassword: user.sipPassword,
      sipDomain: fs.sipDomain,
      sipWsUrl: fs.sipWsUrl,
      broadcastDialPrefix: 'bcast-',
    };
  }

  async updatePushToken(id: number, dto: UpdatePushTokenDto) {
    await this.findOne(id);
    await this.users.update(id, {
      pushPlatform: dto.platform,
      pushToken: dto.pushToken ?? null,
      voipPushToken: dto.voipPushToken ?? null,
    });
    return this.findOne(id);
  }
}
