import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:sip_ua/sip_ua.dart';
import 'package:uuid/uuid.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import 'callkit_ui.dart';
import 'sip_service.dart';

/// 화면에 보여줄 현재 통화
class ActiveCall {
  ActiveCall({
    required this.kind,
    required this.title,
    required this.callkitId,
    this.broadcastId,
  });

  /// IncomingKind.* 또는 'outgoing'
  final String kind;
  final String title;
  final String callkitId;
  final int? broadcastId;

  Call? sip;
  CallStateEnum state = CallStateEnum.NONE;
  DateTime? connectedAt;
  bool muted = false;
  bool speaker = false;

  bool get isBroadcast => kind == IncomingKind.broadcast;
  bool get isConnected => connectedAt != null;
}

/// 수신 화면(CallKit) 이벤트 ↔ SIP 통화 ↔ 백엔드 보고를 묶는 곳.
///
/// 방송:   푸시 → 수신 화면 → 받기 → report(accepted) → bcast-{id} 발신 → 재생 → 종료
/// 1:1:    푸시 → 수신 화면 → 받기 → SIP 등록 → 서버가 보낸 INVITE 에 자동 응답
/// 포그라운드 수신: SIP INVITE → 수신 화면 → 받기 → 응답
class CallCoordinator extends ChangeNotifier {
  CallCoordinator({
    required this.sip,
    required this.api,
    required this.userId,
    required this.onCallStarted,
  });

  final SipService sip;
  final ApiClient api;
  final int userId;

  /// 통화 화면을 띄우는 콜백 (앱 셸이 Navigator 로 처리)
  final VoidCallback onCallStarted;

  ActiveCall? active;

  final _uuid = const Uuid();
  final _incomingExtras = <String, Map<String, dynamic>>{};
  final _ringingSipCalls = <String, Call>{}; // callkitId -> SIP call
  Timer? _pushCallWaitTimer;
  StreamSubscription<CallEvent?>? _callkitSub;
  StreamSubscription<(Call, CallState)>? _sipSub;

  void start() {
    _callkitSub = FlutterCallkitIncoming.onEvent.listen(_onCallkitEvent);
    _sipSub = sip.callEvents.listen(_onSipEvent);
  }

  /// 앱이 꺼진 상태에서 "받기"를 눌러 실행된 경우 처리
  Future<void> recoverAcceptedCalls() async {
    final calls = await FlutterCallkitIncoming.activeCalls();
    for (final params in calls) {
      if (params.isAccepted && active == null) {
        await _onAccept(params);
      }
    }
  }

  // ---------------------------------------------------------------- 사용자 동작

  Future<void> startOutgoing(String extension) async {
    if (active != null) return;
    final id = _uuid.v4();
    active = ActiveCall(kind: 'outgoing', title: extension, callkitId: id);
    notifyListeners();
    onCallStarted();
    // iOS 오디오 세션을 CallKit 에 맡기기 위해 발신도 CallKit 에 알림
    await FlutterCallkitIncoming.startCall(
      CallKitParams(id: id, nameCaller: extension, handle: extension, type: 0),
    );
    if (!await sip.dial(extension)) await _finish();
  }

  void hangup() {
    final call = active;
    if (call == null) return;
    if (call.sip != null) {
      sip.hangup(call.sip!);
    } else {
      unawaited(_finish());
    }
  }

  void toggleMute() {
    final call = active;
    if (call?.sip == null) return;
    call!.muted = !call.muted;
    sip.setMuted(call.sip!, call.muted);
    notifyListeners();
  }

  Future<void> toggleSpeaker() async {
    final call = active;
    if (call == null) return;
    call.speaker = !call.speaker;
    await sip.setSpeaker(call.speaker);
    notifyListeners();
  }

  /// 방송 다시 듣기 (FreeSWITCH broadcast.lua 가 1번을 기다린다)
  void replayBroadcast() {
    final call = active;
    if (call?.sip != null && call!.isBroadcast) sip.sendDtmf(call.sip!, '1');
  }

  // ---------------------------------------------------------------- CallKit 이벤트

  Future<void> _onCallkitEvent(CallEvent? event) async {
    switch (event) {
      case CallEventActionCallIncoming(:final callKitParams):
        _incomingExtras[callKitParams.id] = extraOf(callKitParams);
      case CallEventActionCallAccept(:final callKitParams):
        await _onAccept(callKitParams);
      case CallEventActionCallDecline(:final callKitParams):
        await _onDeclineOrTimeout(
          callKitParams.id,
          extraOf(callKitParams),
          BroadcastReportResult.rejected,
        );
      case CallEventActionCallTimeout(:final id):
        await _onDeclineOrTimeout(
          id,
          _incomingExtras[id] ?? const {},
          BroadcastReportResult.missed,
        );
      case CallEventActionCallEnded(:final callKitParams):
        // 시스템 UI(잠금화면, 블루투스 등)에서 끊은 경우
        if (active?.callkitId == callKitParams.id) hangup();
      default:
        break;
    }
  }

  Future<void> _onAccept(CallKitParams params) async {
    if (active != null) return;
    final extra = extraOf(params);
    _incomingExtras.remove(params.id);

    switch (extra['kind']) {
      case IncomingKind.broadcast:
        final broadcastId = int.parse('${extra['broadcastId']}');
        active = ActiveCall(
          kind: IncomingKind.broadcast,
          title: '${extra['title'] ?? '마을방송'}',
          callkitId: params.id,
          broadcastId: broadcastId,
        );
        notifyListeners();
        onCallStarted();
        unawaited(
          _report(broadcastId, BroadcastReportResult.accepted),
        );
        if (!await sip.dial('${extra['dial']}')) await _finish();

      case IncomingKind.pushCall:
        active = ActiveCall(
          kind: IncomingKind.pushCall,
          title: '${extra['caller'] ?? ''}',
          callkitId: params.id,
        );
        notifyListeners();
        onCallStarted();
        // 등록되면 FreeSWITCH(call.lua)가 INVITE 를 보낸다 → _onSipEvent 에서 자동 응답
        _pushCallWaitTimer?.cancel();
        _pushCallWaitTimer = Timer(const Duration(seconds: 30), () {
          if (active?.sip == null) unawaited(_finish());
        });
        if (!await sip.ensureRegistered()) await _finish();

      case IncomingKind.sipIncoming:
        final call = _ringingSipCalls.remove(params.id);
        if (call == null) {
          await FlutterCallkitIncoming.endCall(params.id);
          return;
        }
        active = ActiveCall(
          kind: IncomingKind.sipIncoming,
          title: _remoteName(call),
          callkitId: params.id,
        )..sip = call;
        notifyListeners();
        onCallStarted();
        sip.answer(call);
    }
  }

  Future<void> _onDeclineOrTimeout(
    String callkitId,
    Map<String, dynamic> extra,
    BroadcastReportResult result,
  ) async {
    _incomingExtras.remove(callkitId);
    switch (extra['kind']) {
      case IncomingKind.broadcast:
        await _report(int.parse('${extra['broadcastId']}'), result);
      case IncomingKind.sipIncoming:
        final call = _ringingSipCalls.remove(callkitId);
        if (call != null) sip.hangup(call);
      default:
        // TODO(1:1 푸시 통화 거절): 서버에 알려 발신자에게 바로 종료를 전달
        break;
    }
  }

  // ---------------------------------------------------------------- SIP 이벤트

  void _onSipEvent((Call, CallState) event) {
    final (call, state) = event;
    final current = active;

    switch (state.state) {
      case CallStateEnum.CALL_INITIATION:
        if (call.direction == Direction.incoming) {
          _onSipIncoming(call);
        } else if (current != null && current.sip == null) {
          current.sip = call; // 방송/발신에서 내가 건 통화
        }
      case CallStateEnum.ACCEPTED || CallStateEnum.CONFIRMED:
        if (current?.sip?.id == call.id && current!.connectedAt == null) {
          current.connectedAt = DateTime.now();
          unawaited(FlutterCallkitIncoming.setCallConnected(current.callkitId));
        }
      case CallStateEnum.ENDED || CallStateEnum.FAILED:
        // 응답 전 끊긴 수신 → 수신 화면 닫기
        final ringing = _ringingSipCalls.entries
            .where((e) => e.value.id == call.id)
            .map((e) => e.key)
            .toList();
        for (final id in ringing) {
          _ringingSipCalls.remove(id);
          unawaited(FlutterCallkitIncoming.endCall(id));
        }
        if (current?.sip?.id == call.id) unawaited(_finish());
      default:
        break;
    }
    if (current != null && current.sip?.id == call.id) {
      current.state = state.state;
    }
    notifyListeners();
  }

  void _onSipIncoming(Call call) {
    final current = active;
    // 푸시로 받기를 누르고 기다리던 1:1 통화
    if (current != null &&
        current.kind == IncomingKind.pushCall &&
        current.sip == null) {
      _pushCallWaitTimer?.cancel();
      current.sip = call;
      sip.answer(call);
      return;
    }
    // 통화 중이면 거절
    if (current != null) {
      sip.hangup(call);
      return;
    }
    // 포그라운드에서 바로 들어온 통화 → 수신 화면
    final id = _uuid.v4();
    _ringingSipCalls[id] = call;
    unawaited(
      showIncoming(
        id: id,
        name: _remoteName(call),
        handle: call.remote_identity ?? '',
        extra: {'kind': IncomingKind.sipIncoming},
      ),
    );
  }

  // ---------------------------------------------------------------- 공통

  Future<void> _finish() async {
    final call = active;
    if (call == null) return;
    _pushCallWaitTimer?.cancel();
    active = null;
    notifyListeners();
    if (call.speaker) await sip.setSpeaker(false);
    await FlutterCallkitIncoming.endCall(call.callkitId);
  }

  Future<void> _report(int broadcastId, BroadcastReportResult result) async {
    try {
      await api.reportBroadcast(broadcastId, userId, result);
    } catch (e) {
      // 보고 실패해도 서버의 ring-timeout 이 결국 정리한다
      debugPrint('broadcast report failed: $e');
    }
  }

  String _remoteName(Call call) =>
      call.remote_display_name?.isNotEmpty == true
          ? call.remote_display_name!
          : (call.remote_identity ?? '알 수 없음');

  @override
  void dispose() {
    _callkitSub?.cancel();
    _sipSub?.cancel();
    _pushCallWaitTimer?.cancel();
    super.dispose();
  }
}
