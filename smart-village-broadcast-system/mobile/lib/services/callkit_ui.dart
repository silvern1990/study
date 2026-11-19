import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:uuid/uuid.dart';

import '../config.dart';

/// 수신 화면(iOS CallKit / Android 전체화면 알림)에 실어 보내는 extra 의 종류
abstract final class IncomingKind {
  /// 마을방송: 받으면 앱이 bcast-{id} 로 발신
  static const broadcast = 'broadcast';

  /// 1:1 통화 푸시: 받으면 SIP 등록 후 들어오는 INVITE 에 자동 응답
  static const pushCall = 'call';

  /// 앱이 이미 등록된 상태에서 바로 들어온 SIP INVITE
  static const sipIncoming = 'sip-incoming';
}

const _uuid = Uuid();

/// 백엔드 푸시 data → 수신 화면.
/// 백그라운드 isolate(FCM 핸들러)에서도 호출되므로 top-level 함수로 둔다.
///
/// 푸시 data 형식 (FCM data 값은 모두 문자열):
///   broadcast: { type: 'broadcast', broadcastId, title, dial }
///   call:      { type: 'call', caller, callUuid }
Future<void> showIncomingFromPush(Map<String, dynamic> data) async {
  switch (data['type']) {
    case IncomingKind.broadcast:
      await showIncoming(
        // CallKit 은 UUID 형식 id 가 필요하다
        id: _uuid.v4(),
        name: '${AppConfig.appName}: ${data['title'] ?? ''}',
        handle: AppConfig.appName,
        extra: {
          'kind': IncomingKind.broadcast,
          'broadcastId': '${data['broadcastId']}',
          'dial': '${data['dial']}',
          'title': '${data['title'] ?? ''}',
        },
      );
    case IncomingKind.pushCall:
      final callUuid = '${data['callUuid'] ?? ''}';
      await showIncoming(
        id: callUuid.isNotEmpty ? callUuid : _uuid.v4(),
        name: '${data['caller'] ?? '알 수 없음'}',
        handle: '${data['caller'] ?? ''}',
        extra: {'kind': IncomingKind.pushCall, 'caller': '${data['caller']}'},
      );
    default:
      // 'notice' 등은 수신 화면 대상이 아님
      break;
  }
}

Future<void> showIncoming({
  required String id,
  required String name,
  required String handle,
  required Map<String, dynamic> extra,
}) {
  return FlutterCallkitIncoming.showCallkitIncoming(
    CallKitParams(
      id: id,
      nameCaller: name,
      appName: AppConfig.appName,
      handle: handle,
      type: 0, // 음성
      duration: AppConfig.ringDuration.inMilliseconds,
      extra: extra,
      missedCallNotification: const NotificationParams(
        showNotification: true,
        isShowCallback: false,
        subtitle: '받지 못한 전화',
      ),
      android: const AndroidParams(
        isCustomNotification: true,
        isShowFullLockedScreen: true,
        isImportant: true,
        backgroundColor: '#0B6E4F',
        actionColor: '#4CAF50',
        textColor: '#FFFFFF',
        textAccept: '받기',
        textDecline: '거절',
        incomingCallNotificationChannelName: '수신 전화',
        missedCallNotificationChannelName: '부재중 전화',
      ),
      ios: const IOSParams(
        handleType: 'generic',
        supportsVideo: false,
        supportsDTMF: true,
        supportsHolding: false,
        supportsGrouping: false,
        supportsUngrouping: false,
        maximumCallGroups: 1,
        maximumCallsPerCallGroup: 1,
        includesCallsInRecents: true,
        configureAudioSession: true,
        audioSessionMode: 'voiceChat',
        audioSessionActive: true,
      ),
    ),
  );
}

/// native 에서 넘어온 extra 를 `Map<String, dynamic>` 으로
Map<String, dynamic> extraOf(CallKitParams params) =>
    Map<String, dynamic>.from(params.extra ?? const {});
