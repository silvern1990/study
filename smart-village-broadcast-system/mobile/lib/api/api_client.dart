import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';
import 'models.dart';

class ApiException implements Exception {
  ApiException(this.statusCode, this.body);
  final int statusCode;
  final String body;

  @override
  String toString() => 'ApiException($statusCode): $body';
}

/// SVBS 백엔드 REST 클라이언트.
/// TODO: 백엔드 인증이 생기면 Authorization 헤더 추가
class ApiClient {
  ApiClient({String? baseUrl, http.Client? client})
      : baseUrl = baseUrl ?? AppConfig.apiBaseUrl,
        _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  static const _json = {'content-type': 'application/json'};

  Future<SipConfig> getSipConfig(int userId) async {
    final res = await _client.get(_uri('/users/$userId/sip-config'));
    return SipConfig.fromJson(_decode(res) as Map<String, dynamic>);
  }

  Future<void> updatePushToken(
    int userId, {
    required String platform,
    String? pushToken,
    String? voipPushToken,
  }) async {
    final res = await _client.put(
      _uri('/users/$userId/push-token'),
      headers: _json,
      body: jsonEncode({
        'platform': platform,
        'pushToken': ?pushToken,
        'voipPushToken': ?voipPushToken,
      }),
    );
    _decode(res);
  }

  Future<void> reportBroadcast(
    int broadcastId,
    int userId,
    BroadcastReportResult result,
  ) async {
    final res = await _client.post(
      _uri('/broadcasts/$broadcastId/report'),
      headers: _json,
      body: jsonEncode({'userId': userId, 'result': result.name}),
    );
    _decode(res);
  }

  Future<List<InboxItem>> inbox(int userId) async {
    final res = await _client.get(_uri('/broadcasts/inbox/$userId'));
    return (_decode(res) as List)
        .map((e) => InboxItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  String recordingAudioUrl(int recordingId) =>
      '$baseUrl/recordings/$recordingId/audio';

  Object? _decode(http.Response res) {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw ApiException(res.statusCode, res.body);
    }
    if (res.body.isEmpty) return null;
    return jsonDecode(utf8.decode(res.bodyBytes));
  }
}
