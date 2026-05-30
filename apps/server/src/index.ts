import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { nanoid } from "nanoid";
import {
  COMMAND_TYPE,
  COMMAND_TYPES,
  DAEMON_QUERY_ACTIONS,
  PROTOCOL_VERSION,
  RELAY_API_ROUTES,
  RELAY_DAEMON_MESSAGE_TYPES,
  RELAY_UI_EVENT_TYPES,
  RELAY_WS_PATHS,
} from "@dev-workflow/protocol";

const fastify = Fastify({
  logger: true,
  bodyLimit: Number(process.env.RELAY_SERVER_BODY_LIMIT || 25 * 1024 * 1024),
});
const daemonConnections = new Map();
const uiSockets = new Set();
const pendingDaemonRequests = new Map();
const pendingCommands = new Map();
const ALLOWED_COMMANDS = new Set(COMMAND_TYPES);

function now() {
  return new Date().toISOString();
}

function sendJson(socket, payload) {
  if (!socket || socket.readyState !== 1) return;
  socket.send(JSON.stringify(payload));
}

function publicDevice(connection) {
  if (!connection) return null;
  return {
    deviceId: connection.deviceId,
    name: connection.name || connection.deviceId,
    status: "online",
    lastSeenAt: connection.lastSeenAt || now(),
    meta: connection.meta || {},
  };
}

function publicTask(task, fallback = {}) {
  if (!task) return null;
  const deviceId = String(task.deviceId || fallback.deviceId || "").trim();
  const taskId = String(task.taskId || fallback.taskId || "").trim();
  if (!deviceId || !taskId) return null;
  return {
    key: task.key || `${deviceId}:${taskId}`,
    deviceId,
    taskId,
    workFolder: task.workFolder || "",
    state: task.state || null,
    messages: task.messages || {},
    outputArtifacts: task.outputArtifacts || {},
    interactions: task.interactions || {},
    updatedAt: task.updatedAt || task.state?.updated || now(),
  };
}

function listDevices() {
  return Array.from(daemonConnections.values())
    .map(publicDevice)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function broadcastUi(payload) {
  for (const socket of uiSockets) {
    sendJson(socket, payload);
  }
}

function getDefaultDaemonConnection() {
  const preferredDeviceId = String(process.env.DEVICE_ID || process.env.DEFAULT_DEVICE_ID || "").trim();
  if (preferredDeviceId && daemonConnections.has(preferredDeviceId)) {
    return daemonConnections.get(preferredDeviceId);
  }
  return Array.from(daemonConnections.values())[0] || null;
}

function getRequestDeviceId(request) {
  return String(request?.query?.deviceId || request?.headers?.["x-device-id"] || "").trim();
}

function rejectPendingDaemonRequestsForDevice(deviceId) {
  for (const [requestId, pending] of pendingDaemonRequests) {
    if (pending.deviceId !== deviceId) continue;
    clearTimeout(pending.timeout);
    pendingDaemonRequests.delete(requestId);
    pending.reject(new Error("device is offline"));
  }
}

function createDaemonConnectionRequest(deviceId, action, payload = {}, timeoutMs = 10000) {
  const connection = deviceId ? daemonConnections.get(deviceId) : getDefaultDaemonConnection();
  if (!connection || connection.socket.readyState !== 1) {
    throw new Error("device is offline");
  }

  const requestId = nanoid();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingDaemonRequests.delete(requestId);
      reject(new Error("daemon request timed out"));
    }, timeoutMs);

    pendingDaemonRequests.set(requestId, {
      deviceId: connection.deviceId,
      resolve,
      reject,
      timeout,
    });

    sendJson(connection.socket, {
      type: RELAY_DAEMON_MESSAGE_TYPES.queryRequest,
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      action,
      payload,
    });
  });
}

function resolveDaemonConnectionRequest(message) {
  const pending = pendingDaemonRequests.get(message.requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingDaemonRequests.delete(message.requestId);
  if (message.ok === false) {
    pending.reject(new Error(message.error || "daemon query failed"));
    return;
  }
  pending.resolve(message.data || {});
}

function createDaemonRequest(action, payload = {}, request = null, timeoutMs = 10000) {
  return createDaemonConnectionRequest(getRequestDeviceId(request), action, payload, timeoutMs);
}

function sendQueryError(reply, error) {
  const message = error instanceof Error ? error.message : "request failed";
  if (message === "device is offline") {
    return reply.code(409).send({ error: message });
  }
  return reply.code(502).send({ error: message });
}

async function listTasksForDevice(deviceId) {
  const data = await createDaemonConnectionRequest(deviceId, DAEMON_QUERY_ACTIONS.listTasks);
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  return tasks
    .map((task) => publicTask(task, { deviceId }))
    .filter(Boolean);
}

async function getTaskForDevice(deviceId, taskId) {
  const data = await createDaemonConnectionRequest(deviceId, DAEMON_QUERY_ACTIONS.getTask, { taskId });
  return publicTask(data.task, { deviceId, taskId });
}

async function listAllTasks() {
  const devices = listDevices();
  const snapshots = await Promise.all(
    devices.map(async (device) => {
      try {
        return await listTasksForDevice(device.deviceId);
      } catch {
        return [];
      }
    })
  );
  return snapshots.flat();
}

async function broadcastDeviceTasks(deviceId) {
  const tasks = await listTasksForDevice(deviceId).catch(() => []);
  for (const task of tasks) {
    broadcastUi({ type: RELAY_UI_EVENT_TYPES.taskSnapshot, task });
  }
}

function createPendingCommand(deviceId, taskId, type, payload = {}) {
  const command = {
    id: nanoid(),
    deviceId,
    taskId,
    type,
    payload,
    status: "pending",
    createdAt: now(),
    completedAt: null,
    error: "",
  };
  let resolveCompletion;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  const timeout = setTimeout(() => {
    pendingCommands.delete(command.id);
    command.status = "error";
    command.error = "command timed out";
    command.completedAt = now();
    resolveCompletion(command);
  }, 30000);
  pendingCommands.set(command.id, { command, timeout, completion, resolveCompletion });
  return command;
}

function resolvePendingCommand(commandId, status, error = "") {
  const pending = pendingCommands.get(commandId);
  if (!pending) {
    return {
      id: commandId,
      status,
      error,
      completedAt: now(),
    };
  }
  clearTimeout(pending.timeout);
  pendingCommands.delete(commandId);
  pending.command.status = status;
  pending.command.error = error;
  pending.command.completedAt = now();
  pending.resolveCompletion(pending.command);
  return pending.command;
}

async function waitForCommandResult(command) {
  if (!command || command.status !== "pending") return command;
  const pending = pendingCommands.get(command.id);
  if (!pending) return command;
  return pending.completion;
}

function sendCommandToDaemon(deviceId, taskId, type, payload = {}) {
  const connection = daemonConnections.get(deviceId);
  if (!connection || connection.socket.readyState !== 1) {
    throw new Error("device is offline");
  }
  const command = createPendingCommand(deviceId, taskId, type, payload);
  sendJson(connection.socket, {
    type: RELAY_DAEMON_MESSAGE_TYPES.commandRequest,
    protocolVersion: PROTOCOL_VERSION,
    commandId: command.id,
    taskId,
    command: type,
    payload,
  });
  broadcastUi({ type: RELAY_UI_EVENT_TYPES.commandStatus, command });
  return command;
}

function sendCommandToDefaultDaemon(taskId, type, payload = {}, request = null) {
  const requestedDeviceId = getRequestDeviceId(request);
  const connection = requestedDeviceId ? daemonConnections.get(requestedDeviceId) : getDefaultDaemonConnection();
  if (!connection) throw new Error("device is offline");
  return sendCommandToDaemon(connection.deviceId, taskId, type, payload);
}

await fastify.register(cors, { origin: true });
await fastify.register(websocket);

fastify.get(RELAY_API_ROUTES.health, async () => ({ ok: true }));

fastify.get(RELAY_API_ROUTES.devices, async () => ({
  devices: listDevices(),
}));

fastify.get(RELAY_API_ROUTES.tasks, async () => ({
  tasks: await listAllTasks(),
}));

fastify.get(RELAY_API_ROUTES.workflow, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.getWorkflowConfig, {}, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.get(RELAY_API_ROUTES.aiApiProfiles, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.listAiApiProfiles, {}, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.post(RELAY_API_ROUTES.aiApiProfiles, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.saveAiApiProfile, { profile: request.body || {} }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.delete(RELAY_API_ROUTES.aiApiProfile, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.deleteAiApiProfile, { id: request.params.id }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.get(RELAY_API_ROUTES.workflows, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.listWorkflows, {}, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.get(RELAY_API_ROUTES.workflowByFilename, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.getWorkflow, { filename: request.params.filename }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.put(RELAY_API_ROUTES.workflowVisibility, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.setWorkflowVisible, {
      filename: request.params.filename,
      visible: request.body?.visible,
    }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.post(RELAY_API_ROUTES.workflows, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.createWorkflow, {
      workflow: request.body || {},
      draft: request.query?.draft === "1",
    }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.put(RELAY_API_ROUTES.workflowByFilename, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.updateWorkflow, {
      filename: request.params.filename,
      workflow: request.body || {},
      draft: request.query?.draft === "1",
    }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.delete(RELAY_API_ROUTES.workflowByFilename, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.removeWorkflow, { filename: request.params.filename }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.put(RELAY_API_ROUTES.workflowActivate, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.activateWorkflow, { filename: request.params.filename }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.post(RELAY_API_ROUTES.generateSkill, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.generateSkill, request.body || {}, request, 30000);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.get(RELAY_API_ROUTES.skills, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.listSkills, {}, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.post(RELAY_API_ROUTES.skills, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.saveSkill, { skill: request.body || {} }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.delete(RELAY_API_ROUTES.skillBySlug, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.deleteSkill, { slug: request.params.slug }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.post(RELAY_API_ROUTES.skillsImport, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.importSkills, {
      paths: Array.isArray(request.body?.paths) ? request.body.paths : [],
    }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.get(RELAY_API_ROUTES.workfolders, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.listWorkfolders, {}, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.post(RELAY_API_ROUTES.workfolders, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.addWorkfolder, { path: request.body?.path }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.delete(RELAY_API_ROUTES.workfolders, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.removeWorkfolder, { path: request.body?.path }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.get(RELAY_API_ROUTES.taskState, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.getTaskState, {
      taskId: request.params.taskId,
      runId: request.query?.runId || "",
    }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.delete(RELAY_API_ROUTES.taskById, async (request, reply) => {
  try {
    const taskId = String(request.params.taskId || "").trim();
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.removeTask, {
      taskId,
      runId: request.query?.runId || "",
      removeWorktree: request.query?.removeWorktree === "1" || request.query?.removeWorktree === "true",
    }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.post(RELAY_API_ROUTES.taskUpload, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.saveTaskUploads, {
      runId: request.params.runId,
      files: request.body?.files || [],
    }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.post(RELAY_API_ROUTES.openPath, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.openPath, {
      path: request.body?.path,
      editor: request.body?.editor || "code",
    }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.delete(RELAY_API_ROUTES.taskWorktree, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.removeTaskWorktree, {
      taskId: request.params.taskId,
      runId: request.query?.runId || "",
    }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.post(RELAY_API_ROUTES.taskOpenOutput, async (request, reply) => {
  try {
    return await createDaemonRequest(DAEMON_QUERY_ACTIONS.openTaskOutput, {
      taskId: request.params.taskId,
      runId: request.body?.runId || "",
      phaseId: request.body?.phaseId || "",
      outputKey: request.body?.outputKey || "",
      editor: request.body?.editor || "code",
    }, request);
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.post(RELAY_API_ROUTES.taskCommands, async (request, reply) => {
  const taskId = String(request.params.taskId || "").trim();
  const { type, payload } = request.body || {};
  if (!ALLOWED_COMMANDS.has(type)) {
    return reply.code(400).send({ error: "unsupported command" });
  }
  try {
    const command = sendCommandToDefaultDaemon(taskId, type, payload || {}, request);
    return { command };
  } catch (error) {
    return sendQueryError(reply, error);
  }
});

fastify.get(RELAY_API_ROUTES.deviceTask, async (request, reply) => {
  const { deviceId, taskId } = request.params;
  try {
    const task = await getTaskForDevice(deviceId, taskId);
    if (!task) return reply.code(404).send({ error: "task not found" });
    return { task };
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    if (message === "device is offline") {
      return reply.code(409).send({ error: message });
    }
    return reply.code(502).send({ error: message });
  }
});

fastify.post(RELAY_API_ROUTES.deviceTaskCommands, async (request, reply) => {
  const { deviceId, taskId } = request.params;
  const { type, payload } = request.body || {};
  if (!ALLOWED_COMMANDS.has(type)) {
    return reply.code(400).send({ error: "unsupported command" });
  }
  try {
    const command = sendCommandToDaemon(deviceId, taskId, type, payload || {});
    return { command };
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    if (message === "device is offline") {
      return reply.code(409).send({ error: message });
    }
    return reply.code(502).send({ error: message });
  }
});

fastify.get(RELAY_WS_PATHS.daemon, { websocket: true }, (socket) => {
  let deviceId = "";

  socket.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === RELAY_DAEMON_MESSAGE_TYPES.daemonHello) {
      deviceId = String(message.deviceId || "").trim();
      if (!deviceId) return;
      const connection = {
        deviceId,
        name: message.name || deviceId,
        meta: message.meta || {},
        lastSeenAt: now(),
        socket,
      };
      daemonConnections.set(deviceId, connection);
      const device = publicDevice(connection);
      sendJson(socket, { type: RELAY_DAEMON_MESSAGE_TYPES.daemonAccepted, protocolVersion: PROTOCOL_VERSION, device });
      broadcastUi({ type: RELAY_UI_EVENT_TYPES.tasksRemoveDevice, deviceId });
      broadcastUi({ type: RELAY_UI_EVENT_TYPES.deviceStatus, device });
      await broadcastDeviceTasks(deviceId);
      return;
    }

    if (!deviceId) return;

    if (message.type === RELAY_DAEMON_MESSAGE_TYPES.queryResponse) {
      resolveDaemonConnectionRequest(message);
      return;
    }

    if (message.type === RELAY_DAEMON_MESSAGE_TYPES.taskSnapshot) {
      const task = publicTask(message.task, {
        deviceId,
        taskId: message.taskId,
      });
      if (task) {
        broadcastUi({ type: RELAY_UI_EVENT_TYPES.taskSnapshot, task });
      }
      return;
    }

    if (message.type === RELAY_DAEMON_MESSAGE_TYPES.taskEvent) {
      broadcastUi({
        type: RELAY_UI_EVENT_TYPES.taskEvent,
        deviceId,
        taskId: message.taskId,
        event: message.event,
      });
      const task = publicTask(message.task, {
        deviceId,
        taskId: message.taskId,
      });
      if (task) {
        broadcastUi({
          type: RELAY_UI_EVENT_TYPES.taskEvent,
          taskKey: task.key,
          deviceId,
          taskId: task.taskId,
          event: message.event,
          task,
        });
      }
      return;
    }

    if (message.type === RELAY_DAEMON_MESSAGE_TYPES.taskRemoved) {
      broadcastUi({
        type: RELAY_UI_EVENT_TYPES.tasksRemoveTask,
        taskKey: `${deviceId}:${message.taskId}`,
        deviceId,
        taskId: message.taskId,
        runId: message.runId || "",
      });
      return;
    }

    if (message.type === RELAY_DAEMON_MESSAGE_TYPES.commandResult) {
      const command = resolvePendingCommand(
        message.commandId,
        message.status || "ok",
        message.error || ""
      );
      broadcastUi({ type: RELAY_UI_EVENT_TYPES.commandStatus, command });
    }
  });

  socket.on("close", () => {
    if (!deviceId) return;
    const connection = daemonConnections.get(deviceId);
    if (connection?.socket !== socket) return;
    daemonConnections.delete(deviceId);
    rejectPendingDaemonRequestsForDevice(deviceId);
    broadcastUi({
      type: RELAY_UI_EVENT_TYPES.deviceStatus,
      device: {
        deviceId,
        name: connection.name || deviceId,
        status: "offline",
        lastSeenAt: now(),
        meta: connection.meta || {},
      },
    });
    broadcastUi({ type: RELAY_UI_EVENT_TYPES.tasksRemoveDevice, deviceId });
  });
});

fastify.get(RELAY_WS_PATHS.ui, { websocket: true }, (socket) => {
  uiSockets.add(socket);
  Promise.resolve()
    .then(async () => {
      sendJson(socket, {
        type: RELAY_UI_EVENT_TYPES.bootstrap,
        devices: listDevices(),
        tasks: await listAllTasks(),
      });
    })
    .catch(() => {
      sendJson(socket, {
        type: RELAY_UI_EVENT_TYPES.bootstrap,
        devices: listDevices(),
        tasks: [],
      });
    });

  socket.on("close", () => {
    uiSockets.delete(socket);
  });
});

const port = Number(process.env.RELAY_SERVER_PORT || process.env.BACKEND_PORT || process.env.PORT || 8787);
const host = process.env.RELAY_SERVER_HOST || process.env.BACKEND_HOST || "0.0.0.0";

fastify.listen({ port, host }).catch((error) => {
  fastify.log.error(error);
  process.exit(1);
});
