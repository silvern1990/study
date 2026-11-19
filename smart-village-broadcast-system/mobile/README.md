# SVBS 모바일 앱 (Flutter)

마을방송 수신과 주민 간 1:1 통화를 하는 앱. FreeSWITCH 에 SIP over WebSocket 으로 등록한다.

## 구조

```
lib/
├── main.dart                     # 백그라운드 핸들러 등록, 앱 셸
├── app_state.dart                # 로그인 세션, 서비스 수명 관리
├── config.dart                   # API 주소 (--dart-define=API_BASE_URL)
├── api/
│   ├── api_client.dart           # 백엔드 REST
│   └── models.dart               # SipConfig, InboxItem
├── services/
│   ├── sip_service.dart          # sip_ua 래퍼: 등록, 발신/응답, 음소거, 스피커, DTMF
│   ├── callkit_ui.dart           # 수신 화면 표시 (iOS CallKit / Android 전체화면)
│   ├── call_coordinator.dart     # 수신 화면 이벤트 ↔ SIP ↔ 백엔드 보고 (핵심)
│   ├── push_service.dart         # FCM / VoIP 토큰 등록, 백그라운드 핸들러
│   └── session_store.dart        # 로그인 정보 저장
└── screens/
    ├── login_screen.dart         # PoC: 사용자 번호 입력
    ├── home_screen.dart          # 탭(전화/방송함) + 연결 상태
    ├── dialer_screen.dart        # 내선번호 키패드
    ├── call_screen.dart          # 통화/방송 화면 (음소거, 스피커, 다시 듣기, 끊기)
    └── inbox_screen.dart         # 방송함 + 다시 듣기 재생
ios/Runner/AppDelegate.swift      # PushKit VoIP 푸시 → CallKit
```

## 흐름

| 상황 | 동작 |
|---|---|
| 방송 푸시 | 수신 화면 → 받기 → `POST /broadcasts/:id/report accepted` → SIP 등록 → `bcast-{id}` 발신 → 재생 |
| 방송 거절/시간초과 | `report rejected/missed` (앱이 꺼져 있을 때 거절은 백그라운드 핸들러가 보고, 시간초과는 서버 타임아웃이 처리) |
| 1:1 통화 푸시 | 수신 화면 → 받기 → SIP 등록 → FreeSWITCH 가 보낸 INVITE 에 자동 응답 |
| 앱 실행 중 SIP 수신 | 수신 화면 → 받기 → 응답 |
| 발신 | 키패드 → `2xxxx` 발신 |
| 앱이 꺼진 상태에서 받기 | 앱 실행 시 `activeCalls()` 에서 받은 통화를 찾아 이어서 처리 |

## 푸시 payload (백엔드 → 앱)

Android FCM data 와 iOS VoIP payload 모두 같은 키를 쓴다. 백엔드 `PushPayload` 와 일치한다.

```json
{ "type": "broadcast", "broadcastId": "1", "title": "공지", "dial": "bcast-1" }
{ "type": "call", "caller": "20002", "callUuid": "<FreeSWITCH call uuid>" }
```

## 실행

```bash
# 백엔드/FreeSWITCH 가 떠 있는 PC 의 LAN IP 로
flutter run --dart-define=API_BASE_URL=http://192.168.0.10:3000
```

- 로그인 화면에서 백엔드 `POST /users` 로 만든 **사용자 번호(userId)** 를 입력
- SIP 접속 주소는 백엔드 `.env` 의 `SIP_WS_URL`(예: `ws://192.168.0.10:5066`)을 그대로 받아 쓴다. 휴대폰에서 접근 가능한 주소여야 한다
- Android 에뮬레이터에서 호스트 PC 는 `10.0.2.2` (기본값)
- 개발용 `http://`, `ws://` 허용은 Android debug 빌드에만 들어 있다 (`android/app/src/debug/AndroidManifest.xml`)

## 푸시 설정 (아직 안 됨)

푸시 없이도 앱이 **실행 중이면** SIP 로 직접 전화를 받을 수 있다. 앱이 백그라운드/종료 상태일 때 받으려면:

- **Android**: Firebase 프로젝트 생성 → `android/app/google-services.json` 추가 → `com.google.gms.google-services` Gradle 플러그인 적용
  - firebase_messaging 17 부터 `register()` / `onRegistered` 가 주는 값은 **Firebase Installation ID(FID)** 이다. 백엔드 FCM 구현 시 이 값을 direct-send 대상으로 써야 한다.
- **iOS**: Apple Developer 에서 APNs 키(또는 VoIP Services 인증서) 발급, Xcode 에서 Push Notifications 와 Background Modes(Voice over IP, Audio) capability 추가. 백엔드는 `voipPushToken` 으로 `apns-push-type: voip` 푸시를 보낸다.

## 검증 상태 (2026-11-19, Android 에뮬레이터 Pixel_9 / API 36)

백엔드 + FreeSWITCH 를 띄우고 에뮬레이터에서 확인했다.

| 항목 | 결과 |
|---|---|
| `flutter analyze` / `flutter test` | ✅ |
| Android debug APK 빌드 | ✅ |
| 로그인 → SIP over WS 등록 (백엔드 디렉터리 인증) | ✅ `Registered(WS-NAT)` |
| 앱 재시작 시 자동 로그인·재등록 | ✅ |
| SIP 수신 → 수신 알림 → 받기 → 통화 화면 → 녹음 재생 → 종료 | ✅ 백엔드에 `completed`, 11초, 끝까지 들음 |
| 발신 (미등록 사용자에게) → 서버가 깨우기 푸시 요청 → 끊기 | ✅ |
| 방송함 목록, 다시 듣기 재생 시작 | ✅ |
| **푸시로 깨워서 받기** (FCM/VoIP) | ❌ Firebase/APNs 미설정이라 확인 못함 |
| **iOS 빌드/동작** | ❌ macOS/Xcode 필요 |
| 실제 소리 품질 | ❌ 에뮬레이터라 귀로 확인 못함 (RTP/재생 완료까지만 확인) |

> 방송 수신은 푸시 없이 확인하려고, FreeSWITCH 에서 앱으로 직접 걸어 받은 뒤 `bcast-1` dialplan 으로 넘기는 방식으로 시험했다:
> `fs_cli -x "originate {origination_caller_id_number=20002}user/20002@<domain> bcast-1 XML svbs"`

### 검증 중 발견해 고친 문제

- **받기를 누르면 통화가 끊김**: Flutter 템플릿의 `android:taskAffinity=""` 때문에 수신 화면 플러그인이 MainActivity 를 다른 task 에 새로 만들어 Flutter 엔진(=SIP 연결)이 재시작됐다. `taskAffinity` 제거 + `launchMode="singleTask"` 로 해결
- **앱 시작 시 assertion 오류**: `textTheme.apply(fontSizeFactor)` 는 fontSize 가 비어 있는 테마에 쓸 수 없음 → `MediaQuery` textScaler 로 글자 확대
- **compileSdk**: permission_handler 13 이 API 37 이상 요구
- 작은 화면에서 키패드 넘침, 통화 화면 버튼 정렬

## TODO

- [ ] 실제 인증 (지금은 사용자 번호만 입력)
- [ ] `sipPassword` 를 secure storage 로 이동
- [ ] 1:1 푸시 통화 거절 시 서버에 알리기
- [ ] 방송 미수신 `notice` 푸시를 로컬 알림으로 표시
- [ ] 어르신용 UI 다듬기 (글자 크기, 버튼 크기, 음성 안내)
- [ ] WSS(TLS) 전환 후 `allowBadCertificate` 제거
