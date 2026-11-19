import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:sip_ua/sip_ua.dart';

import '../api/models.dart';

/// sip_ua 를 감싼 SIP 클라이언트.
/// - FreeSWITCH 에 SIP over WebSocket 으로 등록
/// - 음성 전용 발신/수신, 음소거, 스피커, DTMF
class SipService extends ChangeNotifier implements SipUaHelperListener {
  SipService() {
    _helper.addSipUaHelperListener(this);
  }

  final SIPUAHelper _helper = SIPUAHelper();
  SipConfig? _config;
  Completer<bool>? _registerWaiter;

  RegistrationStateEnum registration = RegistrationStateEnum.NONE;
  TransportStateEnum transport = TransportStateEnum.NONE;

  final _callEvents = StreamController<(Call, CallState)>.broadcast();

  /// 모든 통화 상태 변화. CallCoordinator 가 구독한다.
  Stream<(Call, CallState)> get callEvents => _callEvents.stream;

  bool get registered => _helper.registered;

  Future<void> start(SipConfig config) async {
    _config = config;
    final settings = UaSettings()
      ..transportType = TransportType.WS
      ..webSocketUrl = config.sipWsUrl
      ..uri = 'sip:${config.extension}@${config.sipDomain}'
      ..authorizationUser = config.extension
      ..password = config.sipPassword
      ..displayName = config.name
      ..userAgent = 'SVBS-App'
      ..register = true
      // FreeSWITCH 의 session:read() 가 받는 DTMF (방송 "다시 듣기" 1번)
      ..dtmfMode = DtmfMode.RFC2833;
    // 개발 중 자체 서명 인증서(wss) 허용. 운영에서는 false.
    settings.webSocketSettings.allowBadCertificate = kDebugMode;
    await _helper.start(settings);
  }

  void stop() {
    _helper.stop();
    registration = RegistrationStateEnum.NONE;
    transport = TransportStateEnum.NONE;
    notifyListeners();
  }

  /// 푸시로 깨어난 직후처럼 등록이 안 되어 있을 수 있을 때 호출
  Future<bool> ensureRegistered({
    Duration timeout = const Duration(seconds: 10),
  }) async {
    if (_helper.registered) return true;
    final config = _config;
    if (config == null) return false;

    _registerWaiter ??= Completer<bool>();
    final waiter = _registerWaiter!;
    if (!_helper.connected && !_helper.connecting) {
      await start(config);
    } else if (_helper.connected) {
      _helper.register();
    }
    return waiter.future.timeout(timeout, onTimeout: () => false);
  }

  Future<bool> dial(String target) async {
    if (!await ensureRegistered()) return false;
    return _helper.call(target, voiceOnly: true);
  }

  void answer(Call call) => call.answer(_helper.buildCallOptions(true));

  void hangup(Call call) => call.hangup();

  void setMuted(Call call, bool muted) =>
      muted ? call.mute(true, false) : call.unmute(true, false);

  Future<void> setSpeaker(bool on) => Helper.setSpeakerphoneOn(on);

  void sendDtmf(Call call, String tones) => call.sendDTMF(tones);

  // ---- SipUaHelperListener ----

  @override
  void transportStateChanged(TransportState state) {
    transport = state.state;
    notifyListeners();
  }

  @override
  void registrationStateChanged(RegistrationState state) {
    registration = state.state ?? RegistrationStateEnum.NONE;
    final waiter = _registerWaiter;
    if (waiter != null && !waiter.isCompleted) {
      if (registration == RegistrationStateEnum.REGISTERED) {
        waiter.complete(true);
        _registerWaiter = null;
      } else if (registration == RegistrationStateEnum.REGISTRATION_FAILED) {
        waiter.complete(false);
        _registerWaiter = null;
      }
    }
    notifyListeners();
  }

  @override
  void callStateChanged(Call call, CallState state) {
    _callEvents.add((call, state));
  }

  @override
  void onNewMessage(SIPMessageRequest msg) {}

  @override
  void onNewNotify(Notify ntf) {}

  @override
  void onNewReinvite(ReInvite event) {}

  @override
  void dispose() {
    _helper.removeSipUaHelperListener(this);
    _callEvents.close();
    super.dispose();
  }
}
