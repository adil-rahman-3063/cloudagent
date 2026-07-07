import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';

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
    if (kIsWeb) return;
    _cliProcess?.kill();
    _cliProcess = null;
  }

  Future<void> _startProcess() async {
    if (kIsWeb) return;
    final workspace = _workspacePath;
    if (workspace == null) return;

    try {
      setState(() {
        _status = 'Connecting';
      });

      // Spawn Node.js CLI process in background
      // Note: Assume Node.js is globally available. On Windows, node works, but sometimes we need absolute paths.
      // We will look for src/cli.js relative to the selected workspace.
      final cliJs = '$_cliSourcePath/src/cli.js';
      
      _cliProcess = await Process.start(
        'node',
        [cliJs, '--json-stream'],
        workingDirectory: workspace,
      );

      _cliProcess!.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(_handleCliOutput, onError: _handleCliError, onDone: _handleCliDone);

      _cliProcess!.stderr
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) {
            debugPrint('CLI Stderr: $line');
          });

    } catch (e) {
      setState(() {
        _status = 'Error';
        _messages.add({
          'sender': 'system',
          'text': 'Failed to launch CloudAgent backend process. Make sure Node.js is installed in your system PATH and you selected the correct cloudagent workspace.\nError: $e'
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
    if (text.isEmpty || _cliProcess == null) return;

    setState(() {
      _messages.add({
        'sender': 'user',
        'text': text
      });
      _messageController.clear();
      _scrollToBottom();
    });

    _cliProcess!.stdin.writeln(jsonEncode({
      'type': 'message',
      'text': text
    }));
  }

  void _sendConfirmation(bool approved) {
    if (_cliProcess == null || _pendingConfirmation == null) return;

    _cliProcess!.stdin.writeln(jsonEncode({
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
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Scaffold(
      body: Row(
        children: [
          // Sidebar Panel
          Container(
            width: 280,
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF1E1E1E) : Colors.white,
              border: Border(
                right: BorderSide(
                  color: isDark ? Colors.grey[800]! : Colors.grey[300]!,
                  width: 1,
                ),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header Logo
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 40, 24, 20),
                  child: Row(
                    children: [
                      Icon(
                        Icons.cloud_sync_rounded,
                        color: Theme.of(context).colorScheme.primary,
                        size: 32,
                      ),
                      const SizedBox(width: 12),
                      const Text(
                        'CloudAgent',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                          letterSpacing: -0.5,
                        ),
                      ),
                    ],
                  ),
                ),
                const Divider(),
                
                // Workspace info
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    children: [
                      // Active directory
                      _buildSidebarSection(
                        title: 'WORKSPACE DIRECTORY',
                        content: Text(
                          _workspacePath ?? 'Not Selected',
                          style: const TextStyle(fontSize: 13, fontFamily: 'monospace'),
                        ),
                        trailing: IconButton(
                          icon: const Icon(Icons.folder_open_rounded, size: 20),
                          onPressed: _selectWorkspace,
                          tooltip: 'Choose Workspace Directory',
                        ),
                      ),
                      
                      const SizedBox(height: 16),
                      
                      // GWS Account
                      _buildSidebarSection(
                        title: 'GOOGLE WORKSPACE',
                        content: Row(
                          children: [
                            Icon(
                              Icons.account_circle_outlined,
                              size: 16,
                              color: _gwsEmail.isNotEmpty ? Colors.green : Colors.red,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _gwsEmail.isNotEmpty ? _gwsEmail : 'Not Logged In',
                                style: TextStyle(
                                  fontSize: 13,
                                  color: _gwsEmail.isNotEmpty ? null : Colors.red,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 16),

                      // Model
                      if (_currentModel.isNotEmpty)
                        _buildSidebarSection(
                          title: 'ACTIVE MODEL',
                          content: Text(
                            _currentModel,
                            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
                          ),
                        ),

                      const SizedBox(height: 16),

                      // Connection Status
                      _buildSidebarSection(
                        title: 'SERVICE STATUS',
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
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                
                // Sidebar Footer
                Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Row(
                    children: [
                      const Text(
                        'v1.0.0',
                        style: TextStyle(fontSize: 11, color: Colors.grey),
                      ),
                      const Spacer(),
                      if (_status == 'Disconnected')
                        TextButton.icon(
                          onPressed: _startProcess,
                          icon: const Icon(Icons.refresh, size: 16),
                          label: const Text('Reconnect', style: TextStyle(fontSize: 12)),
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
                // Active tool indicator header if executing a tool
                if (_status == 'Running Tool' && _activeTool.isNotEmpty)
                  Container(
                    width: double.infinity,
                    color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.08),
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                    child: Row(
                      children: [
                        const SizedBox(
                          width: 16,
                          height: 16,
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
                                size: 48,
                                color: Colors.grey[400],
                              ),
                              const SizedBox(height: 16),
                              Text(
                                'Start a conversation with CloudAgent',
                                style: TextStyle(color: Colors.grey[600], fontSize: 15),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'Ask to check emails, create sheets, list calendar events, or search files.',
                                style: TextStyle(color: Colors.grey[400], fontSize: 12),
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
                                padding: const EdgeInsets.symmetric(vertical: 8.0),
                                child: Center(
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                                    decoration: BoxDecoration(
                                      color: isDark ? Colors.grey[850] : Colors.grey[200],
                                      borderRadius: BorderRadius.circular(16),
                                    ),
                                    child: Text(
                                      msg['text'] ?? '',
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: isDark ? Colors.grey[400] : Colors.grey[600],
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
                                  maxWidth: MediaQuery.of(context).size.width * 0.6,
                                ),
                                margin: const EdgeInsets.symmetric(vertical: 6),
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                                decoration: BoxDecoration(
                                  color: isUser
                                      ? Theme.of(context).colorScheme.primary
                                      : (isDark ? const Color(0xFF2C2C2C) : Colors.white),
                                  borderRadius: BorderRadius.only(
                                    topLeft: const Radius.circular(16),
                                    topRight: const Radius.circular(16),
                                    bottomLeft: Radius.circular(isUser ? 16 : 4),
                                    bottomRight: Radius.circular(isUser ? 4 : 16),
                                  ),
                                  boxShadow: isUser
                                      ? null
                                      : [
                                          BoxShadow(
                                            color: Colors.black.withValues(alpha: 0.03),
                                            blurRadius: 4,
                                            offset: const Offset(0, 2),
                                          )
                                        ],
                                ),
                                child: SelectableText(
                                  msg['text'] ?? '',
                                  style: TextStyle(
                                    color: isUser ? Colors.white : (isDark ? Colors.white : Colors.black87),
                                    fontSize: 14,
                                    height: 1.4,
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                ),
                
                // Thinking loading indicator
                if (_status == 'Thinking')
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
                    child: Row(
                      children: [
                        const SizedBox(
                          width: 12,
                          height: 12,
                          child: CircularProgressIndicator(
                            strokeWidth: 1.5,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Text(
                          'Agent is thinking...',
                          style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                        ),
                      ],
                    ),
                  ),

                // Inline Confirmation Panel
                if (_pendingConfirmation != null)
                  _buildConfirmationCard(context),

                // Message Input Panel
                Container(
                  color: isDark ? const Color(0xFF1E1E1E) : Colors.white,
                  padding: const EdgeInsets.all(16.0),
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _messageController,
                          onSubmitted: (_) => _sendMessage(),
                          enabled: _status != 'Connecting' && _status != 'Running Tool' && _pendingConfirmation == null,
                          decoration: InputDecoration(
                            hintText: _pendingConfirmation != null 
                                ? 'Please confirm or deny the requested action above...'
                                : 'Type your workspace command (e.g. "Draft an email to Bob")',
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(24),
                              borderSide: BorderSide(
                                color: isDark ? Colors.grey[800]! : Colors.grey[300]!,
                              ),
                            ),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      FloatingActionButton(
                        onPressed: _sendMessage,
                        mini: true,
                        elevation: 1,
                        child: const Icon(Icons.send_rounded),
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

  Widget _buildSidebarSection({
    required String title,
    required Widget content,
    Widget? trailing,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              title,
              style: const TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.bold,
                letterSpacing: 1.2,
                color: Colors.grey,
              ),
            ),
            ?trailing,
          ],
        ),
        const SizedBox(height: 6),
        content,
      ],
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
