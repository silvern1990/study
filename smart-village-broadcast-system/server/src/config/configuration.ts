const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const configuration = () => ({
  port: int(process.env.PORT, 3000),
  database: {
    url: process.env.DATABASE_URL ?? 'postgres://svbs:svbs@localhost:5432/svbs',
    // 개발 편의용. 운영에서는 false 로 두고 마이그레이션을 사용한다.
    synchronize: process.env.DB_SYNCHRONIZE !== 'false',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: int(process.env.REDIS_PORT, 6379),
  },
  recordings: {
    // 백엔드가 녹음 파일을 읽고 쓰는 경로 (FreeSWITCH 컨테이너와 공유되는 볼륨)
    dir: process.env.RECORDINGS_DIR ?? '../data/recordings',
    // 같은 볼륨이 FreeSWITCH 안에서 마운트된 경로
    freeswitchDir: process.env.FS_RECORDINGS_DIR ?? '/recordings',
    maxUploadBytes: int(process.env.RECORDING_MAX_UPLOAD_BYTES, 50 * 1024 * 1024),
  },
  freeswitch: {
    eslHost: process.env.FS_ESL_HOST ?? '127.0.0.1',
    eslPort: int(process.env.FS_ESL_PORT, 8021),
    eslPassword: process.env.FS_ESL_PASSWORD ?? 'ClueCon',
    // 앱에 내려주는 SIP 접속 정보
    sipDomain: process.env.SIP_DOMAIN ?? '127.0.0.1',
    sipWsUrl: process.env.SIP_WS_URL ?? 'ws://127.0.0.1:5066',
    // mod_xml_curl 이 /freeswitch/directory 를 호출할 때 쓰는 Basic 인증
    xmlCurlUser: process.env.FS_XMLCURL_USER ?? 'freeswitch',
    xmlCurlPassword: process.env.FS_XMLCURL_PASSWORD ?? 'change-me',
  },
  broadcast: {
    // 푸시 후 이 시간 안에 응답이 없으면 미응답으로 처리
    ringTimeoutSec: int(process.env.BROADCAST_RING_TIMEOUT_SEC, 45),
    defaultMaxAttempts: int(process.env.BROADCAST_MAX_ATTEMPTS, 3),
    defaultRetryDelaySec: int(process.env.BROADCAST_RETRY_DELAY_SEC, 300),
    // 초당 발송 푸시 수 (응답이 한꺼번에 몰리지 않도록)
    pushPerSecond: int(process.env.BROADCAST_PUSH_PER_SECOND, 50),
  },
});

export type AppConfig = ReturnType<typeof configuration>;
