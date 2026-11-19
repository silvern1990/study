import 'package:material_ui/material_ui.dart';

import '../app_state.dart';

/// 내선번호(2xxxx)로 1:1 통화
class DialerScreen extends StatefulWidget {
  const DialerScreen({super.key, required this.app});

  final AppState app;

  @override
  State<DialerScreen> createState() => _DialerScreenState();
}

class _DialerScreenState extends State<DialerScreen> {
  String _number = '';

  static const _keys = [
    '1', '2', '3', //
    '4', '5', '6',
    '7', '8', '9',
    '*', '0', '⌫',
  ];

  void _press(String key) {
    setState(() {
      if (key == '⌫') {
        if (_number.isNotEmpty) {
          _number = _number.substring(0, _number.length - 1);
        }
      } else if (_number.length < 12) {
        _number += key;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // 작은 화면/큰 글꼴에서도 넘치지 않도록: 남는 공간은 고르게 나누고, 모자라면 스크롤
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight - 32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              Text(
                _number.isEmpty ? '번호 입력' : _number,
                style: theme.textTheme.displaySmall?.copyWith(
                  color: _number.isEmpty ? theme.disabledColor : null,
                ),
              ),
              const SizedBox(height: 16),
              for (var row = 0; row < 4; row++)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    children: [
                      for (final key in _keys.sublist(row * 3, row * 3 + 3))
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 5),
                            child: OutlinedButton(
                              style: OutlinedButton.styleFrom(
                                minimumSize: const Size.fromHeight(56),
                              ),
                              onPressed: () => _press(key),
                              child: Text(
                                key,
                                style: theme.textTheme.headlineSmall,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              const SizedBox(height: 12),
              FloatingActionButton.large(
                backgroundColor: Colors.green,
                foregroundColor: Colors.white,
                onPressed: _number.isEmpty
                    ? null
                    : () => widget.app.calls?.startOutgoing(_number),
                child: const Icon(Icons.call, size: 40),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
