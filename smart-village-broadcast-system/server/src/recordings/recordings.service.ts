import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, join, posix, resolve } from 'node:path';
import { Repository } from 'typeorm';
import { AppEvents, type PhoneRecordedEvent } from '../common/events.js';
import type { AppConfig } from '../config/configuration.js';
import { UsersService } from '../users/users.service.js';
import { convertToWav, probeDurationSec } from './audio.js';
import { Recording } from './recording.entity.js';

@Injectable()
export class RecordingsService implements OnModuleInit {
  private readonly logger = new Logger(RecordingsService.name);
  private readonly dir: string;
  private readonly freeswitchDir: string;

  constructor(
    @InjectRepository(Recording) private readonly recordings: Repository<Recording>,
    private readonly users: UsersService,
    config: ConfigService<AppConfig, true>,
  ) {
    const rec = config.get('recordings', { infer: true });
    this.dir = resolve(rec.dir);
    this.freeswitchDir = rec.freeswitchDir;
  }

  async onModuleInit() {
    await mkdir(join(this.dir, 'upload'), { recursive: true });
    await mkdir(join(this.dir, 'phone'), { recursive: true });
  }

  /** 관리자 웹/앱에서 업로드한 녹음 (webm, m4a, mp3 등) */
  async createFromUpload(
    file: Express.Multer.File,
    title: string,
    createdById?: number,
  ) {
    const filename = posix.join('upload', `${randomUUID()}.wav`);
    const output = join(this.dir, filename);
    try {
      await convertToWav(file.path, output);
    } finally {
      await rm(file.path, { force: true });
    }
    const durationSec = await probeDurationSec(output);
    return this.recordings.save(
      this.recordings.create({
        title,
        filename,
        durationSec,
        source: 'upload',
        createdById: createdById ?? null,
      }),
    );
  }

  /** 관리자가 *700 으로 전화 녹음한 경우 (record.lua → svbs::recorded) */
  @OnEvent(AppEvents.PhoneRecorded, { async: true, suppressErrors: true })
  async onPhoneRecorded(evt: PhoneRecordedEvent) {
    const filename = posix.join('phone', basename(evt.freeswitchPath));
    const user = await this.users.findByExtension(evt.extension);
    const durationSec = await probeDurationSec(join(this.dir, filename)).catch(
      () => 0,
    );
    const recording = await this.recordings.save(
      this.recordings.create({
        title: `전화 녹음 ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
        filename,
        durationSec,
        source: 'phone',
        createdById: user?.id ?? null,
      }),
    );
    this.logger.log(`phone recording saved: #${recording.id} ${filename}`);
  }

  findAll() {
    return this.recordings.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const recording = await this.recordings.findOneBy({ id });
    if (!recording) throw new NotFoundException(`recording ${id} not found`);
    return recording;
  }

  /** FreeSWITCH 컨테이너 안에서 보이는 경로 */
  freeswitchPath(recording: Recording) {
    return posix.join(this.freeswitchDir, recording.filename);
  }

  openStream(recording: Recording) {
    return createReadStream(join(this.dir, recording.filename));
  }
}
