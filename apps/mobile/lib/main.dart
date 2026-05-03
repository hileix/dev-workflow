import "dart:convert";

import "package:dio/dio.dart";
import "package:flutter/material.dart";
import "package:web_socket_channel/web_socket_channel.dart";

void main() {
  runApp(const DevWorkflowApp());
}

class DevWorkflowApp extends StatelessWidget {
  const DevWorkflowApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: "Dev Workflow",
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0F766E),
          brightness: Brightness.light,
        ),
      ),
      home: const WorkflowHomePage(),
    );
  }
}

class WorkflowHomePage extends StatefulWidget {
  const WorkflowHomePage({super.key});

  @override
  State<WorkflowHomePage> createState() => _WorkflowHomePageState();
}

class _WorkflowHomePageState extends State<WorkflowHomePage> {
  final Dio _dio = Dio();
  final TextEditingController _baseUrlController = TextEditingController(text: "http://127.0.0.1:8787");
  final TextEditingController _messageController = TextEditingController();

  WebSocketChannel? _channel;
  List<dynamic> _devices = const [];
  List<dynamic> _tasks = const [];
  Map<String, dynamic>? _selectedTask;
  bool _connecting = false;
  String _status = "Disconnected";

  @override
  void dispose() {
    _channel?.sink.close();
    _baseUrlController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  Uri get _wsUri {
    final base = Uri.parse(_baseUrlController.text.trim());
    final scheme = base.scheme == "https" ? "wss" : "ws";
    return base.replace(scheme: scheme, path: "/ws/mobile");
  }

  Future<void> _connect() async {
    setState(() {
      _connecting = true;
      _status = "Connecting...";
    });

    try {
      final response = await _dio.get("${_baseUrlController.text.trim()}/api/tasks");
      final tasks = (response.data["tasks"] as List?) ?? const [];
      _channel?.sink.close();
      final channel = WebSocketChannel.connect(_wsUri);
      channel.stream.listen(_handleSocketMessage, onDone: () {
        if (!mounted) return;
        setState(() {
          _status = "Disconnected";
        });
      }, onError: (_) {
        if (!mounted) return;
        setState(() {
          _status = "Connection error";
        });
      });

      if (!mounted) return;
      setState(() {
        _channel = channel;
        _tasks = tasks.cast<dynamic>();
        _connecting = false;
        _status = "Connected";
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _connecting = false;
        _status = "Connect failed";
      });
      _showSnack("Failed to connect: $error");
    }
  }

  void _handleSocketMessage(dynamic raw) {
    final payload = jsonDecode(raw as String) as Map<String, dynamic>;

    if (!mounted) return;
    setState(() {
      if (payload["type"] == "bootstrap") {
        _devices = (payload["devices"] as List?) ?? const [];
        _tasks = (payload["tasks"] as List?) ?? const [];
      } else if (payload["type"] == "device.status") {
        final device = payload["device"] as Map<String, dynamic>;
        _devices = _upsertByKey(_devices, device, "deviceId");
      } else if (payload["type"] == "task.snapshot") {
        final task = payload["task"] as Map<String, dynamic>;
        _tasks = _upsertByKey(_tasks, task, "key");
        _selectedTask = _refreshSelected(_selectedTask, task);
      } else if (payload["type"] == "task.event") {
        final task = payload["task"] as Map<String, dynamic>;
        _tasks = _upsertByKey(_tasks, task, "key");
        _selectedTask = _refreshSelected(_selectedTask, task);
      } else if (payload["type"] == "command.status") {
        final command = payload["command"] as Map<String, dynamic>;
        if (command["status"] == "error") {
          _showSnack(command["error"]?.toString() ?? "Command failed");
        }
      } else if (payload["type"] == "command.error") {
        _showSnack(payload["error"]?.toString() ?? "Command failed");
      }
    });
  }

  List<dynamic> _upsertByKey(List<dynamic> source, Map<String, dynamic> item, String key) {
    final target = List<dynamic>.from(source);
    final index = target.indexWhere((entry) => entry[key] == item[key]);
    if (index >= 0) {
      target[index] = item;
    } else {
      target.insert(0, item);
    }
    return target;
  }

  Map<String, dynamic>? _refreshSelected(Map<String, dynamic>? selected, Map<String, dynamic> next) {
    if (selected == null) return null;
    return selected["key"] == next["key"] ? next : selected;
  }

  Future<void> _sendCommand(String command, {Map<String, dynamic>? payload}) async {
    final task = _selectedTask;
    if (task == null) return;

    try {
      await _dio.post(
        "${_baseUrlController.text.trim()}/api/tasks/${task["deviceId"]}/${task["ticketId"]}/commands",
        data: {
          "type": command,
          "payload": payload ?? const {},
        },
      );
    } catch (error) {
      _showSnack("Command failed: $error");
    }
  }

  void _showSnack(String message) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger?.showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final selectedTask = _selectedTask;
    final taskState = selectedTask?["state"] as Map<String, dynamic>?;
    final currentPhase = taskState?["currentPhase"]?.toString() ?? "-";
    final overallStatus = taskState?["overallStatus"]?.toString() ?? "-";
    final messages = (selectedTask?["messages"] as Map?)?.cast<String, dynamic>() ?? const {};

    return Scaffold(
      appBar: AppBar(
        title: const Text("Dev Workflow"),
        actions: [
          Center(
            child: Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Text(_status, style: Theme.of(context).textTheme.labelMedium),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _baseUrlController,
                    decoration: const InputDecoration(
                      labelText: "Backend URL",
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                FilledButton(
                  onPressed: _connecting ? null : _connect,
                  child: const Text("Connect"),
                ),
              ],
            ),
          ),
          if (_devices.isNotEmpty)
            SizedBox(
              height: 52,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                scrollDirection: Axis.horizontal,
                itemCount: _devices.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final device = _devices[index] as Map<String, dynamic>;
                  final online = device["status"] == "online";
                  return Chip(
                    label: Text("${device["name"]} ${online ? "online" : "offline"}"),
                    backgroundColor: online ? const Color(0xFFD1FAE5) : const Color(0xFFE5E7EB),
                  );
                },
              ),
            ),
          Expanded(
            child: Row(
              children: [
                Flexible(
                  flex: 4,
                  child: Container(
                    decoration: const BoxDecoration(
                      border: Border(right: BorderSide(color: Color(0xFFE5E7EB))),
                    ),
                    child: ListView.builder(
                      itemCount: _tasks.length,
                      itemBuilder: (context, index) {
                        final task = _tasks[index] as Map<String, dynamic>;
                        final state = task["state"] as Map<String, dynamic>?;
                        final isSelected = _selectedTask?["key"] == task["key"];
                        return ListTile(
                          selected: isSelected,
                          title: Text(task["ticketId"]?.toString() ?? "-"),
                          subtitle: Text(state?["overallStatus"]?.toString() ?? "unknown"),
                          trailing: Text(state?["currentPhase"]?.toString() ?? "-"),
                          onTap: () {
                            setState(() {
                              _selectedTask = task;
                            });
                          },
                        );
                      },
                    ),
                  ),
                ),
                Flexible(
                  flex: 6,
                  child: selectedTask == null
                      ? const Center(child: Text("Select a task"))
                      : Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                selectedTask["ticketId"]?.toString() ?? "-",
                                style: Theme.of(context).textTheme.headlineSmall,
                              ),
                              const SizedBox(height: 8),
                              Text("Status: $overallStatus"),
                              Text("Phase: $currentPhase"),
                              Text("Device: ${selectedTask["deviceId"]}"),
                              const SizedBox(height: 16),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  FilledButton(
                                    onPressed: () => _sendCommand("approve"),
                                    child: const Text("Approve"),
                                  ),
                                  OutlinedButton(
                                    onPressed: () => _sendCommand("sync_task"),
                                    child: const Text("Refresh"),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              TextField(
                                controller: _messageController,
                                minLines: 3,
                                maxLines: 5,
                                decoration: const InputDecoration(
                                  labelText: "Message",
                                  border: OutlineInputBorder(),
                                ),
                              ),
                              const SizedBox(height: 8),
                              FilledButton.tonal(
                                onPressed: () {
                                  final text = _messageController.text.trim();
                                  if (text.isEmpty) return;
                                  _sendCommand("message", payload: {"text": text});
                                  _messageController.clear();
                                },
                                child: const Text("Send"),
                              ),
                              const SizedBox(height: 16),
                              Expanded(
                                child: ListView(
                                  children: messages.entries.map((entry) {
                                    return Card(
                                      margin: const EdgeInsets.only(bottom: 12),
                                      child: Padding(
                                        padding: const EdgeInsets.all(12),
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              entry.key,
                                              style: Theme.of(context).textTheme.titleSmall,
                                            ),
                                            const SizedBox(height: 8),
                                            Text(entry.value?.toString() ?? ""),
                                          ],
                                        ),
                                      ),
                                    );
                                  }).toList(),
                                ),
                              ),
                            ],
                          ),
                        ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
