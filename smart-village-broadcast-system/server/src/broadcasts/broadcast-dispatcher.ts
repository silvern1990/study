import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { In, Not, Repository } from 'typeorm';
import {
  AppEvents,
  type BroadcastCallAnsweredEvent,
  type BroadcastCallEndedEvent,
} from '../common/events.js';
import type { AppConfig } from '../config/configuration.js';
import { FreeswitchService } from '../freeswitch/freeswitch.service.js';
import { PushProvider } from '../push/push.types.js';
import { RecordingsService } from '../recordings/recordings.service.js';
import { UsersService } from '../users/users.service.js';
import {
  BROADCAST_QUEUE,
  BroadcastJob,
  ringJobId,
  timeoutJobId,
  type RingJobData,
} from './broadcast-queue.js';
import {
  Broadcast,
  BroadcastTarget,
  TERMINAL_TARGET_STATUSES,
  type BroadcastTargetStatus,
} from './broadcast.entity.js';

/**
 * 방송 발송 상태 머신.
 * 상태 전이는 모두 "현재 상태가 X 일 때만" 조건부 UPDATE 로 처리해서
 * 푸시 응답 보고 / FreeSWITCH 이벤트 / 타임아웃 잡이 경합해도 한 번만 반영되게 한다.
 */
@Injectable()
export class BroadcastDispatcher {
  private readonly logger = new Logger(BroadcastDispatcher.name);

  constructor(
    @InjectRepository(Broadcast) private readonly broadcasts: Repository<Broadcast>,
    @InjectRepository(BroadcastTarget)
    private readonly targets: Repository<BroadcastTarget>,
    @InjectQueue(BROADCAST_QUEUE) private readonly queue: Queue,
    private readonly freeswitch: FreeswitchService,
    private readonly recordings: RecordingsService,
    private readonly users: UsersService,
    private readonly push: PushProvider,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** 방송 시작: FreeSWITCH 에 재생 파일 등록 → 대상자별 ring 잡 생성 */
  async start(broadcastId: number) {
    const broadcast = await this.broadcasts.findOneByOrFail({ id: broadcastId });
    if (!['draft', 'scheduled'].includes(broadcast.status)) {
      this.logger.warn(`broadcast #${broadcastId} is ${broadcast.status}, skip start`);
      return;
    }

    await this.freeswitch.setBroadcastAudio(
      broadcast.id,
      this.recordings.freeswitchPath(broadcast.recording),
    );
    await this.broadcasts.update(broadcast.id, {
      status: 'running',
      startedAt: new Date(),
    });

    const pending = await this.targets.find({
      select: { id: true },
      where: { broadcastId, status: 'pending' },
      order: { id: 'ASC' },
    });
    // 초당 발송량 제한: 순번에 따라 지연을 준다
    const perSecond = Math.max(
      1,
      this.config.get('broadcast.pushPerSecond', { infer: true }),
    );
    await this.queue.addBulk(
      pending.map((t, i) => ({
        name: BroadcastJob.Ring,
        data: { targetId: t.id, attempt: 1 } satisfies RingJobData,
        opts: {
          jobId: ringJobId(t.id, 1),
          delay: Math.floor(i / perSecond) * 1000,
        },
      })),
    );
    this.logger.log(`broadcast #${broadcastId} started: ${pending.length} targets`);
    await this.checkCompletion(broadcastId);
  }

  /** 대상자 한 명에게 방송 전화(푸시) 발송 */
  async ring({ targetId, attempt }: RingJobData) {
    const target = await this.targets.findOne({
      where: { id: targetId },
      relations: { broadcast: true, user: true },
    });
    if (!target || target.broadcast.status !== 'running') return;

    const moved = await this.transition(targetId, ['pending', 'retrying'], {
      status: 'ringing',
      attempts: attempt,
      lastRingAt: new Date(),
    }, { attempts: attempt - 1 });
    if (!moved) return; // 이미 처리됐거나 오래된 잡

    await this.push.send(target.user, {
      type: 'broadcast',
      broadcastId: target.broadcastId,
      title: target.broadcast.title,
      dial: `bcast-${target.broadcastId}`,
    });

    const ringTimeoutSec = this.config.get('broadcast.ringTimeoutSec', {
      infer: true,
    });
    await this.queue.add(
      BroadcastJob.RingTimeout,
      { targetId, attempt } satisfies RingJobData,
      { jobId: timeoutJobId(targetId, attempt), delay: ringTimeoutSec * 1000 },
    );
  }

  async ringTimeout({ targetId, attempt }: RingJobData) {
    const target = await this.targets.findOneBy({ id: targetId });
    if (target?.status === 'ringing' && target.attempts === attempt) {
      await this.handleUnanswered(target, 'no-answer');
    }
  }

  /** 앱이 보고한 수신 화면에서의 행동 */
  async report(
    broadcastId: number,
    userId: number,
    result: 'accepted' | 'rejected' | 'missed',
  ) {
    const target = await this.targets.findOneBy({ broadcastId, userId });
    if (!target) return null;
    if (result === 'accepted') {
      await this.transition(target.id, ['ringing', 'retrying'], {
        status: 'answered',
        answeredAt: new Date(),
      });
    } else if (target.status === 'ringing') {
      await this.handleUnanswered(target, result);
    }
    return this.targets.findOneBy({ id: target.id });
  }

  @OnEvent(AppEvents.BroadcastCallAnswered, { async: true, suppressErrors: true })
  async onCallAnswered(evt: BroadcastCallAnsweredEvent) {
    const target = await this.findTargetByExtension(evt.broadcastId, evt.extension);
    if (!target) return;
    await this.transition(target.id, ['pending', 'ringing', 'retrying'], {
      status: 'answered',
      answeredAt: new Date(),
    });
  }

  @OnEvent(AppEvents.BroadcastCallEnded, { async: true, suppressErrors: true })
  async onCallEnded(evt: BroadcastCallEndedEvent) {
    const target = await this.findTargetByExtension(evt.broadcastId, evt.extension);
    if (!target) return;
    const moved = await this.transition(
      target.id,
      ['pending', 'ringing', 'retrying', 'answered'],
      {
        status: evt.listenedFully ? 'completed' : 'partial',
        answeredAt: target.answeredAt ?? new Date(),
        listenedSec: evt.billsec,
        listenedFully: evt.listenedFully,
        playCount: evt.playCount,
      },
    );
    if (moved) await this.checkCompletion(evt.broadcastId);
  }

  /** FreeSWITCH 재시작 시 mod_hash 가 비므로 진행 중인 방송 파일을 다시 등록 */
  @OnEvent(AppEvents.FreeswitchConnected, { async: true, suppressErrors: true })
  async onFreeswitchConnected() {
    const running = await this.broadcasts.findBy({ status: 'running' });
    for (const b of running) {
      await this.freeswitch.setBroadcastAudio(
        b.id,
        this.recordings.freeswitchPath(b.recording),
      );
    }
    if (running.length) {
      this.logger.log(`re-registered ${running.length} running broadcast(s)`);
    }
  }

  async cancel(broadcastId: number) {
    await this.targets.update(
      { broadcastId, status: Not(In(TERMINAL_TARGET_STATUSES)) },
      { status: 'cancelled' },
    );
    await this.broadcasts.update(broadcastId, {
      status: 'cancelled',
      completedAt: new Date(),
    });
    await this.freeswitch.clearBroadcastAudio(broadcastId).catch(() => undefined);
  }

  private async handleUnanswered(target: BroadcastTarget, reason: string) {
    const broadcast = await this.broadcasts.findOneByOrFail({
      id: target.broadcastId,
    });

    if (target.attempts < broadcast.maxAttempts) {
      const moved = await this.transition(target.id, ['ringing'], {
        status: 'retrying',
      });
      if (!moved) return;
      const next = target.attempts + 1;
      await this.queue.add(
        BroadcastJob.Ring,
        { targetId: target.id, attempt: next } satisfies RingJobData,
        { jobId: ringJobId(target.id, next), delay: broadcast.retryDelaySec * 1000 },
      );
      this.logger.debug(
        `target #${target.id} ${reason} → retry ${next}/${broadcast.maxAttempts}`,
      );
      return;
    }

    const moved = await this.transition(target.id, ['ringing'], {
      status: 'missed',
    });
    if (!moved) return;
    const user = await this.users.findOne(target.userId);
    // 끝내 못 받은 사람에게는 일반 알림으로 다시 듣기 안내
    await this.push.send(user, {
      type: 'notice',
      title: `[마을방송] ${broadcast.title}`,
      body: '받지 못한 방송이 있습니다. 눌러서 다시 들어보세요.',
      broadcastId: broadcast.id,
    });
    await this.checkCompletion(broadcast.id);
  }

  private async checkCompletion(broadcastId: number) {
    const remaining = await this.targets.countBy({
      broadcastId,
      status: Not(In(TERMINAL_TARGET_STATUSES)),
    });
    if (remaining > 0) return;
    const result = await this.broadcasts.update(
      { id: broadcastId, status: 'running' },
      { status: 'completed', completedAt: new Date() },
    );
    if (result.affected) {
      await this.freeswitch.clearBroadcastAudio(broadcastId).catch(() => undefined);
      this.logger.log(`broadcast #${broadcastId} completed`);
    }
  }

  private async findTargetByExtension(broadcastId: number, extension: string) {
    const user = await this.users.findByExtension(extension);
    if (!user) return null;
    // 대상이 아닌 사용자가 bcast-{id} 로 전화한 경우는 무시
    return this.targets.findOneBy({ broadcastId, userId: user.id });
  }

  /** 조건부 상태 전이. 반영됐으면 true */
  private async transition(
    targetId: number,
    from: BroadcastTargetStatus[],
    changes: Partial<BroadcastTarget>,
    extraWhere: Partial<Pick<BroadcastTarget, 'attempts'>> = {},
  ) {
    const result = await this.targets.update(
      { id: targetId, status: In(from), ...extraWhere },
      changes,
    );
    return (result.affected ?? 0) > 0;
  }
}
