import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:sip_ua/sip_ua.dart';

import '../services/call_coordinator.dart';

/// 통화/방송 청취 화면. CallCoordinator.active 가 사라지면 스스로 닫힌다.
class CallScreen extends StatefulWidget {
  const CallScreen({super.key, required this.calls});

  final CallCoordinator calls;

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  Timer? _ticker;
  bool _closing = false;

  @override
  void initState() {
    super.initState();
    widget.calls.addListener(_onChange);
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  void _onChange() {
    if (widget.calls.active == null && !_closing && mounted) {
      _closing = true;
      Navigator.of(context).maybePop();
    }
  }

  @override
  void dispose() {
    widget.calls.removeListener(_onChange);
    _ticker?.cancel();
    super.dispose();
  }

  String _statusText(ActiveCall call) {
    if (call.connectedAt != null) {
      final d = DateTime.now().difference(call.connectedAt!);
      final mm = d.inMinutes.toString().padLeft(2, '0');
      final ss = (d.inSeconds % 60).toString().padLeft(2, '0');
      return call.isBroadcast ? '방송 듣는 중 $mm:$ss' : '통화 중 $mm:$ss';
    }
    return switch (call.state) {
      CallStateEnum.PROGRESS => '연결 중…',
      CallStateEnum.FAILED => '연결 실패',
      _ => call.isBroadcast ? '방송 연결 중…' : '전화 거는 중…',
    };
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: widget.calls,
      builder: (context, _) {
        final call = widget.calls.active;
        return Scaffold(
          backgroundColor: theme.colorScheme.primaryContainer,
          body: SafeArea(
            child: call == null
                ? const Center(child: Text('통화가 종료되었습니다'))
                : Container(
                    // 가로 전체를 써야 가운데 정렬된다 (Scaffold body 는 왼쪽 위 기준)
                    width: double.infinity,
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      children: [
                        const Spacer(),
                        Icon(
                          call.isBroadcast ? Icons.campaign : Icons.person,
                          size: 96,
                        ),
                        const SizedBox(height: 16),
                        if (call.isBroadcast)
                          Text('마을방송', style: theme.textTheme.titleMedium),
                        Text(
                          call.title,
                          textAlign: TextAlign.center,
                          style: theme.textTheme.headlineMedium,
                        ),
                        const SizedBox(height: 8),
                        Text(_statusText(call),
                            style: theme.textTheme.titleMedium),
                        const Spacer(),
                        Wrap(
                          spacing: 24,
                          runSpacing: 16,
                          alignment: WrapAlignment.center,
                          children: [
                            if (!call.isBroadcast)
                              _RoundButton(
                                icon: call.muted ? Icons.mic_off : Icons.mic,
                                label: call.muted ? '음소거 해제' : '음소거',
                                onPressed: widget.calls.toggleMute,
                              ),
                            _RoundButton(
                              icon: call.speaker
                                  ? Icons.volume_up
                                  : Icons.volume_down,
                              label: call.speaker ? '스피커 끄기' : '스피커',
                              onPressed: widget.calls.toggleSpeaker,
                            ),
                            if (call.isBroadcast)
                              _RoundButton(
                                icon: Icons.replay,
                                label: '다시 듣기',
                                onPressed: call.isConnected
                                    ? widget.calls.replayBroadcast
                                    : null,
                              ),
                          ],
                        ),
                        const SizedBox(height: 40),
                        FloatingActionButton.large(
                          backgroundColor: Colors.red,
                          foregroundColor: Colors.white,
                          onPressed: widget.calls.hangup,
                          child: const Icon(Icons.call_end, size: 40),
                        ),
                        const SizedBox(height: 24),
                      ],
                    ),
                  ),
          ),
        );
      },
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton.filledTonal(
          iconSize: 32,
          padding: const EdgeInsets.all(18),
          onPressed: onPressed,
          icon: Icon(icon),
        ),
        const SizedBox(height: 6),
        Text(label),
      ],
    );
  }
}
