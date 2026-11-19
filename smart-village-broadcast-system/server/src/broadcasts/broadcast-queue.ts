export const BROADCAST_QUEUE = 'broadcast';

export const BroadcastJob = {
  /** 예약 방송 시작 */
  Start: 'start',
  /** 대상자 한 명에게 방송 푸시(전화 수신 화면) 발송 */
  Ring: 'ring',
  /** 응답 대기 시간 초과 확인 */
  RingTimeout: 'ring-timeout',
} as const;

export interface StartJobData {
  broadcastId: number;
}

export interface RingJobData {
  targetId: number;
  /** 몇 번째 시도인지 (1부터). 오래된 잡을 무시하는 데 사용 */
  attempt: number;
}

// BullMQ 커스텀 jobId 에는 ':' 를 쓸 수 없다
export const ringJobId = (targetId: number, attempt: number) =>
  `ring-${targetId}-${attempt}`;
export const timeoutJobId = (targetId: number, attempt: number) =>
  `timeout-${targetId}-${attempt}`;
export const startJobId = (broadcastId: number) => `start-${broadcastId}`;
