import 'package:material_ui/material_ui.dart';

import '../app_state.dart';
import '../config.dart';

/// PoC 로그인: 관리자가 발급한 사용자 ID 를 입력.
/// TODO: 백엔드 인증 도입 후 전화번호 인증으로 교체
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.app});

  final AppState app;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _controller = TextEditingController();
  bool _loading = false;
  String? _error;

  Future<void> _submit() async {
    final id = int.tryParse(_controller.text.trim());
    if (id == null) {
      setState(() => _error = '사용자 번호를 숫자로 입력하세요.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await widget.app.login(id);
    } catch (e) {
      if (mounted) setState(() => _error = '로그인 실패: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.campaign, size: 72),
              const SizedBox(height: 12),
              Text(
                AppConfig.appName,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 32),
              TextField(
                controller: _controller,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: '사용자 번호',
                  border: OutlineInputBorder(),
                ),
                onSubmitted: (_) => _submit(),
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _loading ? null : _submit,
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(56),
                ),
                child: _loading
                    ? const CircularProgressIndicator()
                    : const Text('시작하기'),
              ),
              const SizedBox(height: 24),
              Text(
                '서버: ${AppConfig.apiBaseUrl}',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
