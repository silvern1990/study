import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AppEvents,
  type BroadcastCallAnsweredEvent,
  type BroadcastCallEndedEvent,
  type PhoneRecordedEvent,
  type WakeRequestedEvent,
} from '../common/events.js';
import type { AppConfig } from '../config/configuration.js';
import { EslClient, type EslEvent } from './esl-client.js';

/** FreeSWITCH 의 mod_hash 에 방송ID → 녹음 파일 경로를 저장하는 realm */
const HASH_REALM = 'svbs';

const SUBSCRIBED_EVENTS = [
  'CHANNEL_ANSWER',
  'CHANNEL_HANGUP_COMPLETE',
  'CUSTOM',
  'svbs::wake',
  'svbs::recorded',
];

@Injectable()
export class FreeswitchService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(FreeswitchService.name);
  private client?: EslClient;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectDelayMs = 1000;
  private shuttingDown = false;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    // FreeSWITCH 가 아직 안 떠 있어도 앱은 기동되도록 비동기로 연결
    void this.connect();
  }

  onApplicationShutdown() {
    this.shuttingDown = true;
    clearTimeout(this.reconnectTimer);
    this.client?.close();
  }

  get connected() {
    return this.client !== undefined;
  }

  async api(cmd: string): Promise<string> {
    if (!this.client) throw new Error('FreeSWITCH ESL is not connected');
    return this.client.api(cmd);
  }

  /** 방송 통화(bcast-{id})가 재생할 파일을 FreeSWITCH 에 알려준다 */
  async setBroadcastAudio(broadcastId: number, freeswitchPath: string) {
    await this.api(`hash delete/${HASH_REALM}/bcast_${broadcastId}`);
    const res = await this.api(
      `hash insert/${HASH_REALM}/bcast_${broadcastId}/${freeswitchPath}`,
    );
    if (!res.startsWith('+OK')) {
      throw new Error(`hash insert failed: ${res}`);
    }
  }

  async clearBroadcastAudio(broadcastId: number) {
    await this.api(`hash delete/${HASH_REALM}/bcast_${broadcastId}`);
  }

  private async connect() {
    const fs = this.config.get('freeswitch', { infer: true });
    const client = new EslClient({
      host: fs.eslHost,
      port: fs.eslPort,
      password: fs.eslPassword,
    });
    try {
      await client.connect();
      await client.subscribe(SUBSCRIBED_EVENTS);
    } catch (err) {
      client.close();
      this.logger.warn(
        `ESL connect failed (${fs.eslHost}:${fs.eslPort}): ${(err as Error).message}`,
      );
      this.scheduleReconnect();
      return;
    }

    this.client = client;
    this.reconnectDelayMs = 1000;
    this.logger.log(`ESL connected to ${fs.eslHost}:${fs.eslPort}`);
    client.on('event', (evt: EslEvent) => this.onEvent(evt));
    client.on('socketError', (err: Error) =>
      this.logger.warn(`ESL socket error: ${err.message}`),
    );
    client.once('close', () => {
      this.client = undefined;
      this.logger.warn('ESL connection closed');
      this.scheduleReconnect();
    });
    this.events.emit(AppEvents.FreeswitchConnected);
  }

  private scheduleReconnect() {
    if (this.shuttingDown) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.connect(), this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
  }

  private onEvent({ headers: h }: EslEvent) {
    const name = h['Event-Name'];
    const broadcastId = Number.parseInt(h['variable_svbs_broadcast_id'] ?? '', 10);
    const extension = h['variable_svbs_extension'] ?? h['Caller-Caller-ID-Number'] ?? '';

    if (name === 'CHANNEL_ANSWER' && !Number.isNaN(broadcastId)) {
      const payload: BroadcastCallAnsweredEvent = { broadcastId, extension };
      this.events.emit(AppEvents.BroadcastCallAnswered, payload);
      return;
    }

    if (name === 'CHANNEL_HANGUP_COMPLETE' && !Number.isNaN(broadcastId)) {
      const payload: BroadcastCallEndedEvent = {
        broadcastId,
        extension,
        billsec: Number.parseInt(h['variable_billsec'] ?? '0', 10) || 0,
        listenedFully: h['variable_svbs_listened_full'] === 'true',
        playCount: Number.parseInt(h['variable_svbs_play_count'] ?? '0', 10) || 0,
      };
      this.events.emit(AppEvents.BroadcastCallEnded, payload);
      return;
    }

    if (name === 'CUSTOM' && h['Event-Subclass'] === 'svbs::wake') {
      const payload: WakeRequestedEvent = {
        callee: h['callee'] ?? '',
        caller: h['caller'] ?? '',
        callUuid: h['call_uuid'] ?? '',
      };
      this.events.emit(AppEvents.WakeRequested, payload);
      return;
    }

    if (name === 'CUSTOM' && h['Event-Subclass'] === 'svbs::recorded') {
      const payload: PhoneRecordedEvent = {
        extension: h['extension'] ?? '',
        freeswitchPath: h['file'] ?? '',
      };
      this.events.emit(AppEvents.PhoneRecorded, payload);
    }
  }
}
