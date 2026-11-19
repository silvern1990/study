import 'package:just_audio/just_audio.dart';
import 'package:material_ui/material_ui.dart';

import '../api/models.dart';
import '../app_state.dart';

/// 나에게 온 방송 목록 + 다시 듣기
class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key, required this.app});

  final AppState app;

  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> {
  final _player = AudioPlayer();
  late Future<List<InboxItem>> _items;
  int? _playingRecordingId;

  @override
  void initState() {
    super.initState();
    _items = _load();
    _player.playerStateStream.listen((s) {
      if (s.processingState == ProcessingState.completed && mounted) {
        setState(() => _playingRecordingId = null);
      }
    });
  }

  Future<List<InboxItem>> _load() =>
      widget.app.api.inbox(widget.app.config!.userId);

  Future<void> _refresh() async {
    final future = _load();
    setState(() => _items = future);
    await future;
  }

  Future<void> _toggle(InboxItem item) async {
    if (_playingRecordingId == item.recordingId) {
      await _player.stop();
      setState(() => _playingRecordingId = null);
      return;
    }
    setState(() => _playingRecordingId = item.recordingId);
    try {
      await _player.setUrl(widget.app.api.recordingAudioUrl(item.recordingId));
      await _player.play();
    } catch (e) {
      if (!mounted) return;
      setState(() => _playingRecordingId = null);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('재생 실패: $e')));
    }
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _refresh,
      child: FutureBuilder<List<InboxItem>>(
        future: _items,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return ListView(
              children: [
                const SizedBox(height: 120),
                Center(child: Text('불러오지 못했습니다\n${snap.error}')),
              ],
            );
          }
          final items = snap.data!;
          if (items.isEmpty) {
            return ListView(
              children: const [
                SizedBox(height: 120),
                Center(child: Text('받은 방송이 없습니다')),
              ],
            );
          }
          return ListView.separated(
            itemCount: items.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final item = items[i];
              final playing = _playingRecordingId == item.recordingId;
              return ListTile(
                minVerticalPadding: 16,
                leading: Icon(
                  item.listenedFully ? Icons.campaign_outlined : Icons.campaign,
                  size: 36,
                ),
                title: Text(item.title),
                subtitle: Text(
                  '${_formatDate(item.sentAt)} · ${item.durationSec.round()}초 · ${item.statusLabel}',
                ),
                trailing: IconButton.filledTonal(
                  iconSize: 32,
                  icon: Icon(playing ? Icons.stop : Icons.play_arrow),
                  onPressed: () => _toggle(item),
                ),
              );
            },
          );
        },
      ),
    );
  }

  String _formatDate(DateTime? d) {
    if (d == null) return '-';
    String two(int v) => v.toString().padLeft(2, '0');
    return '${d.month}/${d.day} ${two(d.hour)}:${two(d.minute)}';
  }
}
