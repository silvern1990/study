/** 모듈 간 결합을 줄이기 위해 EventEmitter2 로 주고받는 내부 이벤트 */
export const AppEvents = {
  FreeswitchConnected: 'freeswitch.connected',
  BroadcastCallAnswered: 'freeswitch.broadcast.answered',
  BroadcastCallEnded: 'freeswitch.broadcast.ended',
  WakeRequested: 'freeswitch.wake',
  PhoneRecorded: 'freeswitch.recorded',
} as const;

export interface BroadcastCallAnsweredEvent {
  broadcastId: number;
  extension: string;
}

export interface BroadcastCallEndedEvent {
  broadcastId: number;
  extension: string;
  /** 응답 후 통화 시간(초) */
  billsec: number;
  /** 녹음을 끝까지 한 번 이상 들었는지 */
  listenedFully: boolean;
  playCount: number;
}

export interface WakeRequestedEvent {
  callee: string;
  caller: string;
  callUuid: string;
}

export interface PhoneRecordedEvent {
  extension: string;
  /** FreeSWITCH 내부 경로 */
  freeswitchPath: string;
}
