import test from "node:test";
import assert from "node:assert/strict";

import {
  CommandRequestSchema,
  COMMAND_TYPE,
  DAEMON_QUERY_ACTIONS,
  DaemonHelloSchema,
  RELAY_API_ROUTES,
  RELAY_DAEMON_MESSAGE_TYPES,
  RELAY_UI_EVENT_TYPES,
  RELAY_WS_PATHS,
  TaskSnapshotSchema,
  UiBootstrapEventSchema,
  formatRelayApiRoute,
  makeTaskKey,
  normalizeTaskReference,
  parseTaskKey,
} from "./index.ts";

test("accepts canonical daemon hello", () => {
  const message = DaemonHelloSchema.parse({
    type: RELAY_DAEMON_MESSAGE_TYPES.daemonHello,
    protocolVersion: 1,
    deviceId: "local-daemon",
    name: "Local Daemon",
    meta: {},
  });
  assert.equal(message.type, RELAY_DAEMON_MESSAGE_TYPES.daemonHello);
  assert.equal(message.protocolVersion, 1);
  assert.equal(message.deviceId, "local-daemon");
});

test("parses current task key format", () => {
  assert.equal(makeTaskKey("local-daemon", "task-1"), "local-daemon:task-1");
  assert.deepEqual(parseTaskKey("local-daemon:task-1"), {
    deviceId: "local-daemon",
    taskId: "task-1",
  });
  assert.deepEqual(normalizeTaskReference({
    key: "local-daemon:task-1",
    taskId: "task-1",
  }), {
    key: "local-daemon:task-1",
    deviceId: "local-daemon",
    taskId: "task-1",
  });
});

test("accepts current task snapshots and web bootstrap events", () => {
  const task = TaskSnapshotSchema.parse({
    key: "local-daemon:task-1",
    deviceId: "local-daemon",
    taskId: "task-1",
    runId: "run-1",
    workFolder: "/tmp/project",
    state: { currentPhase: "implement" },
    messages: {},
    outputArtifacts: {},
    interactions: {},
    updatedAt: "2026-05-29T00:00:00.000Z",
  });

  const bootstrap = UiBootstrapEventSchema.parse({
    type: RELAY_UI_EVENT_TYPES.bootstrap,
    devices: [{
      deviceId: "local-daemon",
      name: "Local Daemon",
      status: "online",
      meta: {},
    }],
    tasks: [task],
  });

  assert.equal(bootstrap.tasks[0].taskId, "task-1");
});

test("allows all canonical command types", () => {
  for (const command of Object.values(COMMAND_TYPE)) {
    const parsed = CommandRequestSchema.parse({
      type: RELAY_DAEMON_MESSAGE_TYPES.commandRequest,
      commandId: `cmd-${command}`,
      taskId: "task-1",
      command,
      payload: {},
    });
    assert.equal(parsed.command, command);
  }
});

test("centralizes relay HTTP and WebSocket routes", () => {
  assert.equal(RELAY_WS_PATHS.daemon, "/ws/daemon");
  assert.equal(RELAY_WS_PATHS.ui, "/ws/ui");
  assert.equal(RELAY_API_ROUTES.taskCommands, "/api/tasks/:taskId/commands");
  assert.equal(
    formatRelayApiRoute(RELAY_API_ROUTES.taskCommands, { taskId: "task 1" }),
    "/api/tasks/task%201/commands"
  );
});

test("centralizes daemon query action names", () => {
  assert.equal(DAEMON_QUERY_ACTIONS.listTasks, "list_tasks");
  assert.equal(DAEMON_QUERY_ACTIONS.getWorkflowConfig, "get_workflow_config");
  assert.equal(DAEMON_QUERY_ACTIONS.removeTask, "remove_task");
  assert.equal(DAEMON_QUERY_ACTIONS.openTaskOutput, "open_task_output");
});
