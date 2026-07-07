import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

void main() {
  runApp(const CloudAgentApp());
}

class CloudAgentApp extends StatelessWidget {
  const CloudAgentApp({super.key});

  @override
  Widget build(BuildContext context) {
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
      themeMode: ThemeMode.light, // Workspace aesthetics defaults to clean light theme
      home: const MainLayout(),
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
    // The source code of cloudagent is the parent of the Flutter project directory
    _cliSourcePath = Directory.current.parent.path;
    
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

      setState(() {
        if (type == 'session') {
          _sessionId = data['sessionId'] ?? '';
          debugPrint('Session ID: $_sessionId');
          _gwsEmail = data['gwsUserEmail'] ?? '';
          _status = 'Idle';
          final sessionsData = data['sessions'];
          if (sessionsData is List) {
            _sessions = List<Map<String, dynamic>>.from(sessionsData);
          }
        } else if (type == 'history') {
          _sessionId = data['sessionId'] ?? '';
          _messages.clear();
          final historyMsgs = data['messages'];
          if (historyMsgs is List) {
            for (final m in historyMsgs) {
              _messages.add({
                'sender': m['sender'] ?? 'agent',
                'text': m['text'] ?? ''
              });
            }
          }
          _status = 'Idle';
          _scrollToBottom();
        } else if (type == 'status') {
          final statusVal = data['status'];
          if (statusVal == 'thinking') {
            _status = 'Thinking';
            _currentModel = data['model'] ?? _currentModel;
          } else if (statusVal == 'running_tool') {
            _status = 'Running Tool';
            _activeTool = data['tool'] ?? '';
            _toolThought = data['thought'] ?? '';
          } else {
            _status = 'Idle';
          }
        } else if (type == 'message') {
          _status = 'Idle';
          _messages.add({
            'sender': data['sender'] ?? 'agent',
            'text': data['text'] ?? ''
          });
          _scrollToBottom();
        } else if (type == 'confirm') {
          _pendingConfirmation = {
            'tool': data['tool'] ?? '',
            'arguments': data['arguments'] ?? {},
            'risk': data['risk'] ?? 'safe'
          };
          _status = 'Idle';
          _scrollToBottom();
        } else if (type == 'error') {
          _status = 'Error';
          _messages.add({
            'sender': 'system',
            'text': data['error'] ?? 'An unknown error occurred.'
          });
          _scrollToBottom();
        }
      });
    } catch (e) {
      // Fallback: if output is not JSON, render it as a log message
      setState(() {
        _messages.add({
          'sender': 'system',
          'text': line
        });
        _scrollToBottom();
      });
    }
  }

  void _handleCliError(dynamic err) {
    setState(() {
      _status = 'Error';
      _messages.add({
        'sender': 'system',
        'text': 'Stream error occurred: $err'
      });
      _scrollToBottom();
    });
  }

  void _handleCliDone() {
    setState(() {
      _status = 'Disconnected';
      _messages.add({
        'sender': 'system',
        'text': 'CloudAgent backend process terminated.'
      });
      _scrollToBottom();
    });
  }

  void _sendMessage() {
    final text = _messageController.text.trim();
    if (text.isEmpty || _webSocketChannel == null) return;

    setState(() {
      _messages.add({
        'sender': 'user',
        'text': text
      });
      _messageController.clear();
      _suggestedCommands = [];
      _scrollToBottom();
    });

    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'message',
      'text': text
    }));
  }

  void _onInputChanged(String val) {
    setState(() {
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
      if (cmd == '/help') {
        _messageController.text = 'help';
        _suggestedCommands = [];
        _sendMessage();
      } else if (cmd == '/clear') {
        _messageController.clear();
        _suggestedCommands = [];
        _messages.clear();
        _messages.add({'sender': 'system', 'text': 'Chat history cleared locally.'});
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

  void _switchSession(String targetSessionId) {
    if (_webSocketChannel == null) return;
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
                        'v1.0.0',
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
                        color: isDark ? Colors.grey[950]! : Colors.grey[200]!,
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

                // Messages List
                Expanded(
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
                              child: Container(
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
                            );
                          },
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
                        color: isDark ? Colors.grey[950]! : Colors.grey[200]!,
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
                            enabled: _status != 'Connecting' && _status != 'Running Tool' && _pendingConfirmation == null,
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
                      FloatingActionButton(
                        onPressed: _sendMessage,
                        elevation: 2,
                        backgroundColor: Theme.of(context).colorScheme.primary,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                        child: const Icon(Icons.send_rounded, size: 20),
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
