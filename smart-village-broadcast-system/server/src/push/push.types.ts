import type { User } from '../users/user.entity.js';

export type PushPayload =
  /** 방송 수신 화면을 띄운다. 응답하면 앱이 `dial` 번호로 발신한다. */
  | { type: 'broadcast'; broadcastId: number; title: string; dial: string }
  /** 1:1 통화 수신 화면을 띄우고 SIP 등록을 하게 한다. */
  | { type: 'call'; caller: string; callUuid: string }
  /** 일반 알림 (방송을 끝내 못 받은 사람에게 다시 듣기 안내 등) */
  | { type: 'notice'; title: string; body: string; broadcastId?: number };

/**
 * 실제 발송 구현체. APNs(VoIP/일반), FCM 구현을 여기에 연결한다.
 * - payload.type 이 'broadcast' | 'call' 이면 iOS 는 VoIP(PushKit) 토큰으로,
 *   Android 는 FCM high priority data 메시지로 보내야 한다.
 */
export abstract class PushProvider {
  abstract send(user: User, payload: PushPayload): Promise<void>;
}
