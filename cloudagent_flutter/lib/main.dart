import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:flutter/services.dart';

final ValueNotifier<ThemeMode> themeNotifier = ValueNotifier(ThemeMode.light);

void main() {
  runApp(const CloudAgentApp());
}

class CloudAgentApp extends StatelessWidget {
  const CloudAgentApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: themeNotifier,
      builder: (context, currentMode, child) {
        return MaterialApp(
          title: 'CloudAgent Workspace',
          debugShowCheckedModeBanner: false,
          theme: ThemeData(
            useMaterial3: true,
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF1A73E8), // Google Blue
              primary: const Color(0xFF1A73E8),
              surface: const Color(0xFFF8F9FA), // Workspace grey background
            ),
            cardTheme: const CardThemeData(
              color: Colors.white,
              elevation: 1,
            ),
          ),
          darkTheme: ThemeData(
            useMaterial3: true,
            brightness: Brightness.dark,
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF8AB4F8),
              brightness: Brightness.dark,
            ),
          ),
          themeMode: currentMode,
          home: const MainLayout(),
        );
      },
    );
  }
}

class MainLayout extends StatefulWidget {
  const MainLayout({super.key});

  @override
  State<MainLayout> createState() => _MainLayoutState();
}

class _MainLayoutState extends State<MainLayout> {
  String? _workspacePath;
  late final String _cliSourcePath;
  Process? _cliProcess;
  WebSocketChannel? _webSocketChannel;
  final List<Map<String, dynamic>> _messages = [];
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  
  // Status states
  String _status = 'Disconnected'; // 'Disconnected' | 'Connecting' | 'Idle' | 'Thinking' | 'Running Tool' | 'Error'
  String _currentModel = '';
  String _activeTool = '';
  String _toolThought = '';
  String _gwsEmail = '';
  String _sessionId = '';
  List<String> _suggestedCommands = [];
  List<Map<String, dynamic>> _sessions = [];
  Map<String, dynamic>? _diagnostics;
  bool _inChatView = false;
  int _reconnectAttempts = 0;
  bool _isReconnecting = false;
  
  // Concurrent session maps
  final Map<String, List<Map<String, dynamic>>> _sessionMessages = {};
  final Map<String, String> _sessionStatuses = {};
  final Map<String, String> _sessionActiveTools = {};
  final Map<String, String> _sessionToolThoughts = {};
  final Map<String, Map<String, dynamic>?> _sessionConfirmations = {};

  void _updateSessionState(String sId, {
    List<Map<String, dynamic>>? messages,
    String? status,
    String? activeTool,
    String? toolThought,
    Map<String, dynamic>? pendingConfirmation,
    bool clearConfirmation = false,
  }) {
    if (messages != null) {
      _sessionMessages[sId] = messages;
    }
    if (status != null) {
      _sessionStatuses[sId] = status;
    }
    if (activeTool != null) {
      _sessionActiveTools[sId] = activeTool;
    }
    if (toolThought != null) {
      _sessionToolThoughts[sId] = toolThought;
    }
    if (pendingConfirmation != null) {
      _sessionConfirmations[sId] = pendingConfirmation;
    } else if (clearConfirmation) {
      _sessionConfirmations[sId] = null;
    }

    if (sId == _sessionId) {
      setState(() {
        if (messages != null) {
          _messages.clear();
          _messages.addAll(messages);
        }
        if (status != null) {
          _status = status;
        }
        if (activeTool != null) {
          _activeTool = activeTool;
        }
        if (toolThought != null) {
          _toolThought = toolThought;
        }
        if (pendingConfirmation != null) {
          _pendingConfirmation = pendingConfirmation;
        } else if (clearConfirmation) {
          _pendingConfirmation = null;
        }
      });
    }
  }

  // Dashboard & Configuration states
  Map<String, dynamic>? _dashboardData;
  bool _isLoadingDashboard = false;
  Map<String, dynamic>? _configData;
  bool _widgetsEnabled = true;
  String _themeMode = 'system';
  
  // Pending confirmation state
  Map<String, dynamic>? _pendingConfirmation;

  @override
  void initState() {
    super.initState();
    if (kIsWeb) {
      _cliSourcePath = '/web-placeholder';
      _workspacePath = '/web-placeholder';
      _status = 'Disconnected';
      return;
    }
    if (kReleaseMode) {
      final exeFile = File(Platform.resolvedExecutable);
      _cliSourcePath = '${exeFile.parent.path}/backend';
    } else {
      // The source code of cloudagent is the parent of the Flutter project directory
      _cliSourcePath = Directory.current.parent.path;
    }
    
    // Default workspace to the user's home directory
    final home = Platform.isWindows 
        ? Platform.environment['USERPROFILE'] 
        : Platform.environment['HOME'];
    _workspacePath = home ?? _cliSourcePath;
    
    _startProcess();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _selectWorkspace() async {
    if (kIsWeb) return;
    final result = await FilePicker.getDirectoryPath();
    if (result != null) {
      setState(() {
        _workspacePath = result;
        _messages.clear();
        _status = 'Connecting';
        _gwsEmail = '';
        _currentModel = '';
      });
      _stopProcess();
      _startProcess();
    }
  }

  void _stopProcess() {
    _webSocketChannel?.sink.close();
    _webSocketChannel = null;
    if (kIsWeb) return;
    _cliProcess?.kill();
    _cliProcess = null;
  }

  Future<void> _connectWebSocket() async {
    final channel = WebSocketChannel.connect(Uri.parse('ws://127.0.0.1:3020'));
    await channel.ready;
    _webSocketChannel = channel;
    _webSocketChannel!.stream.listen(
      (message) => _handleCliOutput(message as String),
      onError: (err) {
        debugPrint('WebSocket Error: $err');
        _handleCliError(err);
      },
      onDone: () {
        debugPrint('WebSocket Done');
        _handleCliDone();
      }
    );
  }

  Future<void> _startProcess() async {
    final workspace = _workspacePath;
    if (workspace == null) return;

    try {
      setState(() {
        _status = 'Connecting';
      });

      try {
        await _connectWebSocket();
        return;
      } catch (e) {
        debugPrint('No common backend running, launching local process: $e');
      }

      if (kIsWeb) {
        setState(() {
          _status = 'Error';
          _messages.add({
            'sender': 'system',
            'text': 'No running backend service found. Cannot spawn local background server on web platform.'
          });
        });
        return;
      }

      final serverJs = '$_cliSourcePath/src/server.js';
      
      _cliProcess = await Process.start(
        'node',
        [serverJs],
        workingDirectory: workspace,
      );

      _cliProcess!.stderr
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) {
            debugPrint('Server Stderr: $line');
          });

      await Future.delayed(const Duration(milliseconds: 1500));
      await _connectWebSocket();

    } catch (e) {
      setState(() {
        _status = 'Error';
        _messages.add({
          'sender': 'system',
          'text': 'Failed to connect to backend server. Make sure Node.js is installed in your system PATH and you selected the correct cloudagent workspace.\nError: $e'
        });
      });
    }
  }

  void _handleCliOutput(String line) {
    debugPrint('CLI Stdout: $line');
    if (line.trim().isEmpty) return;

    try {
      final data = jsonDecode(line);
      final type = data['type'];
      final msgSessionId = data['sessionId'] ?? _sessionId;

      _sessionMessages.putIfAbsent(msgSessionId, () => []);
      _sessionStatuses.putIfAbsent(msgSessionId, () => 'Idle');
      _sessionActiveTools.putIfAbsent(msgSessionId, () => '');
      _sessionToolThoughts.putIfAbsent(msgSessionId, () => '');

      if (type == 'session') {
        _sessionId = data['sessionId'] ?? '';
        debugPrint('Session ID: $_sessionId');
        _gwsEmail = data['gwsUserEmail'] ?? '';
        _currentModel = data['activeModel'] ?? '';
        _widgetsEnabled = data['widgetsEnabled'] ?? true;
        _themeMode = data['theme'] ?? 'system';
        _updateAppThemeMode(_themeMode);
        _sessionMessages.putIfAbsent(_sessionId, () => []);
        _sessionStatuses[_sessionId] = 'Idle';
        
        setState(() {
          _status = 'Idle';
          _reconnectAttempts = 0; // reset attempts on success
          final sessionsData = data['sessions'];
          if (sessionsData is List) {
            _sessions = List<Map<String, dynamic>>.from(sessionsData);
          }
        });
        _requestDiagnostics();
        _requestConfig();
        if (_widgetsEnabled) {
          _requestDashboard();
        }
      } else if (type == 'diagnostics') {
        setState(() {
          _diagnostics = data;
        });
      } else if (type == 'dashboard') {
        setState(() {
          _dashboardData = data['data'];
          _isLoadingDashboard = false;
        });
      } else if (type == 'config') {
        setState(() {
          _configData = data['config'];
        });
      } else if (type == 'history') {
        final histSessionId = data['sessionId'] ?? _sessionId;
        final historyMsgs = data['messages'];
        final List<Map<String, dynamic>> loadedMsgs = [];
        if (historyMsgs is List) {
          for (final m in historyMsgs) {
            loadedMsgs.add({
              'sender': m['sender'] ?? 'agent',
              'text': m['text'] ?? '',
              'meta': m['meta']
            });
          }
        }
        _updateSessionState(histSessionId, messages: loadedMsgs, status: 'Idle');
        if (histSessionId == _sessionId) {
          setState(() {
            if (loadedMsgs.isNotEmpty) {
              _inChatView = true;
            }
          });
        }
        _scrollToBottom();
      } else if (type == 'status') {
        final statusVal = data['status'];
        String mappedStatus = 'Idle';
        String actTool = '';
        String thoughtVal = '';
        if (statusVal == 'thinking') {
          mappedStatus = 'Thinking';
        } else if (statusVal == 'running_tool') {
          mappedStatus = 'Running Tool';
          actTool = data['tool'] ?? '';
          thoughtVal = data['thought'] ?? '';
        }
        _updateSessionState(msgSessionId, status: mappedStatus, activeTool: actTool, toolThought: thoughtVal);
      } else if (type == 'tool_start') {
        final list = List<Map<String, dynamic>>.from(_sessionMessages[msgSessionId] ?? []);
        list.add({
          'sender': 'tool',
          'text': 'Running ${data['tool']}...',
          'meta': {
            'type': 'tool',
            'name': data['tool'],
            'arguments': data['arguments'],
            'output': 'Running...',
            'status': 'running',
            'isExpanded': true
          }
        });
        _updateSessionState(msgSessionId, messages: list, status: 'Running Tool', activeTool: data['tool'], toolThought: data['thought'] ?? '');
        _scrollToBottom();
      } else if (type == 'tool_end') {
        final list = List<Map<String, dynamic>>.from(_sessionMessages[msgSessionId] ?? []);
        final toolIdx = list.lastIndexWhere((m) => m['sender'] == 'tool' && m['meta']?['name'] == data['tool']);
        if (toolIdx != -1) {
          final toolMsg = Map<String, dynamic>.from(list[toolIdx]);
          final meta = Map<String, dynamic>.from(toolMsg['meta'] ?? {});
          meta['status'] = data['success'] ? 'success' : 'failed';
          meta['output'] = data['output']?.toString() ?? '';
          meta['isExpanded'] = false; // Auto-collapse
          toolMsg['meta'] = meta;
          toolMsg['text'] = 'Executed ${data['tool']}';
          list[toolIdx] = toolMsg;
        }
        _updateSessionState(msgSessionId, messages: list);
        _scrollToBottom();
      } else if (type == 'tool_log') {
        final list = List<Map<String, dynamic>>.from(_sessionMessages[msgSessionId] ?? []);
        final toolIdx = list.lastIndexWhere((m) => m['sender'] == 'tool' && m['meta']?['name'] == data['tool']);
        if (toolIdx != -1) {
          final toolMsg = Map<String, dynamic>.from(list[toolIdx]);
          final meta = Map<String, dynamic>.from(toolMsg['meta'] ?? {});
          final currentOutput = meta['output']?.toString() ?? '';
          final newOutput = (currentOutput == 'Running...') ? data['log'] : '$currentOutput\n${data['log']}';
          meta['output'] = newOutput;
          toolMsg['meta'] = meta;
          list[toolIdx] = toolMsg;
        }
        _updateSessionState(msgSessionId, messages: list);
        _scrollToBottom();
      } else if (type == 'message') {
        final list = List<Map<String, dynamic>>.from(_sessionMessages[msgSessionId] ?? []);
        list.add({
          'sender': data['sender'] ?? 'agent',
          'text': data['text'] ?? ''
        });
        _updateSessionState(msgSessionId, messages: list, status: 'Idle');
        if (msgSessionId == _sessionId) {
          setState(() {
            _inChatView = true;
          });
        }
        _scrollToBottom();
      } else if (type == 'confirm') {
        final conf = {
          'tool': data['tool'] ?? '',
          'arguments': data['arguments'] ?? {},
          'risk': data['risk'] ?? 'safe'
        };
        _updateSessionState(msgSessionId, pendingConfirmation: conf, status: 'Idle');
        _scrollToBottom();
      } else if (type == 'notification') {
        final title = data['title'] ?? 'Notification';
        final message = data['message'] ?? '';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle_rounded, color: Colors.green),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                      Text(message, style: const TextStyle(fontSize: 11)),
                    ],
                  ),
                ),
              ],
            ),
            behavior: SnackBarBehavior.floating,
            margin: const EdgeInsets.all(16),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            duration: const Duration(seconds: 4),
          ),
        );
      } else if (type == 'error') {
        final list = List<Map<String, dynamic>>.from(_sessionMessages[msgSessionId] ?? []);
        list.add({
          'sender': 'system',
          'text': data['error'] ?? 'An unknown error occurred.'
        });
        _updateSessionState(msgSessionId, messages: list, status: 'Error');
        _scrollToBottom();
      }
    } catch (e) {
      // Fallback: if output is not JSON, render it as a log message
      final list = List<Map<String, dynamic>>.from(_sessionMessages[_sessionId] ?? []);
      list.add({
        'sender': 'system',
        'text': line
      });
      _updateSessionState(_sessionId, messages: list);
      _scrollToBottom();
    }
  }

  void _handleCliError(dynamic err) {
    final list = List<Map<String, dynamic>>.from(_sessionMessages[_sessionId] ?? []);
    list.add({
      'sender': 'system',
      'text': 'Stream error occurred: $err'
    });
    _updateSessionState(_sessionId, messages: list, status: 'Error');
    _scrollToBottom();
    _attemptAutoReconnect();
  }

  void _handleCliDone() {
    final list = List<Map<String, dynamic>>.from(_sessionMessages[_sessionId] ?? []);
    list.add({
      'sender': 'system',
      'text': 'CloudAgent backend process terminated.'
    });
    _updateSessionState(_sessionId, messages: list, status: 'Disconnected');
    _scrollToBottom();
    _attemptAutoReconnect();
  }

  void _attemptAutoReconnect() {
    if (_isReconnecting) return;
    if (_reconnectAttempts >= 5) {
      debugPrint('Max auto-reconnect attempts reached.');
      return;
    }
    
    _isReconnecting = true;
    _reconnectAttempts++;
    debugPrint('Attempting auto-reconnect $_reconnectAttempts/5 in 2 seconds...');
    
    Future.delayed(const Duration(seconds: 2), () {
      _isReconnecting = false;
      // Only reconnect if we are still disconnected or in error state
      if (_status == 'Disconnected' || _status == 'Error') {
        _startProcess();
      }
    });
  }

  void _sendMessage() {
    final text = _messageController.text.trim();
    if (text.isEmpty || _webSocketChannel == null) return;

    final list = List<Map<String, dynamic>>.from(_sessionMessages[_sessionId] ?? []);
    list.add({
      'sender': 'user',
      'text': text
    });
    _updateSessionState(_sessionId, messages: list);
    
    setState(() {
      _messageController.clear();
      _suggestedCommands = [];
      _inChatView = true;
      _scrollToBottom();
    });

    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'message',
      'text': text
    }));
  }

  void _stopMessageExecution() {
    if (_webSocketChannel == null || _sessionId.isEmpty) return;
    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'stop_session',
      'sessionId': _sessionId,
    }));
  }

  void _onInputChanged(String val) {
    setState(() {
      if (val.isNotEmpty) {
        _inChatView = true;
      } else if (val.isEmpty && _messages.isEmpty) {
        _inChatView = false;
      }
      if (val == '/') {
        _suggestedCommands = ['/help', '/sheets', '/docs', '/contacts', '/models', '/clear'];
      } else if (val.startsWith('/')) {
        final query = val.toLowerCase();
        _suggestedCommands = ['/help', '/sheets', '/docs', '/contacts', '/models', '/clear']
            .where((cmd) => cmd.startsWith(query))
            .toList();
      } else {
        _suggestedCommands = [];
      }
    });
  }

  void _handleSuggestionClick(String cmd) {
    setState(() {
      _inChatView = true;
      if (cmd == '/help') {
        _messageController.text = 'help';
        _suggestedCommands = [];
        _sendMessage();
      } else if (cmd == '/clear') {
        _messageController.clear();
        _suggestedCommands = [];
        final list = List<Map<String, dynamic>>.from(_sessionMessages[_sessionId] ?? []);
        list.clear();
        list.add({'sender': 'system', 'text': 'Chat history cleared locally.'});
        _updateSessionState(_sessionId, messages: list);
        _inChatView = false;
      } else if (cmd == '/sheets') {
        _suggestedCommands = [
          'Create a new sheet named "test"',
          'Read range Sheet1!A1:B10 of "sheet-name"',
          'Append "John,35" to sheet "data-sheet"'
        ];
        _messageController.text = '';
      } else if (cmd == '/docs') {
        _suggestedCommands = [
          'Create a new doc named "notes"',
          'Read document "notes"',
          'Append "done" to document "notes"'
        ];
        _messageController.text = '';
      } else if (cmd == '/contacts') {
        _suggestedCommands = [
          'List my contacts',
          'Search contacts for "John"',
          'Create contact "Bob Smith" bob@example.com'
        ];
        _messageController.text = '';
      } else if (cmd == '/models') {
        _messageController.text = '/models';
        _suggestedCommands = [];
        _sendMessage();
      } else {
        _messageController.text = cmd;
        _suggestedCommands = [];
      }
    });
  }

  void _requestDiagnostics() {
    if (_webSocketChannel == null) return;
    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'get_diagnostics'
    }));
  }

  void _requestDashboard() {
    if (_webSocketChannel == null) return;
    setState(() {
      _isLoadingDashboard = true;
    });
    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'get_dashboard'
    }));
  }

  void _requestConfig() {
    if (_webSocketChannel == null) return;
    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'get_config'
    }));
  }

  void _saveConfig(Map<String, dynamic> updatePayload) {
    if (_webSocketChannel == null) return;
    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'update_config',
      ...updatePayload
    }));
  }

  void _updateAppThemeMode(String mode) {
    if (mode == 'light') {
      themeNotifier.value = ThemeMode.light;
    } else if (mode == 'dark') {
      themeNotifier.value = ThemeMode.dark;
    } else {
      themeNotifier.value = ThemeMode.system;
    }
  }

  void _switchSession(String targetSessionId) {
    if (_webSocketChannel == null) return;
    setState(() {
      _sessionId = targetSessionId;
      _messages.clear();
      _messages.addAll(_sessionMessages[targetSessionId] ?? []);
      _status = _sessionStatuses[targetSessionId] ?? 'Idle';
      _activeTool = _sessionActiveTools[targetSessionId] ?? '';
      _toolThought = _sessionToolThoughts[targetSessionId] ?? '';
      _pendingConfirmation = _sessionConfirmations[targetSessionId];
      _inChatView = _messages.isNotEmpty;
    });
    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'switch_session',
      'sessionId': targetSessionId,
    }));
  }

  void _startNewSession() {
    if (_webSocketChannel == null) return;
    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'new_session',
    }));
  }

  void _deleteSession(String targetSessionId) {
    if (_webSocketChannel == null) return;
    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'delete_session',
      'sessionId': targetSessionId,
    }));
  }

  void _renameSession(String targetSessionId, String newName) {
    if (_webSocketChannel == null) return;
    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'rename_session',
      'sessionId': targetSessionId,
      'name': newName,
    }));
  }

  void _aiRenameSession(String targetSessionId) {
    if (_webSocketChannel == null) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Auto-renaming conversation using AI...'), duration: Duration(seconds: 2)),
    );
    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'ai_rename_session',
      'sessionId': targetSessionId,
    }));
  }

  void _showRenameDialog(String sessionId, String currentName) {
    final controller = TextEditingController(text: currentName);
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Rename Conversation', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: 'Enter new name',
            border: OutlineInputBorder(),
          ),
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              final newName = controller.text.trim();
              if (newName.isNotEmpty) {
                _renameSession(sessionId, newName);
              }
              Navigator.pop(context);
            },
            child: const Text('Rename'),
          ),
        ],
      ),
    );
  }

  void _sendConfirmation(bool approved) {
    if (_webSocketChannel == null || _pendingConfirmation == null) return;

    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'confirm',
      'approved': approved
    }));

    setState(() {
      _messages.add({
        'sender': 'system',
        'text': approved ? 'Action approved.' : 'Action rejected.'
      });
      _pendingConfirmation = null;
      _scrollToBottom();
    });
  }

  @override
  void dispose() {
    _stopProcess();
    _webSocketChannel?.sink.close();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF121214) : const Color(0xFFF8F9FA),
      body: Row(
        children: [
          // Sidebar Panel - Sleek slate aesthetic
          Container(
            width: 290,
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF18181C) : Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: isDark ? 0.3 : 0.05),
                  blurRadius: 10,
                  offset: const Offset(2, 0),
                )
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header Logo with Glow effect
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 40, 24, 24),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Icon(
                          Icons.cloud_sync_rounded,
                          color: Theme.of(context).colorScheme.primary,
                          size: 28,
                        ),
                      ),
                      const SizedBox(width: 14),
                      const Text(
                        'CloudAgent',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.5,
                        ),
                      ),
                    ],
                  ),
                ),
                
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 20),
                  child: Divider(height: 1),
                ),
                
                // Workspace info
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
                    children: [
                      // Active directory Card
                      _buildSidebarCard(
                        title: 'WORKSPACE DIRECTORY',
                        icon: Icons.folder_open_rounded,
                        iconColor: Colors.amber[700]!,
                        content: Text(
                          _workspacePath ?? 'Not Selected',
                          style: TextStyle(
                            fontSize: 12, 
                            fontFamily: 'monospace',
                            color: isDark ? Colors.grey[300] : Colors.grey[700],
                          ),
                        ),
                        trailing: IconButton(
                          icon: const Icon(Icons.edit_note_rounded, size: 20),
                          onPressed: _selectWorkspace,
                          tooltip: 'Choose Workspace Directory',
                        ),
                      ),
                      
                      const SizedBox(height: 16),
                      
                      // GWS Account Card
                      _buildSidebarCard(
                        title: 'GOOGLE WORKSPACE',
                        icon: Icons.account_circle_rounded,
                        iconColor: _gwsEmail.isNotEmpty ? Colors.blue[600]! : Colors.red[600]!,
                        content: Text(
                          _gwsEmail.isNotEmpty ? _gwsEmail : 'Not Logged In',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: _gwsEmail.isNotEmpty 
                                ? (isDark ? Colors.green[300] : Colors.green[800]) 
                                : Colors.red[600],
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),

                      const SizedBox(height: 16),

                      // Model Card
                      if (_currentModel.isNotEmpty)
                        _buildSidebarCard(
                          title: 'ACTIVE MODEL',
                          icon: Icons.psychology_rounded,
                          iconColor: Colors.deepPurple[600]!,
                          content: Text(
                            _currentModel,
                            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                          ),
                        ),

                      const SizedBox(height: 16),

                      // Connection Status Card
                      _buildSidebarCard(
                        title: 'SERVICE STATUS',
                        icon: Icons.network_ping_rounded,
                        iconColor: _getStatusColor(_status),
                        content: Row(
                          children: [
                            Container(
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: _getStatusColor(_status),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              _status,
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                            ),
                          ],
                        ),
                        trailing: IconButton(
                          icon: const Icon(Icons.settings_rounded, size: 18),
                          onPressed: _showSettingsDialog,
                          tooltip: 'Settings',
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                        ),
                      ),

                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            'PAST CONVERSATIONS',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.8,
                              color: Colors.grey,
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.add_rounded, size: 16),
                            onPressed: _startNewSession,
                            tooltip: 'New Session',
                            constraints: const BoxConstraints(),
                            padding: EdgeInsets.zero,
                          ),
                        ],
                      ),
                      
                      const SizedBox(height: 8),

                      if (_sessions.isEmpty)
                        Text(
                          'No past conversations',
                          style: TextStyle(fontSize: 11, color: Colors.grey[500]),
                        ),

                      ..._sessions.map((s) {
                        final isSelected = s['id'] == _sessionId;
                        final name = s['name'] ?? s['id'];
                        return Container(
                          margin: const EdgeInsets.symmetric(vertical: 2),
                          child: InkWell(
                            onTap: () => _switchSession(s['id']),
                            borderRadius: BorderRadius.circular(8),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              decoration: BoxDecoration(
                                color: isSelected 
                                    ? Theme.of(context).colorScheme.primary.withValues(alpha: 0.08)
                                    : Colors.transparent,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Row(
                                children: [
                                  Icon(
                                    Icons.chat_bubble_outline_rounded,
                                    size: 14,
                                    color: isSelected ? Theme.of(context).colorScheme.primary : Colors.grey[500],
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      name,
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                        color: isSelected ? Theme.of(context).colorScheme.primary : null,
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  IconButton(
                                    icon: Icon(Icons.edit_rounded, size: 13, color: isDark ? Colors.grey[500] : Colors.grey[600]),
                                    padding: EdgeInsets.zero,
                                    constraints: const BoxConstraints(),
                                    onPressed: () => _aiRenameSession(s['id']),
                                    tooltip: 'Rename Chat by AI',
                                  ),
                                  const SizedBox(width: 4),
                                  PopupMenuButton<String>(
                                    icon: Icon(Icons.more_vert_rounded, size: 14, color: isDark ? Colors.grey[500] : Colors.grey[600]),
                                    padding: EdgeInsets.zero,
                                    constraints: const BoxConstraints(),
                                    itemBuilder: (context) => [
                                      const PopupMenuItem(
                                        value: 'rename',
                                        child: Row(
                                          children: [
                                            Icon(Icons.edit_rounded, size: 14),
                                            SizedBox(width: 8),
                                            Text('Rename', style: TextStyle(fontSize: 12)),
                                          ],
                                        ),
                                      ),
                                      const PopupMenuItem(
                                        value: 'delete',
                                        child: Row(
                                          children: [
                                            Icon(Icons.delete_rounded, size: 14, color: Colors.red),
                                            SizedBox(width: 8),
                                            Text('Delete', style: TextStyle(fontSize: 12, color: Colors.red)),
                                          ],
                                        ),
                                      ),
                                    ],
                                    onSelected: (val) {
                                      if (val == 'delete') {
                                        _deleteSession(s['id']);
                                      } else if (val == 'rename') {
                                        _showRenameDialog(s['id'], name);
                                      }
                                    },
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      }),
                    ],
                  ),
                ),
                
                // Sidebar Footer
                Padding(
                  padding: const EdgeInsets.all(20.0),
                  child: Row(
                    children: [
                      const Text(
                        'v2.0',
                        style: TextStyle(fontSize: 11, color: Colors.grey),
                      ),
                      const Spacer(),
                      if (_status == 'Disconnected' || _status == 'Error')
                        ElevatedButton.icon(
                          onPressed: _startProcess,
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                          ),
                          icon: const Icon(Icons.refresh, size: 14),
                          label: const Text('Reconnect', style: TextStyle(fontSize: 11)),
                        ),
                    ],
                  ),
                )
              ],
            ),
          ),
          
          // Main Chat Area
          Expanded(
            child: Column(
              children: [
                // Clean Top header
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF1E1E24) : Colors.white,
                    border: Border(
                      bottom: BorderSide(
                        color: isDark ? Colors.grey[900]! : Colors.grey[200]!,
                      ),
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.dashboard_customize_rounded, color: Colors.grey[600], size: 20),
                      const SizedBox(width: 10),
                      Text(
                        'Workspace Session',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: isDark ? Colors.grey[300] : Colors.grey[800],
                        ),
                      ),
                      const SizedBox(width: 16),
                      TextButton.icon(
                        onPressed: () {
                          setState(() {
                            _inChatView = false;
                          });
                        },
                        icon: const Icon(Icons.home_rounded, size: 18),
                        label: const Text('Home'),
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          foregroundColor: isDark ? Colors.grey[350] : Colors.grey[700],
                        ),
                      ),
                      const Spacer(),
                      if (_status == 'Thinking')
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.orange.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Row(
                            children: [
                              SizedBox(
                                width: 10,
                                height: 10,
                                child: CircularProgressIndicator(strokeWidth: 1.5, color: Colors.orange),
                              ),
                              SizedBox(width: 6),
                              Text('Thinking...', style: TextStyle(color: Colors.orange, fontSize: 10, fontWeight: FontWeight.bold)),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),

                // Active tool indicator header if executing a tool
                if (_status == 'Running Tool' && _activeTool.isNotEmpty)
                  Container(
                    width: double.infinity,
                    color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.08),
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                    child: Row(
                      children: [
                        const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Running Tool: $_activeTool',
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                              ),
                              if (_toolThought.isNotEmpty)
                                Text(
                                  _toolThought,
                                  style: TextStyle(fontSize: 11, color: Colors.grey[600]),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),

                // Diagnostics Onboarding Banner
                _buildDiagnosticsBanner(),

                // Messages List
                Expanded(
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 400),
                    switchInCurve: Curves.easeInOutCubic,
                    switchOutCurve: Curves.easeInOutCubic,
                    transitionBuilder: (Widget child, Animation<double> animation) {
                      return FadeTransition(
                        opacity: animation,
                        child: SlideTransition(
                          position: Tween<Offset>(
                            begin: const Offset(0, 0.05),
                            end: Offset.zero,
                          ).animate(animation),
                          child: child,
                        ),
                      );
                    },
                    child: (!_inChatView && _widgetsEnabled)
                        ? KeyedSubtree(
                            key: const ValueKey('dashboard_view'),
                            child: _buildDashboard(),
                          )
                        : KeyedSubtree(
                            key: const ValueKey('chat_view'),
                            child: _messages.isEmpty
                                ? Center(
                                    child: Column(
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        Icon(
                                          Icons.chat_bubble_outline_rounded,
                                          size: 54,
                                          color: Colors.grey[400],
                                        ),
                                        const SizedBox(height: 18),
                                        const Text(
                                          'Start a conversation with CloudAgent',
                                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                                        ),
                                        const SizedBox(height: 8),
                                        Text(
                                          'Ask to check emails, create sheets, list calendar events, or search files.',
                                          style: TextStyle(color: Colors.grey[500], fontSize: 13),
                                        ),
                                      ],
                                    ),
                                  )
                                : ListView.builder(
                                    controller: _scrollController,
                                    padding: const EdgeInsets.all(24),
                                    itemCount: _messages.length,
                                    itemBuilder: (context, index) {
                                      final msg = _messages[index];
                                      final isUser = msg['sender'] == 'user';
                                      final isSystem = msg['sender'] == 'system';
                                      final isTool = msg['sender'] == 'tool';
                                      
                                      if (isTool) {
                                        return _buildToolLogWidget(msg);
                                      }
                                      
                                      if (isSystem) {
                                        return Padding(
                                          padding: const EdgeInsets.symmetric(vertical: 10.0),
                                          child: Center(
                                            child: Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                                              decoration: BoxDecoration(
                                                color: isDark ? Colors.grey[900] : const Color(0xFFE9ECEF),
                                                borderRadius: BorderRadius.circular(12),
                                              ),
                                              child: Text(
                                                msg['text'] ?? '',
                                                style: TextStyle(
                                                  fontSize: 11,
                                                  color: isDark ? Colors.grey[400] : Colors.grey[700],
                                                  fontFamily: 'monospace',
                                                ),
                                              ),
                                            ),
                                          ),
                                        );
                                      }

                                      return Align(
                                        alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                                        child: Row(
                                          mainAxisSize: MainAxisSize.min,
                                          mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
                                          crossAxisAlignment: CrossAxisAlignment.end,
                                          children: [
                                            if (!isUser) ...[
                                              IconButton(
                                                icon: Icon(Icons.copy_rounded, size: 13, color: isDark ? Colors.grey[500] : Colors.grey[600]),
                                                tooltip: 'Copy Message',
                                                padding: const EdgeInsets.all(4),
                                                constraints: const BoxConstraints(),
                                                onPressed: () {
                                                  Clipboard.setData(ClipboardData(text: msg['text'] ?? ''));
                                                  ScaffoldMessenger.of(context).showSnackBar(
                                                    const SnackBar(content: Text('Message copied to clipboard!'), duration: Duration(seconds: 1)),
                                                  );
                                                },
                                              ),
                                              const SizedBox(width: 6),
                                            ],
                                            Container(
                                              constraints: BoxConstraints(
                                                maxWidth: MediaQuery.of(context).size.width * 0.65,
                                              ),
                                              margin: const EdgeInsets.symmetric(vertical: 8),
                                              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                                              decoration: BoxDecoration(
                                                gradient: isUser
                                                    ? LinearGradient(
                                                        colors: [
                                                          Theme.of(context).colorScheme.primary,
                                                          Theme.of(context).colorScheme.primary.withValues(alpha: 0.8),
                                                        ],
                                                        begin: Alignment.topLeft,
                                                        end: Alignment.bottomRight,
                                                      )
                                                    : null,
                                                color: isUser
                                                    ? null
                                                    : (isDark ? const Color(0xFF1E1E24) : Colors.white),
                                                borderRadius: BorderRadius.only(
                                                  topLeft: const Radius.circular(20),
                                                  topRight: const Radius.circular(20),
                                                  bottomLeft: Radius.circular(isUser ? 20 : 4),
                                                  bottomRight: Radius.circular(isUser ? 4 : 20),
                                                ),
                                                boxShadow: [
                                                  BoxShadow(
                                                    color: Colors.black.withValues(alpha: isDark ? 0.2 : 0.04),
                                                    blurRadius: 6,
                                                    offset: const Offset(0, 3),
                                                  )
                                                ],
                                                border: isUser 
                                                    ? null 
                                                    : Border.all(color: isDark ? Colors.grey[900]! : Colors.grey[200]!),
                                              ),
                                              child: MarkdownBody(
                                                data: msg['text'] ?? '',
                                                selectable: true,
                                                styleSheet: MarkdownStyleSheet(
                                                  p: TextStyle(
                                                    color: isUser ? Colors.white : (isDark ? Colors.grey[200] : Colors.black87),
                                                    fontSize: 14.5,
                                                    height: 1.45,
                                                  ),
                                                  code: TextStyle(
                                                    fontFamily: 'monospace',
                                                    backgroundColor: isUser 
                                                        ? Colors.white.withValues(alpha: 0.15) 
                                                        : (isDark ? Colors.black26 : Colors.grey[200]),
                                                    fontSize: 13,
                                                  ),
                                                  listBullet: TextStyle(
                                                    color: isUser ? Colors.white : (isDark ? Colors.grey[300] : Colors.black87),
                                                  ),
                                                ),
                                              ),
                                            ),
                                            if (isUser) ...[
                                              const SizedBox(width: 6),
                                              IconButton(
                                                icon: Icon(Icons.copy_rounded, size: 13, color: isDark ? Colors.grey[500] : Colors.grey[600]),
                                                tooltip: 'Copy Message',
                                                padding: const EdgeInsets.all(4),
                                                constraints: const BoxConstraints(),
                                                onPressed: () {
                                                  Clipboard.setData(ClipboardData(text: msg['text'] ?? ''));
                                                  ScaffoldMessenger.of(context).showSnackBar(
                                                    const SnackBar(content: Text('Message copied to clipboard!'), duration: Duration(seconds: 1)),
                                                  );
                                                },
                                              ),
                                            ],
                                          ],
                                        ),
                                      );
                                    },
                                  ),
                          ),
                  ),
                ),

                // Inline Confirmation Panel
                if (_pendingConfirmation != null)
                  _buildConfirmationCard(context),

                // Suggestions Panel
                _buildSuggestionsPanel(),

                // Message Input Panel
                Container(
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF121214) : const Color(0xFFF8F9FA),
                    border: Border(
                      top: BorderSide(
                        color: isDark ? Colors.grey[900]! : Colors.grey[200]!,
                      ),
                    ),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  child: Row(
                    children: [
                      Expanded(
                        child: Container(
                          decoration: BoxDecoration(
                            color: isDark ? const Color(0xFF1E1E24) : Colors.white,
                            borderRadius: BorderRadius.circular(28),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.03),
                                blurRadius: 4,
                                offset: const Offset(0, 2),
                              )
                            ],
                          ),
                          child: TextField(
                            controller: _messageController,
                            onChanged: _onInputChanged,
                            onSubmitted: (_) => _sendMessage(),
                            enabled: _status != 'Connecting' && _pendingConfirmation == null,
                            decoration: InputDecoration(
                              hintText: _pendingConfirmation != null 
                                  ? 'Please confirm or deny the requested action above...'
                                  : 'Type a workspace command (e.g. "Draft an email to Bob")',
                              hintStyle: const TextStyle(fontSize: 13.5),
                              border: InputBorder.none,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                            ),
                            style: const TextStyle(fontSize: 14.5),
                          ),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Builder(
                        builder: (context) {
                          final isRunning = _status == 'Thinking' || _status == 'Running Tool';
                          return FloatingActionButton(
                            onPressed: isRunning ? _stopMessageExecution : _sendMessage,
                            elevation: 2,
                            backgroundColor: isRunning ? Colors.red : Theme.of(context).colorScheme.primary,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            child: Icon(isRunning ? Icons.stop_rounded : Icons.send_rounded, size: 20),
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildToolLogWidget(Map<String, dynamic> msg) {
    final meta = msg['meta'] ?? {};
    final toolName = meta['name'] ?? '';
    final arguments = meta['arguments'] ?? {};
    final output = meta['output'] ?? '';
    final status = meta['status'] ?? ''; // 'running', 'success', 'failed'
    final isExpanded = meta['isExpanded'] ?? false;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    IconData statusIcon = Icons.help_outline_rounded;
    Color statusColor = Colors.grey;
    if (status == 'running') {
      statusIcon = Icons.hourglass_empty_rounded;
      statusColor = Colors.orange;
    } else if (status == 'success') {
      statusIcon = Icons.check_circle_outline_rounded;
      statusColor = Colors.green;
    } else if (status == 'failed') {
      statusIcon = Icons.error_outline_rounded;
      statusColor = Colors.red;
    }

    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        width: MediaQuery.of(context).size.width * 0.7,
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF1E1E24) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isDark ? Colors.grey[900]! : Colors.grey[300]!,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InkWell(
              onTap: () {
                setState(() {
                  meta['isExpanded'] = !isExpanded;
                });
              },
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                child: Row(
                  children: [
                    status == 'running'
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.orange),
                          )
                        : Icon(statusIcon, color: statusColor, size: 16),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Tool Run: $toolName',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                    ),
                    Icon(
                      isExpanded ? Icons.expand_less_rounded : Icons.expand_more_rounded,
                      size: 18,
                      color: Colors.grey,
                    ),
                  ],
                ),
              ),
            ),
            if (isExpanded)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: isDark ? Colors.black26 : const Color(0xFFF8F9FA),
                  border: Border(
                    top: BorderSide(color: isDark ? Colors.grey[900]! : Colors.grey[200]!),
                  ),
                  borderRadius: const BorderRadius.vertical(bottom: Radius.circular(12)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('ARGUMENTS', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.grey)),
                    const SizedBox(height: 4),
                    Text(
                      jsonEncode(arguments),
                      style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
                    ),
                    const SizedBox(height: 12),
                    const Text('LOG OUTPUT', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.grey)),
                    const SizedBox(height: 4),
                    Text(
                      output,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: status == 'failed' ? Colors.red : (isDark ? Colors.grey[300] : Colors.black87),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSidebarCard({
    required String title,
    required IconData icon,
    required Color iconColor,
    required Widget content,
    Widget? trailing,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF222228) : const Color(0xFFF1F3F5),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isDark ? Colors.grey[900]! : Colors.grey[200]!),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: iconColor),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.8,
                    color: Colors.grey,
                  ),
                ),
              ),
              if (trailing != null) trailing,
            ],
          ),
          const SizedBox(height: 10),
          content,
        ],
      ),
    );
  }

  Widget _buildConfirmationCard(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final risk = _pendingConfirmation?['risk'] ?? 'safe';
    final isHighRisk = risk == 'high';
    final tool = _pendingConfirmation?['tool'] ?? '';
    final args = _pendingConfirmation?['arguments'] ?? {};

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(24, 0, 24, 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: isHighRisk 
            ? (isDark ? const Color(0xFF3E1F1F) : const Color(0xFFFDE8E8))
            : (isDark ? const Color(0xFF2C2C2C) : const Color(0xFFF9F9F9)),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isHighRisk ? Colors.red : (isDark ? Colors.grey[800]! : Colors.grey[300]!),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                isHighRisk ? Icons.warning_amber_rounded : Icons.info_outline_rounded,
                color: isHighRisk ? Colors.red : Colors.orange,
                size: 24,
              ),
              const SizedBox(width: 12),
              Text(
                isHighRisk ? 'Warning: High-Risk Action Requested!' : 'Action Confirmation Requested',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                  color: isHighRisk ? Colors.red : null,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'The AI agent wants to execute the tool: $tool',
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
          ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: isDark ? Colors.black26 : Colors.white,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              jsonEncode(args),
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                onPressed: () => _sendConfirmation(false),
                child: const Text('Reject', style: TextStyle(color: Colors.red)),
              ),
              const SizedBox(width: 12),
              ElevatedButton(
                onPressed: () => _sendConfirmation(true),
                style: ElevatedButton.styleFrom(
                  backgroundColor: isHighRisk ? Colors.red : null,
                  foregroundColor: isHighRisk ? Colors.white : null,
                ),
                child: const Text('Approve'),
              ),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildSuggestionsPanel() {
    if (_suggestedCommands.isEmpty) return const SizedBox.shrink();

    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
      color: isDark ? const Color(0xFF1E1E24) : Colors.white,
      child: Wrap(
        spacing: 8,
        runSpacing: 6,
        children: _suggestedCommands.map((cmd) {
          final isSlashCmd = cmd.startsWith('/');
          return ActionChip(
            label: Text(cmd),
            onPressed: () => _handleSuggestionClick(cmd),
            backgroundColor: isSlashCmd 
                ? Theme.of(context).colorScheme.primary.withValues(alpha: 0.08)
                : (isDark ? Colors.grey[850] : Colors.grey[200]),
            labelStyle: TextStyle(
              fontSize: 12.5,
              color: isSlashCmd ? Theme.of(context).colorScheme.primary : (isDark ? Colors.grey[300] : Colors.grey[800]),
              fontWeight: isSlashCmd ? FontWeight.bold : FontWeight.normal,
            ),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildDiagnosticsBanner() {
    if (_diagnostics == null) return const SizedBox.shrink();
    final healthy = _diagnostics!['healthy'] ?? true;
    if (healthy) return const SizedBox.shrink();

    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      margin: const EdgeInsets.fromLTRB(24, 16, 24, 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF3E2D1F) : const Color(0xFFFFF3CD),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isDark ? Colors.amber[900]! : Colors.amber[300]!,
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.warning_amber_rounded,
            color: isDark ? Colors.amber[300] : Colors.amber[800],
            size: 20,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Some dependencies are missing or require attention.',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    color: isDark ? Colors.amber[100] : Colors.amber[900],
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Your agent may not work correctly until these are resolved.',
                  style: TextStyle(
                    fontSize: 11.5,
                    color: isDark ? Colors.amber[200] : Colors.amber[800],
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: _showDiagnosticsBottomSheet,
            style: TextButton.styleFrom(
              foregroundColor: isDark ? Colors.amber[300] : Colors.amber[900],
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            ),
            child: const Text(
              'Run Diagnostics',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }

  void _showDiagnosticsBottomSheet() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      backgroundColor: Theme.of(context).brightness == Brightness.dark ? const Color(0xFF1E1E24) : Colors.white,
      builder: (context) {
        final checks = _diagnostics?['checks'] as List? ?? [];
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'CloudAgent Setup Checklist',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                    IconButton(
                      icon: const Icon(Icons.refresh_rounded),
                      onPressed: () {
                        _requestDiagnostics();
                        Navigator.pop(context);
                      },
                      tooltip: 'Re-run Checks',
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Expanded(
                  child: ListView.builder(
                    itemCount: checks.length,
                    itemBuilder: (context, idx) {
                      final c = checks[idx] as Map<String, dynamic>;
                      final ok = c['ok'] ?? false;
                      final name = c['name'] ?? '';
                      final msg = c['message'] ?? '';
                      return ListTile(
                        leading: Icon(
                          ok ? Icons.check_circle_rounded : Icons.cancel_rounded,
                          color: ok ? Colors.green : Colors.red,
                        ),
                        title: Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
                        subtitle: Text(msg, style: TextStyle(fontSize: 11.5, color: Colors.grey[600])),
                        contentPadding: EdgeInsets.zero,
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildDashboard() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    final emails = _dashboardData?['emails'] as List? ?? [];
    final events = _dashboardData?['events'] as List? ?? [];
    final tasks = _dashboardData?['tasks'] as List? ?? [];

    final loadingWidget = const Padding(
      padding: EdgeInsets.symmetric(vertical: 24),
      child: Center(
        child: SizedBox(
          width: 20,
          height: 20,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      ),
    );

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Welcome to CloudAgent',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: isDark ? Colors.white : Colors.black87,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Here is a quick overview of your Google Workspace status:',
                      style: TextStyle(
                        fontSize: 13.5,
                        color: isDark ? Colors.grey[400] : Colors.grey[600],
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.refresh_rounded),
                onPressed: _isLoadingDashboard ? null : _requestDashboard,
                tooltip: 'Refresh Workspace Status',
              ),
            ],
          ),
          const SizedBox(height: 24),
          
          LayoutBuilder(
            builder: (context, constraints) {
              final useVertical = constraints.maxWidth < 700;
              if (useVertical) {
                return Column(
                  children: [
                    _buildDashboardCard('Recent Emails', Icons.email_outlined, Colors.red[400]!, _isLoadingDashboard ? loadingWidget : _buildEmailWidgetList(emails)),
                    const SizedBox(height: 16),
                    _buildDashboardCard('Upcoming Meetings', Icons.calendar_today_outlined, Colors.blue[400]!, _isLoadingDashboard ? loadingWidget : _buildEventWidgetList(events)),
                    const SizedBox(height: 16),
                    _buildDashboardCard('Pending Tasks', Icons.check_circle_outline_rounded, Colors.green[400]!, _isLoadingDashboard ? loadingWidget : _buildTaskWidgetList(tasks)),
                  ],
                );
              }
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: _buildDashboardCard('Recent Emails', Icons.email_outlined, Colors.red[400]!, _isLoadingDashboard ? loadingWidget : _buildEmailWidgetList(emails)),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: _buildDashboardCard('Upcoming Meetings', Icons.calendar_today_outlined, Colors.blue[400]!, _isLoadingDashboard ? loadingWidget : _buildEventWidgetList(events)),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: _buildDashboardCard('Pending Tasks', Icons.check_circle_outline_rounded, Colors.green[400]!, _isLoadingDashboard ? loadingWidget : _buildTaskWidgetList(tasks)),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildDashboardCard(String title, IconData icon, Color color, Widget content) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E1E24) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isDark ? Colors.grey[900]! : Colors.grey[200]!),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: isDark ? 0.2 : 0.03),
            blurRadius: 6,
            offset: const Offset(0, 3),
          )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 20),
              const SizedBox(width: 10),
              Text(
                title,
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
              ),
            ],
          ),
          const SizedBox(height: 16),
          content,
        ],
      ),
    );
  }

  Widget _buildEmailWidgetList(List emails) {
    if (emails.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 20),
        child: Center(child: Text('No unread emails', style: TextStyle(fontSize: 12, color: Colors.grey))),
      );
    }
    return Column(
      children: emails.map((item) {
        final subject = item['subject'] ?? 'No Subject';
        final from = item['from'] ?? 'Unknown Sender';
        final date = item['date']?.toString() ?? '';
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                subject,
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12.5),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      from,
                      style: const TextStyle(fontSize: 11, color: Colors.grey),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (date.isNotEmpty)
                    Text(
                      date,
                      style: const TextStyle(fontSize: 10, color: Colors.grey),
                    ),
                ],
              ),
              const Divider(height: 12),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildEventWidgetList(List events) {
    if (events.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 20),
        child: Center(child: Text('No upcoming events', style: TextStyle(fontSize: 12, color: Colors.grey))),
      );
    }
    return Column(
      children: events.map((item) {
        final summary = item['summary'] ?? 'Meeting';
        final start = item['start'] ?? '';
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                summary,
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12.5),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Text(
                start,
                style: const TextStyle(fontSize: 11, color: Colors.grey),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const Divider(height: 12),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildTaskWidgetList(List tasks) {
    if (tasks.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 20),
        child: Center(child: Text('No pending tasks', style: TextStyle(fontSize: 12, color: Colors.grey))),
      );
    }
    return Column(
      children: tasks.map((item) {
        final title = item['title'] ?? 'Task';
        final due = item['due']?.toString() ?? '';
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 2.0),
                    child: Icon(Icons.circle_outlined, size: 12, color: Colors.grey),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 12.5),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (due.isNotEmpty) ...[
                          const SizedBox(height: 3),
                          Text(
                            'Due: $due',
                            style: const TextStyle(fontSize: 10.5, color: Colors.grey),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              const Divider(height: 12),
            ],
          ),
        );
      }).toList(),
    );
  }

  void _showTimezoneSearchDialog(BuildContext context, String currentTz, Function(String) onSelected) {
    final Map<String, String> tzOptions = {
      'GMT/UTC (Greenwich Mean Time)': 'UTC',
      'India Standard Time (IST - Asia/Kolkata)': 'Asia/Kolkata',
      'US Eastern Time (EST/EDT - America/New_York)': 'America/New_York',
      'US Central Time (CST/CDT - America/Chicago)': 'America/Chicago',
      'US Mountain Time (MST/MDT - America/Denver)': 'America/Denver',
      'US Pacific Time (PST/PDT - America/Los_Angeles)': 'America/Los_Angeles',
      'UK Time (GMT/BST - Europe/London)': 'Europe/London',
      'Central European Time (CET/CEST - Europe/Paris)': 'Europe/Paris',
      'Japan Standard Time (JST - Asia/Tokyo)': 'Asia/Tokyo',
      'China Standard Time (CST - Asia/Shanghai)': 'Asia/Shanghai',
      'Singapore Time (SGT - Asia/Singapore)': 'Asia/Singapore',
      'Australia Eastern Time (AEST/AEDT - Australia/Sydney)': 'Australia/Sydney',
      'Gulf Standard Time (GST - Asia/Dubai)': 'Asia/Dubai',
      'Saudi Arabia (Asia/Riyadh)': 'Asia/Riyadh',
      'South Africa (Africa/Johannesburg)': 'Africa/Johannesburg',
      'Brazil Time (America/Sao_Paulo)': 'America/Sao_Paulo',
      'Hong Kong (Asia/Hong_Kong)': 'Asia/Hong_Kong',
      'New Zealand (Pacific/Auckland)': 'Pacific/Auckland',
      'Korea Standard Time (Asia/Seoul)': 'Asia/Seoul',
      'Russia/Moscow (Europe/Moscow)': 'Europe/Moscow',
    };

    if (currentTz.isNotEmpty && !tzOptions.containsValue(currentTz)) {
      tzOptions['Custom/Detected ($currentTz)'] = currentTz;
    }

    String searchQuery = '';
    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            final filtered = tzOptions.entries.where((e) {
              final term = searchQuery.toLowerCase();
              return e.key.toLowerCase().contains(term) || e.value.toLowerCase().contains(term);
            }).toList();

            return AlertDialog(
              title: const Text('Search Timezone / Location', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              content: SizedBox(
                width: 400,
                height: 350,
                child: Column(
                  children: [
                    TextField(
                      decoration: const InputDecoration(
                        hintText: 'Search timezone or country...',
                        prefixIcon: Icon(Icons.search),
                        border: OutlineInputBorder(),
                      ),
                      onChanged: (val) {
                        setDialogState(() {
                          searchQuery = val;
                        });
                      },
                    ),
                    const SizedBox(height: 12),
                    Expanded(
                      child: ListView.builder(
                        itemCount: filtered.length,
                        itemBuilder: (context, index) {
                          final entry = filtered[index];
                          final isSelected = entry.value == currentTz;
                          return ListTile(
                            title: Text(entry.key, style: const TextStyle(fontSize: 13)),
                            subtitle: Text(entry.value, style: const TextStyle(fontSize: 11, color: Colors.grey)),
                            trailing: isSelected ? const Icon(Icons.check, color: Colors.green, size: 18) : null,
                            onTap: () {
                              onSelected(entry.value);
                              Navigator.pop(context);
                            },
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Close'),
                )
              ],
            );
          },
        );
      },
    );
  }

  void _showSettingsDialog() {
    if (_configData == null) {
      _requestConfig();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Loading settings from server...')),
      );
      return;
    }

    final providers = ['openrouter', 'openai', 'gemini', 'anthropic'];
    String activeProvider = _configData!['active_provider'] ?? 'openrouter';
    String activeModel = _configData!['active_model'] ?? '';
    bool widgetsEnabled = _widgetsEnabled;
    String theme = _themeMode;
    String timezone = _configData!['timezone'] ?? '';

    final keyControllers = <String, TextEditingController>{};
    for (final prov in providers) {
      final key = _configData!['providers']?[prov]?['api_key'] ?? '';
      keyControllers[prov] = TextEditingController(text: key);
    }

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return AlertDialog(
              title: const Text('CloudAgent Settings', style: TextStyle(fontWeight: FontWeight.bold)),
              content: SizedBox(
                width: 480,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Active LLM Provider', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                      const SizedBox(height: 8),
                      DropdownButtonFormField<String>(
                        value: activeProvider,
                        decoration: const InputDecoration(border: OutlineInputBorder()),
                        items: providers.map((p) => DropdownMenuItem(value: p, child: Text(p.toUpperCase()))).toList(),
                        onChanged: (val) {
                          if (val != null) {
                            setModalState(() {
                              activeProvider = val;
                            });
                          }
                        },
                      ),
                      const SizedBox(height: 16),

                      const Text('Active Model Name', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                      const SizedBox(height: 8),
                      TextFormField(
                        initialValue: activeModel,
                        decoration: const InputDecoration(
                          border: OutlineInputBorder(),
                          hintText: 'e.g. google/gemini-2.5-flash',
                        ),
                        onChanged: (val) {
                          activeModel = val.trim();
                        },
                      ),
                      const SizedBox(height: 16),

                      const Text('Timezone / Location', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                      const SizedBox(height: 8),
                      InkWell(
                        onTap: () {
                          _showTimezoneSearchDialog(context, timezone, (selectedTz) {
                            setModalState(() {
                              timezone = selectedTz;
                            });
                          });
                        },
                        child: InputDecorator(
                          decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            suffixIcon: Icon(Icons.arrow_drop_down),
                          ),
                          child: Text(
                            timezone.isEmpty ? 'Select Timezone' : timezone,
                            style: TextStyle(
                              fontSize: 14,
                              color: timezone.isEmpty ? Colors.grey : null,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),

                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Enable Workspace Dashboard Widgets', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                          Switch(
                            value: widgetsEnabled,
                            onChanged: (val) {
                              setModalState(() {
                                widgetsEnabled = val;
                              });
                            },
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),

                      const Text('App Theme Mode', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                      const SizedBox(height: 8),
                      DropdownButtonFormField<String>(
                        value: theme,
                        decoration: const InputDecoration(border: OutlineInputBorder()),
                        items: const [
                          DropdownMenuItem(value: 'system', child: Text('System Default')),
                          DropdownMenuItem(value: 'light', child: Text('Light Mode')),
                          DropdownMenuItem(value: 'dark', child: Text('Dark Mode')),
                        ],
                        onChanged: (val) {
                          if (val != null) {
                            setModalState(() {
                              theme = val;
                            });
                          }
                        },
                      ),
                      const SizedBox(height: 20),

                      const Divider(),
                      const SizedBox(height: 12),
                      const Text('API Keys Configuration', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                      const SizedBox(height: 12),

                      ...providers.map((prov) {
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 8.0),
                          child: TextFormField(
                            controller: keyControllers[prov],
                            obscureText: true,
                            decoration: InputDecoration(
                              labelText: '${prov.toUpperCase()} API Key',
                              border: const OutlineInputBorder(),
                            ),
                          ),
                        );
                      }),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancel'),
                ),
                ElevatedButton(
                  onPressed: () {
                    final keysPayload = <String, dynamic>{};
                    for (final prov in providers) {
                      keysPayload[prov] = {
                        'api_key': keyControllers[prov]!.text.trim()
                      };
                    }

                    _saveConfig({
                      'activeProvider': activeProvider,
                      'activeModel': activeModel,
                      'widgetsEnabled': widgetsEnabled,
                      'theme': theme,
                      'timezone': timezone,
                      'providers': keysPayload,
                    });

                    setState(() {
                      _widgetsEnabled = widgetsEnabled;
                      _themeMode = theme;
                      _currentModel = activeModel;
                      _updateAppThemeMode(theme);
                      
                      if (_widgetsEnabled) {
                        _requestDashboard();
                      } else {
                        _dashboardData = null;
                      }
                    });

                    Navigator.pop(context);
                  },
                  child: const Text('Save Settings'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'Idle':
        return Colors.green;
      case 'Thinking':
      case 'Running Tool':
      case 'Connecting':
        return Colors.orange;
      case 'Error':
      case 'Disconnected':
      default:
        return Colors.red;
    }
  }
}
