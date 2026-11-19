/// 빌드 시 `--dart-define=API_BASE_URL=http://192.168.0.10:3000` 으로 변경.
/// 기본값 10.0.2.2 는 Android 에뮬레이터에서 본 호스트 PC 주소.
class AppConfig {
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  /// 수신 화면이 울리는 시간. 백엔드 BROADCAST_RING_TIMEOUT_SEC(45초)보다 짧게.
  static const ringDuration = Duration(seconds: 40);

  static const appName = '마을방송';
}
