import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { IsNull, Not, Repository } from 'typeorm';
import type { AppConfig } from '../config/configuration.js';
import { FreeswitchService } from '../freeswitch/freeswitch.service.js';
import { RecordingsService } from '../recordings/recordings.service.js';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { BroadcastDispatcher } from './broadcast-dispatcher.js';
import {
  BROADCAST_QUEUE,
  BroadcastJob,
  startJobId,
  type StartJobData,
} from './broadcast-queue.js';
import { Broadcast, BroadcastTarget } from './broadcast.entity.js';
import { CreateBroadcastDto } from './dto/broadcast.dto.js';

@Injectable()
export class BroadcastsService {
  constructor(
    @InjectRepository(Broadcast) private readonly broadcasts: Repository<Broadcast>,
    @InjectRepository(BroadcastTarget)
    private readonly targets: Repository<BroadcastTarget>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectQueue(BROADCAST_QUEUE) private readonly queue: Queue,
    private readonly dispatcher: BroadcastDispatcher,
    private readonly recordings: RecordingsService,
    private readonly users: UsersService,
    private readonly freeswitch: FreeswitchService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async create(dto: CreateBroadcastDto) {
    await this.recordings.findOne(dto.recordingId);

    const recipients = dto.userIds
      ? await this.users.findByIds(dto.userIds)
      : await this.userRepo.findBy({ extension: Not(IsNull()) });
    if (dto.userIds && recipients.length !== new Set(dto.userIds).size) {
      throw new BadRequestException('some userIds do not exist');
    }
    if (recipients.length === 0) {
      throw new BadRequestException('no recipients');
    }

    const defaults = this.config.get('broadcast', { infer: true });
    const broadcast = await this.broadcasts.save(
      this.broadcasts.create({
        title: dto.title,
        recordingId: dto.recordingId,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        maxAttempts: dto.maxAttempts ?? defaults.defaultMaxAttempts,
        retryDelaySec: dto.retryDelaySec ?? defaults.defaultRetryDelaySec,
        createdById: dto.createdById ?? null,
      }),
    );
    await this.targets.insert(
      recipients.map((u) => ({ broadcastId: broadcast.id, userId: u.id })),
    );
    return this.findOne(broadcast.id);
  }

  /** 즉시 시작하거나, scheduledAt 이 미래면 예약 */
  async start(id: number) {
    const broadcast = await this.findEntity(id);
    if (broadcast.status !== 'draft') {
      throw new ConflictException(`broadcast is ${broadcast.status}`);
    }

    const delay = broadcast.scheduledAt
      ? broadcast.scheduledAt.getTime() - Date.now()
      : 0;
    if (delay > 0) {
      await this.broadcasts.update(id, { status: 'scheduled' });
      await this.queue.add(
        BroadcastJob.Start,
        { broadcastId: id } satisfies StartJobData,
        {
          jobId: startJobId(id),
          delay,
          attempts: 5,
          backoff: { type: 'exponential', delay: 10_000 },
        },
      );
    } else {
      if (!this.freeswitch.connected) {
        throw new ServiceUnavailableException('FreeSWITCH is not connected');
      }
      await this.dispatcher.start(id);
    }
    return this.findOne(id);
  }

  async cancel(id: number) {
    const broadcast = await this.findEntity(id);
    if (['completed', 'cancelled'].includes(broadcast.status)) {
      throw new ConflictException(`broadcast is ${broadcast.status}`);
    }
    await this.queue.remove(startJobId(id));
    await this.dispatcher.cancel(id);
    return this.findOne(id);
  }

  findAll() {
    return this.broadcasts.find({ order: { id: 'DESC' }, take: 100 });
  }

  /** 방송 정보 + 상태별 대상자 수 */
  async findOne(id: number) {
    const broadcast = await this.findEntity(id);
    const rows = await this.targets
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .where('t.broadcastId = :id', { id })
      .groupBy('t.status')
      .getRawMany<{ status: string; count: number }>();
    const stats = Object.fromEntries(rows.map((r) => [r.status, r.count]));
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return Object.assign(broadcast, { stats: { total, ...stats } });
  }

  async findTargets(id: number) {
    await this.findEntity(id);
    return this.targets.find({
      where: { broadcastId: id },
      relations: { user: true },
      order: { id: 'ASC' },
    });
  }

  /** 앱의 방송함: 나에게 온 방송 목록 (다시 듣기용) */
  async inbox(userId: number) {
    const rows = await this.targets.find({
      where: { userId },
      relations: { broadcast: true },
      order: { id: 'DESC' },
      take: 50,
    });
    return rows.map((t) => ({
      broadcastId: t.broadcastId,
      title: t.broadcast.title,
      recordingId: t.broadcast.recordingId,
      durationSec: t.broadcast.recording.durationSec,
      sentAt: t.broadcast.startedAt,
      status: t.status,
      listenedFully: t.listenedFully,
    }));
  }

  report(id: number, userId: number, result: 'accepted' | 'rejected' | 'missed') {
    return this.dispatcher.report(id, userId, result).then((target) => {
      if (!target) throw new NotFoundException('not a target of this broadcast');
      return target;
    });
  }

  private async findEntity(id: number) {
    const broadcast = await this.broadcasts.findOneBy({ id });
    if (!broadcast) throw new NotFoundException(`broadcast ${id} not found`);
    return broadcast;
  }
}
