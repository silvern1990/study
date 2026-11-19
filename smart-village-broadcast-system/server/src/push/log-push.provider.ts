import { Injectable, Logger } from '@nestjs/common';
import type { User } from '../users/user.entity.js';
import { PushProvider, type PushPayload } from './push.types.js';

/**
 * 개발용: 실제로 보내지 않고 로그만 남긴다.
 * TODO: ApnsPushProvider(PushKit VoIP + 일반), FcmPushProvider 구현 후 PushModule 에서 교체
 */
@Injectable()
export class LogPushProvider extends PushProvider {
  private readonly logger = new Logger('Push');

  send(user: User, payload: PushPayload): Promise<void> {
    const isCall = payload.type === 'broadcast' || payload.type === 'call';
    const token =
      user.pushPlatform === 'ios' && isCall ? user.voipPushToken : user.pushToken;
    this.logger.log(
      `→ user#${user.id}(${user.extension}) [${user.pushPlatform ?? 'no-platform'}:${token ? 'token' : 'NO TOKEN'}] ${JSON.stringify(payload)}`,
    );
    return Promise.resolve();
  }
}
