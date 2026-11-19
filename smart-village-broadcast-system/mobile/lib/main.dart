import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:material_ui/material_ui.dart';

import 'app_state.dart';
import 'screens/call_screen.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'services/push_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 앱이 꺼져 있을 때의 푸시/수신화면 이벤트 핸들러 (top-level 함수여야 함)
  if (defaultTargetPlatform == TargetPlatform.android) {
    FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);
  }
  await FlutterCallkitIncoming.onBackgroundMessage(callkitBackgroundHandler);

  final navigatorKey = GlobalKey<NavigatorState>();
  final app = AppState(navigatorKey: navigatorKey);
  app.openCallScreen = () => navigatorKey.currentState?.push(
        MaterialPageRoute<void>(
          builder: (_) => CallScreen(calls: app.calls!),
          fullscreenDialog: true,
        ),
      );
  await app.restore();

  runApp(SvbsApp(app: app));
}

class SvbsApp extends StatelessWidget {
  const SvbsApp({super.key, required this.app});

  final AppState app;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '마을방송',
      navigatorKey: app.navigatorKey,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0B6E4F)),
      ),
      // 어르신 사용자를 고려해 글자 크기를 15% 키움 (기기 글꼴 크기 설정 위에 곱함).
      // textTheme.apply(fontSizeFactor) 는 ThemeData 단계에서 fontSize 가 비어 있어 assertion 이 난다.
      builder: (context, child) {
        final mq = MediaQuery.of(context);
        return MediaQuery(
          data: mq.copyWith(
            textScaler: TextScaler.linear(mq.textScaler.scale(1) * 1.15),
          ),
          child: child!,
        );
      },
      home: ListenableBuilder(
        listenable: app,
        builder: (context, _) =>
            app.loggedIn ? HomeScreen(app: app) : LoginScreen(app: app),
      ),
    );
  }
}
