/// 백엔드 GET /users/:id/sip-config 응답
class SipConfig {
  SipConfig({
    required this.userId,
    required this.name,
    required this.role,
    required this.extension,
    required this.sipPassword,
    required this.sipDomain,
    required this.sipWsUrl,
    required this.broadcastDialPrefix,
  });

  final int userId;
  final String name;
  final String role;
  final String extension;
  final String sipPassword;
  final String sipDomain;
  final String sipWsUrl;
  final String broadcastDialPrefix;

  bool get isAdmin => role == 'admin';

  factory SipConfig.fromJson(Map<String, dynamic> json) => SipConfig(
        userId: json['userId'] as int,
        name: json['name'] as String,
        role: json['role'] as String,
        extension: json['extension'] as String,
        sipPassword: json['sipPassword'] as String,
        sipDomain: json['sipDomain'] as String,
        sipWsUrl: json['sipWsUrl'] as String,
        broadcastDialPrefix: json['broadcastDialPrefix'] as String? ?? 'bcast-',
      );

  Map<String, dynamic> toJson() => {
        'userId': userId,
        'name': name,
        'role': role,
        'extension': extension,
        'sipPassword': sipPassword,
        'sipDomain': sipDomain,
        'sipWsUrl': sipWsUrl,
        'broadcastDialPrefix': broadcastDialPrefix,
      };
}

/// 백엔드 GET /broadcasts/inbox/:userId 항목
class InboxItem {
  InboxItem({
    required this.broadcastId,
    required this.title,
    required this.recordingId,
    required this.durationSec,
    required this.sentAt,
    required this.status,
    required this.listenedFully,
  });

  final int broadcastId;
  final String title;
  final int recordingId;
  final double durationSec;
  final DateTime? sentAt;
  final String status;
  final bool listenedFully;

  factory InboxItem.fromJson(Map<String, dynamic> json) => InboxItem(
        broadcastId: json['broadcastId'] as int,
        title: json['title'] as String,
        recordingId: json['recordingId'] as int,
        durationSec: (json['durationSec'] as num?)?.toDouble() ?? 0,
        sentAt: json['sentAt'] == null
            ? null
            : DateTime.parse(json['sentAt'] as String).toLocal(),
        status: json['status'] as String,
        listenedFully: json['listenedFully'] as bool? ?? false,
      );

  String get statusLabel => switch (status) {
        'completed' => '들음',
        'partial' => '일부 들음',
        'missed' => '못 받음',
        'cancelled' => '취소됨',
        'answered' => '듣는 중',
        _ => '수신 중',
      };
}

enum BroadcastReportResult { accepted, rejected, missed }
