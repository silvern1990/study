import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:permission_handler/permission_handler.dart';

import 'api/api_client.dart';
import 'api/models.dart';
import 'services/call_coordinator.dart';
import 'services/push_service.dart';
import 'services/session_store.dart';
import 'services/sip_service.dart';

/// 로그인 세션과 서비스들의 수명 관리
class AppState extends ChangeNotifier {
  AppState({required this.navigatorKey});

  final GlobalKey<NavigatorState> navigatorKey;
  final api = ApiClient();
  final store = SessionStore();

  SipConfig? config;
  SipService? sip;
  CallCoordinator? calls;
  PushService? push;

  /// 통화 화면을 여는 방법 (앱 셸이 설정)
  VoidCallback openCallScreen = () {};

  bool get loggedIn => config != null;

  Future<void> restore() async {
    final saved = await store.sipConfig();
    if (saved != null) await _startSession(saved);
  }

  /// PoC: 사용자 ID 로 로그인. TODO: 백엔드 인증 도입 후 전화번호 인증 등으로 교체
  Future<void> login(int userId) async {
    final cfg = await api.getSipConfig(userId);
    await store.save(cfg);
    await _startSession(cfg);
  }

  Future<void> logout() async {
    calls?.dispose();
    push?.dispose();
    sip?.stop();
    sip?.dispose();
    calls = null;
    push = null;
    sip = null;
    config = null;
    await store.clear();
    notifyListeners();
  }

  Future<void> _startSession(SipConfig cfg) async {
    config = cfg;
    await _requestPermissions();

    final sipService = SipService();
    sip = sipService;
    calls = CallCoordinator(
      sip: sipService,
      api: api,
      userId: cfg.userId,
      onCallStarted: () => openCallScreen(),
    )..start();
    notifyListeners();

    await sipService.start(cfg);

    push = PushService(api: api, userId: cfg.userId);
    try {
      await push!.init();
    } catch (e) {
      debugPrint('push init failed: $e');
    }
    await calls!.recoverAcceptedCalls();
  }

  Future<void> _requestPermissions() async {
    await [Permission.microphone, Permission.notification].request();
    if (defaultTargetPlatform == TargetPlatform.android) {
      // Android 14+: 잠금화면 전체화면 수신 화면 권한
      if (!await FlutterCallkitIncoming.canUseFullScreenIntent()) {
        await FlutterCallkitIncoming.requestFullIntentPermission();
      }
    }
  }
}
