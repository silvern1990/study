# Smart Village Broadcast System (SVBS)

SIP(FreeSWITCH) 기반 사설 전화망. 앱 사용자 간 1:1 통화와, 관리자가 녹음한 방송을
"전화 수신 → 받으면 녹음 재생" 형태로 다수에게 전파한다.

```
smart-village-broadcast-system/
├── infra/
│   ├── docker-compose.yml          # postgres, redis, freeswitch
│   └── freeswitch/
│       ├── Dockerfile              # vanilla 설정 + mod_xml_curl + svbs 오버레이
│       ├── conf/dialplan/svbs.xml  # bcast-{id}, *700, 2xxxx
│       └── scripts/svbs/*.lua      # broadcast / record / call
├── server/                         # NestJS 백엔드
└── data/recordings/                # 녹음 파일 (백엔드 ↔ FreeSWITCH 공유)
```

## 실행 (개발)

```bash
cd infra && docker compose up -d --build     # Linux (FreeSWITCH 는 host 네트워크)
cd ../server && cp .env.example .env && npm install && npm run start:dev
```

- Swagger: http://localhost:3000/docs
- `.env` 의 `SIP_DOMAIN` 은 FreeSWITCH 의 `domain` 값(기본: 호스트의 LAN IP)과 같아야 한다.
  확인: `docker compose exec freeswitch fs_cli -x 'global_getvar domain'`
- 녹음 변환에 호스트의 `ffmpeg`/`ffprobe` 가 필요하다.

## 구성

| 모듈 | 역할 |
|---|---|
| `users` | 사용자 생성 시 SIP 계정(내선 2xxxx) 발급, 앱용 SIP 설정 조회, 푸시 토큰 등록 |
| `freeswitch` | ESL 클라이언트(이벤트 수신, mod_hash 제어), mod_xml_curl 디렉터리 엔드포인트 |
| `recordings` | 업로드 → ffmpeg 로 16kHz mono WAV 변환, 전화 녹음(*700) 등록, 오디오 스트리밍 |
| `broadcasts` | 방송 생성·예약·취소, BullMQ 로 대상자별 푸시/타임아웃/재시도, 수신 현황 |
| `push` | 푸시 발송 추상화 (현재는 로그만 남기는 `LogPushProvider`) |
| `calls` | 1:1 통화 시 수신자 미등록이면 깨우기 푸시 |

## 방송 흐름

1. `POST /recordings` (multipart: file, title) — 또는 관리자가 `*700` 으로 전화 녹음
2. `POST /broadcasts` `{ title, recordingId, userIds?, scheduledAt?, maxAttempts?, retryDelaySec? }`
3. `POST /broadcasts/:id/start` — FreeSWITCH mod_hash 에 `svbs/bcast_{id}` = 파일 경로 등록, 대상자별 `ring` 잡 생성
4. 대상자에게 VoIP 푸시 `{type:'broadcast', dial:'bcast-{id}'}` → 앱이 수신 화면 표시
5. 받으면 앱이 `bcast-{id}` 로 발신 → `broadcast.lua` 가 딩동 + 녹음 재생, `1` 누르면 다시 듣기
6. 통화 종료 이벤트로 `completed`(끝까지 들음) / `partial` 기록
7. 거절·무응답(`POST /broadcasts/:id/report` 또는 타임아웃) → `retryDelaySec` 후 재시도, 최대 횟수 초과 시 `missed` + 다시 듣기 알림

대상자 상태: `pending → ringing → (retrying → ringing)* → answered → completed | partial`, 또는 `missed` / `cancelled`

## 앱이 호출하는 API

| API | 시점 |
|---|---|
| `GET /users/:id/sip-config` | 로그인 후 SIP 클라이언트 설정 |
| `PUT /users/:id/push-token` | 앱 실행 시 (iOS 는 `voipPushToken` 포함) |
| `POST /broadcasts/:id/report` `{userId, result: accepted\|rejected\|missed}` | 방송 수신 화면에서 |
| `GET /broadcasts/inbox/:userId` | 방송함 |
| `GET /recordings/:id/audio` | 다시 듣기 |

## 아직 안 된 것 (TODO)

- **인증/인가**: 모든 API 가 열려 있음. 관리자/앱 토큰 분리 필요
- **실제 푸시**: APNs(PushKit VoIP) / FCM 구현체를 `PushProvider` 로 추가
- **WSS/TLS**: FreeSWITCH `wss-binding`(7443) 인증서 설정, SRTP, TURN(coturn)
- **안내 멘트**: Lua 의 비프음을 실제 한국어 안내 음성으로 교체
- **DB 마이그레이션**: 지금은 `synchronize` 사용 (운영 전 TypeORM 마이그레이션으로 전환)
- 1:1 통화에서 발신자가 먼저 끊었을 때 수신자에게 취소 푸시
- `bcast-{id}` 발신자가 실제 대상자인지 FreeSWITCH 단에서 검증
