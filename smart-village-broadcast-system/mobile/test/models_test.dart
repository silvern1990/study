import 'package:flutter_test/flutter_test.dart';
import 'package:svbs_app/api/models.dart';

void main() {
  test('SipConfig parses backend sip-config response', () {
    final cfg = SipConfig.fromJson({
      'userId': 2,
      'name': '김주민',
      'role': 'resident',
      'extension': '20002',
      'sipPassword': 'pw',
      'sipDomain': '172.30.1.57',
      'sipWsUrl': 'ws://172.30.1.57:5066',
      'broadcastDialPrefix': 'bcast-',
    });
    expect(cfg.extension, '20002');
    expect(cfg.isAdmin, isFalse);
    expect(SipConfig.fromJson(cfg.toJson()).sipWsUrl, cfg.sipWsUrl);
  });

  test('InboxItem parses backend inbox item', () {
    final item = InboxItem.fromJson({
      'broadcastId': 2,
      'title': '거절 테스트',
      'recordingId': 1,
      'durationSec': 3,
      'sentAt': '2026-11-19T02:45:27.514Z',
      'status': 'missed',
      'listenedFully': false,
    });
    expect(item.durationSec, 3.0);
    expect(item.statusLabel, '못 받음');
    expect(item.sentAt!.isUtc, isFalse);
  });
}
