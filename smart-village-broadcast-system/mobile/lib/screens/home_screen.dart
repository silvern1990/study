import 'package:material_ui/material_ui.dart';
import 'package:sip_ua/sip_ua.dart';

import '../app_state.dart';
import 'dialer_screen.dart';
import 'inbox_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.app});

  final AppState app;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final app = widget.app;
    final config = app.config!;
    return Scaffold(
      appBar: AppBar(
        title: Text('${config.name} (${config.extension})'),
        actions: [
          _RegistrationChip(app: app),
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'logout') app.logout();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'logout', child: Text('로그아웃')),
            ],
          ),
        ],
      ),
      body: IndexedStack(
        index: _tab,
        children: [
          DialerScreen(app: app),
          InboxScreen(app: app),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dialpad), label: '전화'),
          NavigationDestination(icon: Icon(Icons.campaign), label: '방송함'),
        ],
      ),
    );
  }
}

class _RegistrationChip extends StatelessWidget {
  const _RegistrationChip({required this.app});

  final AppState app;

  @override
  Widget build(BuildContext context) {
    final sip = app.sip;
    if (sip == null) return const SizedBox.shrink();
    return ListenableBuilder(
      listenable: sip,
      builder: (context, _) {
        final (label, color) = switch (sip.registration) {
          RegistrationStateEnum.REGISTERED => ('연결됨', Colors.green),
          RegistrationStateEnum.REGISTRATION_FAILED => ('연결 실패', Colors.red),
          _ => ('연결 중', Colors.orange),
        };
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Chip(
            avatar: Icon(Icons.circle, size: 12, color: color),
            label: Text(label),
          ),
        );
      },
    );
  }
}
