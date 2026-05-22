import "dart:async";
import "dart:convert";
import "dart:typed_data";

import "package:dio/dio.dart";
import "package:flutter/cupertino.dart";
import "package:flutter_localizations/flutter_localizations.dart";
import "package:image_picker/image_picker.dart";
import "package:shared_preferences/shared_preferences.dart";
import "package:web_socket_channel/web_socket_channel.dart";

void main() {
  runApp(const DevWorkflowApp());
}

class DevWorkflowApp extends StatefulWidget {
  const DevWorkflowApp({super.key});

  @override
  State<DevWorkflowApp> createState() => _DevWorkflowAppState();
}

class _DevWorkflowAppState extends State<DevWorkflowApp> {
  static const _languageCodeKey = "languageCode";

  Locale _locale = const Locale("en");

  @override
  void initState() {
    super.initState();
    _loadLocale();
  }

  Future<void> _loadLocale() async {
    final prefs = await SharedPreferences.getInstance();
    final languageCode = prefs.getString(_languageCodeKey);
    if (!mounted || languageCode == null || languageCode.isEmpty) return;
    setState(() {
      _locale = Locale(languageCode);
    });
  }

  Future<void> _setLocale(Locale locale) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_languageCodeKey, locale.languageCode);
    if (!mounted) return;
    setState(() {
      _locale = locale;
    });
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppStrings(_locale);

    return CupertinoApp(
      title: strings.appTitle,
      locale: _locale,
      supportedLocales: AppStrings.supportedLocales,
      localizationsDelegates: const [
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
      ],
      theme: const CupertinoThemeData(
        brightness: Brightness.light,
        primaryColor: Color(0xFF0F766E),
        scaffoldBackgroundColor: Color(0xFFF3F4F6),
        barBackgroundColor: Color(0xF2F3F4F6),
      ),
      home: AppTabScaffold(
        strings: strings,
        locale: _locale,
        onLocaleChanged: _setLocale,
      ),
    );
  }
}

class AppTabScaffold extends StatelessWidget {
  const AppTabScaffold({
    super.key,
    required this.strings,
    required this.locale,
    required this.onLocaleChanged,
  });

  final AppStrings strings;
  final Locale locale;
  final Future<void> Function(Locale locale) onLocaleChanged;

  @override
  Widget build(BuildContext context) {
    return CupertinoTabScaffold(
      tabBar: CupertinoTabBar(
        activeColor: const Color(0xFF0F766E),
        items: [
          BottomNavigationBarItem(
            icon: const Icon(CupertinoIcons.square_list),
            label: strings.tasks,
          ),
          BottomNavigationBarItem(
            icon: const Icon(CupertinoIcons.gear),
            label: strings.settings,
          ),
        ],
      ),
      tabBuilder: (context, index) {
        if (index == 1) {
          return _SettingsPage(
            strings: strings,
            locale: locale,
            onLocaleChanged: onLocaleChanged,
          );
        }
        return WorkflowHomePage(strings: strings, locale: locale);
      },
    );
  }
}

class WorkflowHomePage extends StatefulWidget {
  const WorkflowHomePage({
    super.key,
    required this.strings,
    required this.locale,
  });

  final AppStrings strings;
  final Locale locale;

  @override
  State<WorkflowHomePage> createState() => _WorkflowHomePageState();
}

class _SelectedImage {
  const _SelectedImage({
    required this.name,
    required this.bytes,
  });

  final String name;
  final Uint8List bytes;

  Map<String, dynamic> toPayload() {
    return {
      "name": name,
      "data": bytes.toList(),
    };
  }
}

Future<List<_SelectedImage>> _pickSelectedImages(ImagePicker picker) async {
  final files = await picker.pickMultiImage();
  if (files.isEmpty) return const [];
  return Future.wait(
    files.map((file) async => _SelectedImage(
          name: file.name,
          bytes: await file.readAsBytes(),
        )),
  );
}

class _WorkflowHomePageState extends State<WorkflowHomePage> {
  final Dio _dio = Dio();
  final ImagePicker _imagePicker = ImagePicker();
  final TextEditingController _baseUrlController =
      TextEditingController(text: "http://127.0.0.1:8900");
  final TextEditingController _messageController = TextEditingController();

  WebSocketChannel? _channel;
  OverlayEntry? _toastEntry;
  List<dynamic> _devices = const [];
  List<dynamic> _tasks = const [];
  List<_SelectedImage> _messageImages = const [];
  Map<String, dynamic>? _selectedTask;
  bool _connecting = false;
  bool _startingWorkflow = false;
  String _status = ConnectionStatus.disconnected;
  String _availabilityStatus = "no_desktop_online";

  AppStrings get strings => widget.strings;
  bool get _hasAvailableDevice =>
      _devices.whereType<Map<String, dynamic>>().any(_isDeviceAvailable);
  String get _availableConnectionStatus => _hasAvailableDevice
      ? ConnectionStatus.connected
      : ConnectionStatus.disconnected;
  String get _displayStatus =>
      _status == ConnectionStatus.connected && !_hasAvailableDevice
          ? ConnectionStatus.disconnected
          : _status;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _connect(silentUnavailable: true);
      }
    });
  }

  @override
  void dispose() {
    _toastEntry?.remove();
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

  bool _isDeviceAvailable(Map<String, dynamic> device) {
    if (device["status"]?.toString() != "online") return false;
    final meta = (device["meta"] as Map?)?.cast<String, dynamic>() ?? const {};
    return meta["mobileAccessEnabled"] == true;
  }

  String _availabilityMessage(String status) {
    switch (status) {
      case "desktop_mobile_access_disabled":
        return strings.mobileAccessDisabled;
      case "no_desktop_online":
        return strings.noDesktopOnline;
      default:
        return "";
    }
  }

  Future<void> _connect({bool silentUnavailable = false}) async {
    setState(() {
      _connecting = true;
      _status = ConnectionStatus.connecting;
    });

    try {
      final response =
          await _dio.get("${_baseUrlController.text.trim()}/api/tasks");
      List<dynamic> devices = const [];
      String availabilityStatus = "no_desktop_online";
      try {
        final deviceResponse =
            await _dio.get("${_baseUrlController.text.trim()}/api/devices");
        devices = (deviceResponse.data["devices"] as List?) ?? const [];
        availabilityStatus =
            deviceResponse.data["availability"]?["status"]?.toString() ??
                "no_desktop_online";
      } catch (error) {
        devices = const [];
      }
      final tasks = (response.data["tasks"] as List?) ?? const [];
      _channel?.sink.close();
      final channel = WebSocketChannel.connect(_wsUri);
      channel.stream.listen(_handleSocketMessage, onDone: () {
        if (!mounted) return;
        setState(() {
          _channel = null;
          _devices = const [];
          _tasks = const [];
          _selectedTask = null;
          _status = ConnectionStatus.disconnected;
        });
      }, onError: (_) {
        if (!mounted) return;
        setState(() {
          _channel = null;
          _devices = const [];
          _tasks = const [];
          _selectedTask = null;
          _status = ConnectionStatus.error;
        });
      });

      if (!mounted) return;
      setState(() {
        _channel = channel;
        _devices = devices.cast<dynamic>();
        _tasks = tasks.cast<dynamic>();
        _selectedTask = _pickSelectedTask(_selectedTask, tasks.cast<dynamic>());
        _availabilityStatus = availabilityStatus;
        _connecting = false;
        _status = _availableConnectionStatus;
      });
      if (!silentUnavailable && availabilityStatus != "available") {
        final message = _availabilityMessage(availabilityStatus);
        if (message.isNotEmpty) {
          _showToast(message);
        }
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _connecting = false;
        _status = ConnectionStatus.failed;
      });
      _showToast("${strings.failedToConnectPrefix}$error");
    }
  }

  Future<void> _disconnect() async {
    await _channel?.sink.close();
    if (!mounted) return;
    setState(() {
      _channel = null;
      _devices = const [];
      _tasks = const [];
      _selectedTask = null;
      _connecting = false;
      _status = ConnectionStatus.disconnected;
    });
  }

  void _handleSocketMessage(dynamic raw) {
    final payload = jsonDecode(raw as String) as Map<String, dynamic>;

    if (!mounted) return;
    setState(() {
      if (payload["type"] == "bootstrap") {
        _devices = (payload["devices"] as List?) ?? const [];
        _tasks = (payload["tasks"] as List?) ?? const [];
        _selectedTask = _pickSelectedTask(_selectedTask, _tasks);
        _availabilityStatus = payload["availability"]?["status"]?.toString() ??
            _availabilityStatus;
      } else if (payload["type"] == "availability") {
        _availabilityStatus = payload["availability"]?["status"]?.toString() ??
            _availabilityStatus;
      } else if (payload["type"] == "device.status") {
        final device = payload["device"] as Map<String, dynamic>;
        _devices = _upsertByKey(_devices, device, "deviceId");
      } else if (payload["type"] == "task.snapshot") {
        final task = payload["task"] as Map<String, dynamic>;
        _tasks = _upsertByKey(_tasks, task, "key");
        _selectedTask = _refreshSelected(_selectedTask, task);
      } else if (payload["type"] == "task.event") {
        final task = payload["task"] as Map<String, dynamic>?;
        if (task == null) return;
        _tasks = _upsertByKey(_tasks, task, "key");
        _selectedTask = _refreshSelected(_selectedTask, task);
      } else if (payload["type"] == "tasks.remove_device") {
        final deviceId = payload["deviceId"]?.toString() ?? "";
        _tasks = _tasks
            .whereType<Map<String, dynamic>>()
            .where((task) => task["deviceId"]?.toString() != deviceId)
            .toList();
        _selectedTask = _pickSelectedTask(_selectedTask, _tasks);
      } else if (payload["type"] == "tasks.remove_task") {
        final taskKey = payload["taskKey"]?.toString() ?? "";
        final removingSelected = _selectedTask?["key"]?.toString() == taskKey;
        _tasks = _tasks
            .whereType<Map<String, dynamic>>()
            .where((task) => task["key"]?.toString() != taskKey)
            .toList();
        _selectedTask = _pickSelectedTask(_selectedTask, _tasks);
        if (removingSelected) {
          _messageController.clear();
          _messageImages = const [];
        }
      } else if (payload["type"] == "command.status") {
        final command = payload["command"] as Map<String, dynamic>;
        if (command["status"] == "error") {
          _showToast(command["error"]?.toString() ?? strings.commandFailed);
        }
      } else if (payload["type"] == "command.error") {
        _showToast(payload["error"]?.toString() ?? strings.commandFailed);
      }
      _status = _channel != null
          ? _availableConnectionStatus
          : ConnectionStatus.disconnected;
    });
  }

  List<dynamic> _upsertByKey(
      List<dynamic> source, Map<String, dynamic> item, String key) {
    final target = List<dynamic>.from(source);
    final index = target.indexWhere((entry) => entry[key] == item[key]);
    if (index >= 0) {
      target[index] = item;
    } else {
      target.insert(0, item);
    }
    return target;
  }

  Map<String, dynamic>? _refreshSelected(
      Map<String, dynamic>? selected, Map<String, dynamic> next) {
    if (selected == null) return null;
    return selected["key"] == next["key"] ? next : selected;
  }

  Map<String, dynamic>? _pickSelectedTask(
      Map<String, dynamic>? selected, List<dynamic> tasks) {
    if (tasks.isEmpty) return null;
    if (selected == null) return tasks.first as Map<String, dynamic>;
    final matched = tasks.whereType<Map<String, dynamic>>().firstWhere(
          (task) => task["key"] == selected["key"],
          orElse: () => tasks.first as Map<String, dynamic>,
        );
    return matched;
  }

  Map<String, dynamic> _deviceMeta(String deviceId) {
    final device = _devices
        .whereType<Map<String, dynamic>>()
        .cast<Map<String, dynamic>?>()
        .firstWhere(
          (entry) => entry?["deviceId"]?.toString() == deviceId,
          orElse: () => null,
        );
    return (device?["meta"] as Map?)?.cast<String, dynamic>() ?? const {};
  }

  List<String> _rejectTargetsForTask(Map<String, dynamic>? task) {
    if (task == null) return const [];
    final deviceId = task["deviceId"]?.toString() ?? "";
    final currentPhase =
        (task["state"] as Map?)?["currentPhase"]?.toString() ?? "";
    if (deviceId.isEmpty || currentPhase.isEmpty) return const [];
    final workflowConfig = (_deviceMeta(deviceId)["workflowConfig"] as Map?)
            ?.cast<String, dynamic>() ??
        const {};
    final rejectTargets =
        (workflowConfig["rejectTargets"] as Map?)?.cast<String, dynamic>() ??
            const {};
    final targets = (rejectTargets[currentPhase] as List?) ?? const [];
    return targets.map((target) => target.toString()).toList();
  }

  Future<void> _sendCommand(String command,
      {Map<String, dynamic>? payload}) async {
    final task = _selectedTask;
    if (task == null) return;

    try {
      await _dio.post(
        "${_baseUrlController.text.trim()}/api/tasks/${task["deviceId"]}/${task["taskId"]}/commands",
        data: {
          "type": command,
          "payload": payload ?? const {},
        },
      );
    } catch (error) {
      _showToast("${strings.commandFailedPrefix}$error");
    }
  }

  Future<void> _addMessageImages() async {
    final images = await _pickSelectedImages(_imagePicker);
    if (!mounted || images.isEmpty) return;
    setState(() {
      _messageImages = [..._messageImages, ...images];
    });
  }

  void _removeMessageImage(int index) {
    setState(() {
      _messageImages = [
        for (var i = 0; i < _messageImages.length; i++)
          if (i != index) _messageImages[i],
      ];
    });
  }

  Future<void> _confirmDeleteTask() async {
    final task = _selectedTask;
    if (task == null) return;
    final confirmed = await showCupertinoDialog<bool>(
      context: context,
      builder: (context) {
        return CupertinoAlertDialog(
          title: Text(strings.deleteTask),
          content: Text(
            strings.deleteTaskConfirm(task["taskId"]?.toString() ?? "-"),
          ),
          actions: [
            CupertinoDialogAction(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(strings.cancel),
            ),
            CupertinoDialogAction(
              isDestructiveAction: true,
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(strings.delete),
            ),
          ],
        );
      },
    );
    if (confirmed != true) return;
    await _sendCommand("delete_task");
  }

  Future<void> _showRejectSheet() async {
    final task = _selectedTask;
    final targets = _rejectTargetsForTask(task);
    if (task == null || targets.isEmpty) {
      _showToast(strings.noRejectTargets);
      return;
    }

    final rejectTo = await showCupertinoModalPopup<String>(
      context: context,
      builder: (context) {
        return CupertinoActionSheet(
          title: Text(strings.rejectTo),
          actions: targets
              .map((target) => CupertinoActionSheetAction(
                    onPressed: () => Navigator.of(context).pop(target),
                    child: Text(target),
                  ))
              .toList(),
          cancelButton: CupertinoActionSheetAction(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(strings.cancel),
          ),
        );
      },
    );

    if (rejectTo == null || rejectTo.isEmpty) return;
    await _sendCommand("reject", payload: {"rejectTo": rejectTo});
  }

  Future<void> _startWorkflow({
    required String deviceId,
    required String taskId,
    required String runId,
    required String workFolder,
    required String workflowFilename,
    required Map<String, String> taskInputs,
    required List<Map<String, dynamic>> images,
  }) async {
    try {
      await _dio.post(
        "${_baseUrlController.text.trim()}/api/tasks/$deviceId/$taskId/commands",
        data: {
          "type": "start_workflow",
          "payload": {
            "runId": runId,
            "workFolder": workFolder,
            "workflowFilename": workflowFilename,
            "taskInputs": taskInputs,
            "images": images,
          },
        },
      );
      _showToast(strings.workflowStarted);
    } catch (error) {
      _showToast("${strings.startFailedPrefix}$error");
    }
  }

  Future<void> _showStartWorkflowSheet() async {
    final onlineDevices = _devices
        .whereType<Map<String, dynamic>>()
        .where((device) => device["status"] == "online")
        .toList();

    if (onlineDevices.isEmpty) {
      _showToast(strings.noOnlineDeviceAvailable);
      return;
    }

    final meta =
        (onlineDevices.first["meta"] as Map?)?.cast<String, dynamic>() ??
            const {};
    final mobileAccessEnabled = meta["mobileAccessEnabled"] == true;
    final workflows = ((meta["workflows"] as List?) ?? const [])
        .whereType<Map>()
        .map((entry) => Map<String, dynamic>.from(entry))
        .toList();
    final workFolders = ((meta["workFolders"] as List?) ?? const [])
        .whereType<Map>()
        .map((entry) => Map<String, dynamic>.from(entry))
        .toList();

    if (workflows.isEmpty || workFolders.isEmpty) {
      _showToast(mobileAccessEnabled
          ? strings.deviceMetadataIncomplete
          : strings.mobileAccessDisabled);
      return;
    }

    final result = await showCupertinoModalPopup<_StartWorkflowResult>(
      context: context,
      builder: (context) {
        return _StartWorkflowSheet(
          strings: strings,
          workflows: workflows,
          workFolders: workFolders,
        );
      },
    );

    if (result == null) return;

    setState(() {
      _startingWorkflow = true;
    });

    try {
      await _startWorkflow(
        deviceId: onlineDevices.first["deviceId"]?.toString() ?? "",
        taskId: result.taskId,
        runId: result.runId,
        workFolder: result.workFolder,
        workflowFilename: result.workflowFilename,
        taskInputs: result.taskInputs,
        images: result.images.map((image) => image.toPayload()).toList(),
      );
    } finally {
      if (mounted) {
        setState(() {
          _startingWorkflow = false;
        });
      }
    }
  }

  Future<void> _syncSelectedTask() async {
    await _sendCommand("sync_task");
  }

  Future<void> _showConnectionSheet() async {
    await showCupertinoModalPopup<void>(
      context: context,
      builder: (context) {
        return _ConnectionSheet(
          strings: strings,
          locale: widget.locale,
          baseUrlController: _baseUrlController,
          status: _displayStatus,
          availabilityMessage: _availabilityMessage(_availabilityStatus),
          connecting: _connecting,
          onDisconnect: _disconnect,
          onConnect: () => _connect(),
        );
      },
    );
  }

  void _showToast(String message) {
    final overlay = Overlay.maybeOf(context, rootOverlay: true);
    if (overlay == null) return;

    _toastEntry?.remove();
    final entry = OverlayEntry(
      builder: (context) {
        final bottom = MediaQuery.of(context).padding.bottom + 32;
        return Positioned(
          left: 24,
          right: 24,
          bottom: bottom,
          child: IgnorePointer(
            child: Center(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: const Color(0xE61F2937),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  child: Text(
                    message,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: CupertinoColors.white,
                      fontSize: 14,
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );

    overlay.insert(entry);
    _toastEntry = entry;
    Future<void>.delayed(const Duration(seconds: 2), () {
      if (_toastEntry == entry) {
        _toastEntry?.remove();
        _toastEntry = null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final selectedTask = _selectedTask;
    final taskState = selectedTask?["state"] as Map<String, dynamic>?;
    final currentPhase = taskState?["currentPhase"]?.toString() ?? "-";
    final overallStatus = taskState?["overallStatus"]?.toString() ?? "-";
    final rejectTargets = _rejectTargetsForTask(selectedTask);
    final messages =
        (selectedTask?["messages"] as Map?)?.cast<String, dynamic>() ??
            const {};

    return CupertinoPageScaffold(
      navigationBar: CupertinoNavigationBar(
        border: null,
        middle: Text(strings.appTitle),
        trailing: GestureDetector(
          onTap: _showConnectionSheet,
          child: _StatusBadge(status: _displayStatus, strings: strings),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Row(
                  children: [
                    Expanded(child: _SectionHeader(strings.tasks)),
                    CupertinoButton(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 8,
                      ),
                      color: const Color(0xFFDCEFEA),
                      borderRadius: BorderRadius.circular(999),
                      onPressed: (_connecting ||
                              _startingWorkflow ||
                              !_hasAvailableDevice)
                          ? null
                          : _showStartWorkflowSheet,
                      child: Text(
                        _startingWorkflow
                            ? strings.startingWorkflow
                            : strings.startWorkflow,
                        style: const TextStyle(
                          color: Color(0xFF0F766E),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (_tasks.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: Text(
                    strings.noTasksYet,
                    style: const TextStyle(
                      color: Color(0xFF6B7280),
                      fontSize: 16,
                    ),
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                sliver: SliverList(
                  delegate: SliverChildListDelegate([
                    ..._tasks.whereType<Map<String, dynamic>>().map((task) {
                      final selected = _selectedTask?["key"] == task["key"];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _TaskCard(
                          task: task,
                          selected: selected,
                          onTap: () {
                            setState(() {
                              _selectedTask = task;
                            });
                          },
                        ),
                      );
                    }),
                    if (selectedTask != null) ...[
                      const SizedBox(height: 8),
                      _SectionHeader(strings.details),
                      const SizedBox(height: 12),
                      _SectionCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              selectedTask["taskId"]?.toString() ?? "-",
                              style: const TextStyle(
                                fontSize: 28,
                                fontWeight: FontWeight.w700,
                                color: Color(0xFF111827),
                              ),
                            ),
                            const SizedBox(height: 14),
                            _DetailRow(
                                label: strings.status, value: overallStatus),
                            _DetailRow(
                                label: strings.phase, value: currentPhase),
                            _DetailRow(
                              label: strings.device,
                              value:
                                  selectedTask["deviceId"]?.toString() ?? "-",
                            ),
                            const SizedBox(height: 16),
                            Row(
                              children: [
                                Expanded(
                                  child: CupertinoButton.filled(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 12,
                                    ),
                                    borderRadius: BorderRadius.circular(12),
                                    onPressed: () => _sendCommand("approve"),
                                    child: Text(strings.approve),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: CupertinoButton(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 12,
                                    ),
                                    borderRadius: BorderRadius.circular(12),
                                    color: const Color(0xFFFDE8E8),
                                    onPressed: rejectTargets.isEmpty
                                        ? null
                                        : _showRejectSheet,
                                    child: Text(
                                      strings.reject,
                                      style: const TextStyle(
                                        color: Color(0xFFB91C1C),
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            SizedBox(
                              width: double.infinity,
                              child: CupertinoButton(
                                color: const Color(0xFFE5E7EB),
                                borderRadius: BorderRadius.circular(12),
                                onPressed: _syncSelectedTask,
                                child: Text(
                                  strings.refresh,
                                  style: const TextStyle(
                                    color: Color(0xFF111827),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 10),
                            SizedBox(
                              width: double.infinity,
                              child: CupertinoButton(
                                color: const Color(0xFFFDE8E8),
                                borderRadius: BorderRadius.circular(12),
                                onPressed: _confirmDeleteTask,
                                child: Text(
                                  strings.deleteTask,
                                  style: const TextStyle(
                                    color: Color(0xFFB91C1C),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 16),
                            _FieldLabel(strings.message),
                            const SizedBox(height: 10),
                            CupertinoTextField(
                              controller: _messageController,
                              minLines: 3,
                              maxLines: 5,
                              padding: const EdgeInsets.all(14),
                              placeholder: strings.messagePlaceholder,
                              decoration: _inputDecoration(),
                            ),
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                CupertinoButton(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 14,
                                    vertical: 10,
                                  ),
                                  color: const Color(0xFFE5E7EB),
                                  borderRadius: BorderRadius.circular(12),
                                  onPressed: _addMessageImages,
                                  child: Text(
                                    strings.attachImages,
                                    style: const TextStyle(
                                      color: Color(0xFF111827),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            if (_messageImages.isNotEmpty) ...[
                              const SizedBox(height: 10),
                              _SelectedImageStrip(
                                images: _messageImages,
                                onRemove: _removeMessageImage,
                              ),
                            ],
                            const SizedBox(height: 10),
                            SizedBox(
                              width: double.infinity,
                              child: CupertinoButton(
                                color: const Color(0xFFDCEFEA),
                                borderRadius: BorderRadius.circular(12),
                                onPressed: () {
                                  final text = _messageController.text.trim();
                                  if (text.isEmpty && _messageImages.isEmpty) {
                                    return;
                                  }
                                  _sendCommand("message", payload: {
                                    "text": text,
                                    "images": _messageImages
                                        .map((image) => image.toPayload())
                                        .toList(),
                                  });
                                  _messageController.clear();
                                  setState(() {
                                    _messageImages = const [];
                                  });
                                },
                                child: Text(
                                  strings.send,
                                  style: const TextStyle(
                                    color: Color(0xFF0F766E),
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ),
                            if (messages.isNotEmpty) ...[
                              const SizedBox(height: 16),
                              ...messages.entries.map((entry) {
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: 12),
                                  child: DecoratedBox(
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFF8FAFC),
                                      borderRadius: BorderRadius.circular(14),
                                    ),
                                    child: Padding(
                                      padding: const EdgeInsets.all(12),
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            entry.key,
                                            style: const TextStyle(
                                              fontSize: 15,
                                              fontWeight: FontWeight.w600,
                                              color: Color(0xFF111827),
                                            ),
                                          ),
                                          const SizedBox(height: 8),
                                          Text(
                                            entry.value?.toString() ?? "",
                                            style: const TextStyle(
                                              color: Color(0xFF374151),
                                              fontSize: 14,
                                              height: 1.4,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                );
                              }),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ]),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({
    required this.task,
    required this.selected,
    required this.onTap,
  });

  final Map<String, dynamic> task;
  final bool selected;
  final VoidCallback onTap;

  Color _statusColor(String status) {
    switch (status) {
      case "completed":
        return const Color(0xFF15803D);
      case "paused":
        return const Color(0xFFD97706);
      case "awaiting_input":
        return const Color(0xFFD97706);
      case "in_progress":
        return const Color(0xFF2563EB);
      default:
        return const Color(0xFF475569);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = task["state"] as Map<String, dynamic>?;
    final status = state?["overallStatus"]?.toString() ?? "unknown";
    final currentPhase = state?["currentPhase"]?.toString() ?? "-";
    final accent = _statusColor(status);

    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        decoration: BoxDecoration(
          color: CupertinoColors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: selected ? accent : const Color(0xFFE5E7EB),
            width: selected ? 2 : 1,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      task["taskId"]?.toString() ?? "-",
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF111827),
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: accent.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      child: Text(
                        status,
                        style: TextStyle(
                          color: accent,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                currentPhase,
                style: const TextStyle(
                  color: Color(0xFF0F766E),
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                task["deviceId"]?.toString() ?? "-",
                style: const TextStyle(
                  color: Color(0xFF6B7280),
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SelectedImageStrip extends StatelessWidget {
  const _SelectedImageStrip({
    required this.images,
    required this.onRemove,
  });

  final List<_SelectedImage> images;
  final void Function(int index) onRemove;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 76,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: images.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (context, index) {
          final image = images[index];
          return Stack(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Image.memory(
                  image.bytes,
                  width: 76,
                  height: 76,
                  fit: BoxFit.cover,
                ),
              ),
              Positioned(
                top: 4,
                right: 4,
                child: GestureDetector(
                  onTap: () => onRemove(index),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: const Color(0xCC111827),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: const Padding(
                      padding: EdgeInsets.all(4),
                      child: Icon(
                        CupertinoIcons.clear_thick,
                        size: 10,
                        color: CupertinoColors.white,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _StartWorkflowResult {
  const _StartWorkflowResult({
    required this.taskId,
    required this.runId,
    required this.workFolder,
    required this.workflowFilename,
    required this.taskInputs,
    required this.images,
  });

  final String taskId;
  final String runId;
  final String workFolder;
  final String workflowFilename;
  final Map<String, String> taskInputs;
  final List<_SelectedImage> images;
}

class _StartWorkflowSheet extends StatefulWidget {
  const _StartWorkflowSheet({
    required this.strings,
    required this.workflows,
    required this.workFolders,
  });

  final AppStrings strings;
  final List<Map<String, dynamic>> workflows;
  final List<Map<String, dynamic>> workFolders;

  @override
  State<_StartWorkflowSheet> createState() => _StartWorkflowSheetState();
}

class _StartWorkflowSheetState extends State<_StartWorkflowSheet> {
  final ImagePicker _imagePicker = ImagePicker();
  late String _selectedWorkflow;
  late String _selectedFolder;
  final Map<String, TextEditingController> _controllers = {};
  List<_SelectedImage> _images = const [];

  AppStrings get strings => widget.strings;

  @override
  void initState() {
    super.initState();
    _selectedWorkflow = widget.workflows.first["filename"]?.toString() ?? "";
    _selectedFolder = widget.workFolders.first["path"]?.toString() ?? "";
    _syncPromptControllers();
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _pickWorkflow() async {
    final value = await _showPicker(
      title: strings.workflow,
      options: widget.workflows,
      currentValue: _selectedWorkflow,
      valueForOption: (option) => option["filename"]?.toString() ?? "",
      labelForOption: (option) => option["name"]?.toString() ?? "-",
    );
    if (value == null) return;
    setState(() {
      _selectedWorkflow = value;
      _syncPromptControllers();
    });
  }

  Future<void> _pickFolder() async {
    final value = await _showPicker(
      title: strings.workFolder,
      options: widget.workFolders,
      currentValue: _selectedFolder,
      valueForOption: (option) => option["path"]?.toString() ?? "",
      labelForOption: (option) => option["name"]?.toString() ?? "-",
    );
    if (value == null) return;
    setState(() {
      _selectedFolder = value;
    });
  }

  Future<String?> _showPicker({
    required String title,
    required List<Map<String, dynamic>> options,
    required String currentValue,
    required String Function(Map<String, dynamic>) valueForOption,
    required String Function(Map<String, dynamic>) labelForOption,
  }) async {
    var selected = currentValue;
    final initialIndex = options.indexWhere(
      (option) => valueForOption(option) == currentValue,
    );
    final controller = FixedExtentScrollController(
      initialItem: initialIndex >= 0 ? initialIndex : 0,
    );

    return showCupertinoModalPopup<String>(
      context: context,
      builder: (context) {
        return Container(
          height: 300,
          color: CupertinoColors.systemBackground.resolveFrom(context),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    CupertinoButton(
                      padding: EdgeInsets.zero,
                      onPressed: () => Navigator.of(context).pop(),
                      child: Text(strings.cancel),
                    ),
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF111827),
                      ),
                    ),
                    CupertinoButton(
                      padding: EdgeInsets.zero,
                      onPressed: () => Navigator.of(context).pop(selected),
                      child: Text(strings.done),
                    ),
                  ],
                ),
              ),
              const ColoredBox(
                color: Color(0xFFE5E7EB),
                child: SizedBox(height: 1, width: double.infinity),
              ),
              Expanded(
                child: CupertinoPicker(
                  scrollController: controller,
                  itemExtent: 36,
                  onSelectedItemChanged: (index) {
                    selected = valueForOption(options[index]);
                  },
                  children: options
                      .map((option) => Center(
                            child: Text(labelForOption(option)),
                          ))
                      .toList(),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  List<Map<String, dynamic>> get _displayTaskInputFields {
    final selected = widget.workflows.cast<Map<String, dynamic>?>().firstWhere(
          (workflow) => workflow?["filename"]?.toString() == _selectedWorkflow,
          orElse: () => widget.workflows.first,
        );
    return ((selected?["taskInputFields"] as List?) ?? const [])
        .whereType<Map>()
        .map((entry) => Map<String, dynamic>.from(entry))
        .toList();
  }

  void _syncPromptControllers() {
    final nextKeys = _displayTaskInputFields
        .map((field) => field["key"]?.toString() ?? "")
        .where((key) => key.isNotEmpty)
        .toSet();

    final staleKeys = _controllers.keys
        .where((key) => !nextKeys.contains(key))
        .toList(growable: false);
    for (final key in staleKeys) {
      _controllers.remove(key)?.dispose();
    }

    for (final key in nextKeys) {
      _controllers.putIfAbsent(key, TextEditingController.new);
    }
  }

  void _submit() {
    final taskInputs = <String, String>{};
    for (final field in _displayTaskInputFields) {
      final key = field["key"]?.toString() ?? "";
      taskInputs[key] = _controllers[key]?.text.trim() ?? "";
    }
    final hasMissingRequiredField = _displayTaskInputFields.any((field) {
      final key = field["key"]?.toString() ?? "";
      final required = field["required"] != false;
      if (!required) return false;
      return (taskInputs[key] ?? "").isEmpty;
    });
    if (hasMissingRequiredField) return;

    final firstKey = _displayTaskInputFields.isNotEmpty
        ? _displayTaskInputFields.first["key"]?.toString() ?? ""
        : "";
    final taskId = firstKey.isNotEmpty &&
            (taskInputs[firstKey]?.trim().isNotEmpty ?? false)
        ? taskInputs[firstKey]!.trim()
        : "task-${DateTime.now().millisecondsSinceEpoch}";
    final runId = "run-${DateTime.now().millisecondsSinceEpoch}";

    Navigator.of(context).pop(
      _StartWorkflowResult(
        taskId: taskId,
        runId: runId,
        workFolder: _selectedFolder,
        workflowFilename: _selectedWorkflow,
        taskInputs: taskInputs,
        images: _images,
      ),
    );
  }

  Future<void> _addImages() async {
    final images = await _pickSelectedImages(_imagePicker);
    if (!mounted || images.isEmpty) return;
    setState(() {
      _images = [..._images, ...images];
    });
  }

  void _removeImage(int index) {
    setState(() {
      _images = [
        for (var i = 0; i < _images.length; i++)
          if (i != index) _images[i],
      ];
    });
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final canSubmit = _selectedWorkflow.isNotEmpty &&
        _selectedFolder.isNotEmpty &&
        _controllers.values
            .every((controller) => controller.text.trim().isNotEmpty);

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(bottom: bottomInset),
        child: Align(
          alignment: Alignment.bottomCenter,
          child: DecoratedBox(
            decoration: const BoxDecoration(
              color: Color(0xFFF9FAFB),
              borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Center(
                      child: Container(
                        width: 44,
                        height: 5,
                        decoration: BoxDecoration(
                          color: const Color(0xFFD1D5DB),
                          borderRadius: BorderRadius.circular(999),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      strings.startWorkflow,
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF111827),
                      ),
                    ),
                    const SizedBox(height: 16),
                    _PickerField(
                      label: strings.workflow,
                      value: _selectedLabel(
                        widget.workflows,
                        _selectedWorkflow,
                        (item) => item["filename"]?.toString() ?? "",
                        (item) => item["name"]?.toString() ?? "-",
                      ),
                      onTap: _pickWorkflow,
                    ),
                    const SizedBox(height: 12),
                    _PickerField(
                      label: strings.workFolder,
                      value: _selectedLabel(
                        widget.workFolders,
                        _selectedFolder,
                        (item) => item["path"]?.toString() ?? "",
                        (item) => item["name"]?.toString() ?? "-",
                      ),
                      onTap: _pickFolder,
                    ),
                    const SizedBox(height: 12),
                    ..._displayTaskInputFields.map((field) {
                      final key = field["key"]?.toString() ?? "";
                      final label = field["label"]?.toString() ?? key;
                      final placeholder =
                          field["placeholder"]?.toString() ?? "";
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _FieldLabel(label),
                            const SizedBox(height: 10),
                            CupertinoTextField(
                              controller: _controllers[key],
                              minLines: 2,
                              maxLines: 4,
                              padding: const EdgeInsets.all(14),
                              placeholder: placeholder,
                              decoration: _inputDecoration(),
                              onChanged: (_) {
                                setState(() {});
                              },
                            ),
                          ],
                        ),
                      );
                    }),
                    Row(
                      children: [
                        CupertinoButton(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 10,
                          ),
                          color: const Color(0xFFE5E7EB),
                          borderRadius: BorderRadius.circular(12),
                          onPressed: _addImages,
                          child: Text(
                            strings.attachImages,
                            style: const TextStyle(
                              color: Color(0xFF111827),
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (_images.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      _SelectedImageStrip(
                        images: _images,
                        onRemove: _removeImage,
                      ),
                    ],
                    const SizedBox(height: 8),
                    SizedBox(
                      width: double.infinity,
                      child: CupertinoButton.filled(
                        onPressed: canSubmit ? _submit : null,
                        borderRadius: BorderRadius.circular(14),
                        child: Text(strings.start),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  String _selectedLabel(
    List<Map<String, dynamic>> items,
    String value,
    String Function(Map<String, dynamic>) valueForItem,
    String Function(Map<String, dynamic>) labelForItem,
  ) {
    final matched = items.where((item) => valueForItem(item) == value);
    if (matched.isEmpty) return "-";
    return labelForItem(matched.first);
  }
}

class _PickerField extends StatelessWidget {
  const _PickerField({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: DecoratedBox(
        decoration: _inputDecoration(),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _FieldLabel(label),
                    const SizedBox(height: 6),
                    Text(
                      value,
                      style: const TextStyle(
                        color: Color(0xFF111827),
                        fontSize: 17,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                CupertinoIcons.chevron_up_chevron_down,
                size: 18,
                color: Color(0xFF6B7280),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ConnectionSheet extends StatelessWidget {
  const _ConnectionSheet({
    required this.strings,
    required this.locale,
    required this.baseUrlController,
    required this.status,
    required this.availabilityMessage,
    required this.connecting,
    required this.onDisconnect,
    required this.onConnect,
  });

  final AppStrings strings;
  final Locale locale;
  final TextEditingController baseUrlController;
  final String status;
  final String availabilityMessage;
  final bool connecting;
  final Future<void> Function() onDisconnect;
  final Future<void> Function() onConnect;

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final isConnected = status == ConnectionStatus.connected;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(bottom: bottomInset),
        child: Align(
          alignment: Alignment.bottomCenter,
          child: DecoratedBox(
            decoration: const BoxDecoration(
              color: Color(0xFFF9FAFB),
              borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Center(
                      child: Container(
                        width: 44,
                        height: 5,
                        decoration: BoxDecoration(
                          color: const Color(0xFFD1D5DB),
                          borderRadius: BorderRadius.circular(999),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            strings.connection,
                            style: const TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF111827),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    _FieldLabel(strings.connectionStatus(status)),
                    if (availabilityMessage.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(
                        availabilityMessage,
                        style: const TextStyle(
                          fontSize: 14,
                          color: Color(0xFF6B7280),
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    _FieldLabel(strings.backendUrl),
                    const SizedBox(height: 10),
                    CupertinoTextField(
                      controller: baseUrlController,
                      enabled: !isConnected,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 14,
                      ),
                      decoration: _inputDecoration(),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: CupertinoButton.filled(
                        onPressed: connecting
                            ? null
                            : (isConnected ? onDisconnect : onConnect),
                        borderRadius: BorderRadius.circular(14),
                        child: Text(
                          connecting
                              ? strings.connecting
                              : (isConnected
                                  ? strings.disconnect
                                  : strings.connect),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SettingsPage extends StatelessWidget {
  const _SettingsPage({
    required this.strings,
    required this.locale,
    required this.onLocaleChanged,
  });

  final AppStrings strings;
  final Locale locale;
  final Future<void> Function(Locale locale) onLocaleChanged;

  @override
  Widget build(BuildContext context) {
    return CupertinoPageScaffold(
      navigationBar: CupertinoNavigationBar(
        middle: Text(strings.settings),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _SectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _FieldLabel(strings.language),
                    const SizedBox(height: 12),
                    _LanguageOption(
                      label: strings.english,
                      selected: locale.languageCode == "en",
                      onTap: () async {
                        await onLocaleChanged(const Locale("en"));
                      },
                    ),
                    const SizedBox(height: 10),
                    _LanguageOption(
                      label: strings.chinese,
                      selected: locale.languageCode == "zh",
                      onTap: () async {
                        await onLocaleChanged(const Locale("zh"));
                      },
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: CupertinoColors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: child,
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: Color(0xFF6B7280),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: Color(0xFF111827),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({
    required this.status,
    required this.strings,
  });

  final String status;
  final AppStrings strings;

  Color get _color {
    switch (status) {
      case ConnectionStatus.connected:
        return const Color(0xFF15803D);
      case ConnectionStatus.connecting:
        return const Color(0xFFD97706);
      default:
        return const Color(0xFF6B7280);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: _color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Text(
          strings.connectionStatus(status),
          style: TextStyle(
            color: _color,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          SizedBox(
            width: 56,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF6B7280),
                fontSize: 14,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: Color(0xFF111827),
                fontSize: 15,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LanguageOption extends StatelessWidget {
  const _LanguageOption({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: selected ? const Color(0xFFDCEFEA) : const Color(0xFFF9FAFB),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? const Color(0xFF0F766E) : const Color(0xFFD1D5DB),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    color: Color(0xFF111827),
                    fontSize: 17,
                  ),
                ),
              ),
              if (selected)
                const Icon(
                  CupertinoIcons.check_mark,
                  color: Color(0xFF0F766E),
                  size: 18,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class ConnectionStatus {
  static const disconnected = "disconnected";
  static const connecting = "connecting";
  static const connected = "connected";
  static const failed = "failed";
  static const error = "error";
}

class AppStrings {
  AppStrings(this.locale);

  final Locale locale;

  static const supportedLocales = [
    Locale("en"),
    Locale("zh"),
  ];

  bool get isZh => locale.languageCode == "zh";

  String get appTitle => isZh ? "开发工作流" : "Dev Workflow";
  String get tasks => isZh ? "任务" : "Tasks";
  String get add => isZh ? "添加" : "Add";
  String get adding => isZh ? "添加中..." : "Adding...";
  String get noTasksYet => isZh ? "还没有任务" : "No tasks yet";
  String get details => isZh ? "详情" : "Details";
  String get status => isZh ? "状态" : "Status";
  String get phase => isZh ? "阶段" : "Phase";
  String get device => isZh ? "设备" : "Device";
  String get delete => isZh ? "删除" : "Delete";
  String get deleteTask => isZh ? "删除任务" : "Delete Task";
  String deleteTaskConfirm(String name) =>
      isZh ? "确定要删除任务 $name 吗？" : "Are you sure you want to delete task $name?";
  String get approve => isZh ? "通过" : "Approve";
  String get reject => isZh ? "拒绝" : "Reject";
  String get rejectTo => isZh ? "选择回退阶段" : "Choose reject target";
  String get noRejectTargets =>
      isZh ? "当前阶段没有可回退目标" : "No reject targets for this phase";
  String get refresh => isZh ? "刷新" : "Refresh";
  String get attachImages => isZh ? "添加图片" : "Add Images";
  String get message => isZh ? "消息" : "Message";
  String get messagePlaceholder =>
      isZh ? "给这个任务发送备注" : "Send a note to this task";
  String get send => isZh ? "发送" : "Send";
  String get commandFailed => isZh ? "命令失败" : "Command failed";
  String get commandFailedPrefix => isZh ? "命令失败: " : "Command failed: ";
  String get failedToConnectPrefix => isZh ? "连接失败: " : "Failed to connect: ";
  String get workflowStarted => isZh ? "工作流已启动" : "Workflow started";
  String get startingWorkflow => isZh ? "启动中..." : "Starting...";
  String get startFailedPrefix => isZh ? "启动失败: " : "Start failed: ";
  String get noOnlineDeviceAvailable =>
      isZh ? "没有可用的在线设备" : "No online device available";
  String get noDesktopOnline =>
      isZh ? "当前没有在线的桌面端" : "No desktop is currently online";
  String get deviceMetadataIncomplete =>
      isZh ? "设备元数据不完整" : "Device metadata is incomplete";
  String get mobileAccessDisabled =>
      isZh ? "桌面端未开启手机访问" : "Mobile access is disabled on the desktop";
  String get startWorkflow => isZh ? "开始工作流" : "Start Workflow";
  String get workflow => isZh ? "工作流" : "Workflow";
  String get workFolder => isZh ? "工作目录" : "Work Folder";
  String get start => isZh ? "开始" : "Start";
  String get cancel => isZh ? "取消" : "Cancel";
  String get done => isZh ? "完成" : "Done";
  String get instanceId => isZh ? "实例 ID" : "Instance ID";
  String get enterIdentifier => isZh ? "输入标识" : "Enter an identifier";
  String get connection => isZh ? "连接" : "Connection";
  String get backendUrl => isZh ? "后端地址" : "Backend URL";
  String get connect => isZh ? "连接" : "Connect";
  String get disconnect => isZh ? "断开连接" : "Disconnect";
  String get connecting => isZh ? "连接中..." : "Connecting...";
  String get settings => isZh ? "设置" : "Settings";
  String get language => isZh ? "语言" : "Language";
  String get english => isZh ? "英文" : "English";
  String get chinese => isZh ? "中文" : "Chinese";

  String connectionStatus(String status) {
    switch (status) {
      case ConnectionStatus.connected:
        return isZh ? "已连接" : "Connected";
      case ConnectionStatus.connecting:
        return isZh ? "连接中" : "Connecting";
      case ConnectionStatus.failed:
        return isZh ? "连接失败" : "Connect failed";
      case ConnectionStatus.error:
        return isZh ? "连接错误" : "Connection error";
      default:
        return isZh ? "未连接" : "Disconnected";
    }
  }

  String currentLanguage(String languageCode) {
    final label = languageCode == "zh" ? chinese : english;
    return isZh ? "当前语言: $label" : "Current language: $label";
  }
}

BoxDecoration _inputDecoration() {
  return BoxDecoration(
    color: const Color(0xFFF9FAFB),
    borderRadius: BorderRadius.circular(14),
    border: Border.all(
      color: const Color(0xFFD1D5DB),
    ),
  );
}
