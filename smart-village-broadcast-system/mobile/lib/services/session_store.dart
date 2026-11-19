import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../api/models.dart';

/// 로그인 정보 보관. 백그라운드 isolate(푸시/수신화면 핸들러)에서도 읽는다.
/// TODO: sipPassword 는 flutter_secure_storage 같은 보안 저장소로 옮기기
class SessionStore {
  static const _kUserId = 'svbs.userId';
  static const _kSipConfig = 'svbs.sipConfig';

  Future<int?> userId() async =>
      (await SharedPreferences.getInstance()).getInt(_kUserId);

  Future<SipConfig?> sipConfig() async {
    final raw = (await SharedPreferences.getInstance()).getString(_kSipConfig);
    if (raw == null) return null;
    return SipConfig.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  Future<void> save(SipConfig config) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_kUserId, config.userId);
    await prefs.setString(_kSipConfig, jsonEncode(config.toJson()));
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kUserId);
    await prefs.remove(_kSipConfig);
  }
}
