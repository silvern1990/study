import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import 'callkit_ui.dart';
import 'session_store.dart';

/// Android: FCM data 메시지 → 수신 화면 (앱이 꺼져 있어도 이 isolate 에서 실행)
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  await showIncomingFromPush(message.data);
}

/// 앱이 꺼져 있을 때 수신 화면에서 거절한 방송을 서버에 보고.
/// (시간 초과는 extra 가 없어 보고하지 않는다 → 서버 ring-timeout 이 처리)
@pragma('vm:entry-point')
Future<void> callkitBackgroundHandler(CallEvent event) async {
  if (event case CallEventActionCallDecline(:final callKitParams)) {
    final extra = extraOf(callKitParams);
    if (extra['kind'] != IncomingKind.broadcast) return;
    final userId = await SessionStore().userId();
    if (userId == null) return;
    try {
      await ApiClient().reportBroadcast(
        int.parse('${extra['broadcastId']}'),
        userId,
        BroadcastReportResult.rejected,
      );
    } catch (e) {
      debugPrint('background report failed: $e');
    }
  }
}

/// 푸시 토큰 등록과 포그라운드 수신 처리
class PushService {
  PushService({required this.api, required this.userId});

  final ApiClient api;
  final int userId;
  final _subs = <StreamSubscription<Object?>>[];

  Future<void> init() async {
    if (Platform.isIOS) {
      await _initIosVoip();
    } else {
      await _initFcm();
    }
  }

  /// iOS: PushKit VoIP 토큰은 AppDelegate 가 받아 플러그인에 넘긴다
  Future<void> _initIosVoip() async {
    final token = await FlutterCallkitIncoming.getDevicePushTokenVoIP();
    if (token != null && token.isNotEmpty) {
      await api.updatePushToken(userId, platform: 'ios', voipPushToken: token);
    }
    _subs.add(
      FlutterCallkitIncoming.onEvent.listen((event) async {
        if (event is CallEventActionDidUpdateDevicePushTokenVoip) {
          final t = await FlutterCallkitIncoming.getDevicePushTokenVoIP();
          if (t != null && t.isNotEmpty) {
            await api.updatePushToken(userId, platform: 'ios', voipPushToken: t);
          }
        }
      }),
    );
    // TODO: 일반 알림(notice)용 APNs 토큰은 Firebase(iOS) 설정 후 FCM 으로 받기
  }

  Future<void> _initFcm() async {
    try {
      await Firebase.initializeApp();
    } catch (e) {
      // google-services.json 이 없으면 여기로 온다. 푸시 없이 동작(포그라운드 SIP 수신만 가능)
      debugPrint('Firebase not configured, push disabled: $e');
      return;
    }
    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission();
    // firebase_messaging 17+: register() 후 onRegistered 로 Firebase Installation ID(FID)가 온다.
    // 백엔드는 이 값을 FCM direct-send 대상으로 사용해야 한다 (구 getToken() 토큰과 다름).
    _subs
      ..add(
        messaging.onRegistered.listen(
          (fid) => api.updatePushToken(userId, platform: 'android', pushToken: fid),
        ),
      )
      ..add(
        FirebaseMessaging.onMessage.listen((m) => showIncomingFromPush(m.data)),
      );
    await messaging.register();
  }

  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
  }
}
