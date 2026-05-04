import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { nanoid } from "nanoid";

const fastify = Fastify({ logger: true });
const desktopConnections = new Map();
const mobileSockets = new Set();
const pendingDesktopRequests = new Map();
const pendingCommands = new Map();
const ALLOWED_COMMANDS = new Set([
  "approve",
  "reject",
  "message",
  "sync_task",
  "start_workflow",
  "delete_task",
]);

function now() {
  return new Date().toISOString();
}

function sendJson(socket, payload) {
  if (!socket || socket.readyState !== 1) return;
  socket.send(JSON.stringify(payload));
}

function isDeviceExposed(connection) {
  return connection?.meta?.mobileAccessEnabled === true;
}

function publicDevice(connection) {
  if (!connection || !isDeviceExposed(connection)) return null;
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
    artifacts: task.artifacts || {},
    interactions: task.interactions || {},
    updatedAt: task.updatedAt || task.state?.updated || now(),
  };
}

function listDevices() {
  return Array.from(desktopConnections.values())
    .map(publicDevice)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listHiddenDesktopConnections() {
  return Array.from(desktopConnections.values()).filter((connection) => !isDeviceExposed(connection));
}

function getMobileAvailability() {
  const devices = listDevices();
  if (devices.length > 0) {
    return { status: "available" };
  }

  const hiddenConnections = listHiddenDesktopConnections();
  if (hiddenConnections.length > 0) {
    return {
      status: "desktop_mobile_access_disabled",
      hiddenDesktopCount: hiddenConnections.length,
    };
  }

  return { status: "no_desktop_online" };
}

function broadcastMobileAvailability() {
  broadcastMobile({
    type: "availability",
    availability: getMobileAvailability(),
  });
}

function broadcastMobile(payload) {
  for (const socket of mobileSockets) {
    sendJson(socket, payload);
  }
}

function rejectPendingDesktopRequestsForDevice(deviceId) {
  for (const [requestId, pending] of pendingDesktopRequests) {
    if (pending.deviceId !== deviceId) continue;
    clearTimeout(pending.timeout);
    pendingDesktopRequests.delete(requestId);
    pending.reject(new Error("device is offline"));
  }
}

function createDesktopRequest(deviceId, action, payload = {}, timeoutMs = 10000) {
  const connection = desktopConnections.get(deviceId);
  if (!connection || connection.socket.readyState !== 1 || !isDeviceExposed(connection)) {
    throw new Error("device is offline");
  }

  const requestId = nanoid();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingDesktopRequests.delete(requestId);
      reject(new Error("desktop request timed out"));
    }, timeoutMs);

    pendingDesktopRequests.set(requestId, {
      deviceId,
      resolve,
      reject,
      timeout,
    });

    sendJson(connection.socket, {
      type: "query.request",
      requestId,
      action,
      payload,
    });
  });
}

function resolveDesktopRequest(message) {
  const pending = pendingDesktopRequests.get(message.requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingDesktopRequests.delete(message.requestId);
  if (message.ok === false) {
    pending.reject(new Error(message.error || "desktop query failed"));
    return;
  }
  pending.resolve(message.data || {});
}

async function listTasksForDevice(deviceId) {
  const data = await createDesktopRequest(deviceId, "list_tasks");
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  return tasks
    .map((task) => publicTask(task, { deviceId }))
    .filter(Boolean);
}

async function getTaskForDevice(deviceId, taskId) {
  const data = await createDesktopRequest(deviceId, "get_task", { taskId });
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
    broadcastMobile({ type: "task.snapshot", task });
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
  const timeout = setTimeout(() => {
    pendingCommands.delete(command.id);
  }, 30000);
  pendingCommands.set(command.id, { command, timeout });
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
  return pending.command;
}

function sendCommandToDesktop(deviceId, taskId, type, payload = {}) {
  const connection = desktopConnections.get(deviceId);
  if (!connection || connection.socket.readyState !== 1 || !isDeviceExposed(connection)) {
    throw new Error("device is offline");
  }
  const command = createPendingCommand(deviceId, taskId, type, payload);
  sendJson(connection.socket, {
    type: "command.request",
    commandId: command.id,
    taskId,
    command: type,
    payload,
  });
  broadcastMobile({ type: "command.status", command });
  return command;
}

await fastify.register(cors, { origin: true });
await fastify.register(websocket);

fastify.get("/health", async () => ({ ok: true }));

fastify.get("/api/devices", async () => ({
  devices: listDevices(),
  availability: getMobileAvailability(),
}));

fastify.get("/api/tasks", async () => ({
  tasks: await listAllTasks(),
}));

fastify.get("/api/tasks/:deviceId/:taskId", async (request, reply) => {
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

fastify.post("/api/tasks/:deviceId/:taskId/commands", async (request, reply) => {
  const { deviceId, taskId } = request.params;
  const { type, payload } = request.body || {};
  if (!ALLOWED_COMMANDS.has(type)) {
    return reply.code(400).send({ error: "unsupported command" });
  }
  try {
    const command = sendCommandToDesktop(deviceId, taskId, type, payload || {});
    return { command };
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    if (message === "device is offline") {
      return reply.code(409).send({ error: message });
    }
    return reply.code(502).send({ error: message });
  }
});

fastify.get("/ws/desktop", { websocket: true }, (socket) => {
  let deviceId = "";

  socket.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === "device.hello") {
      deviceId = String(message.deviceId || "").trim();
      if (!deviceId) return;
      const previousConnection = desktopConnections.get(deviceId);
      const connection = {
        deviceId,
        name: message.name || deviceId,
        meta: message.meta || {},
        lastSeenAt: now(),
        socket,
      };
      desktopConnections.set(deviceId, connection);
      const device = publicDevice(connection);
      sendJson(socket, { type: "device.accepted", device });
      broadcastMobile({ type: "tasks.remove_device", deviceId });
      if (device) {
        broadcastMobile({ type: "device.status", device });
        broadcastMobileAvailability();
        await broadcastDeviceTasks(deviceId);
        return;
      }
      broadcastMobileAvailability();
      if (isDeviceExposed(previousConnection)) {
        broadcastMobile({
          type: "device.status",
          device: {
            deviceId,
            name: connection.name || deviceId,
            status: "offline",
            lastSeenAt: connection.lastSeenAt,
            meta: connection.meta || {},
          },
        });
      }
      return;
    }

    if (!deviceId) return;

    if (message.type === "query.response") {
      resolveDesktopRequest(message);
      return;
    }

    if (message.type === "task.snapshot") {
      const task = publicTask(message.task, {
        deviceId,
        taskId: message.taskId,
      });
      if (task) {
        broadcastMobile({ type: "task.snapshot", task });
      }
      return;
    }

    if (message.type === "task.event") {
      if (message.task) {
        const task = publicTask(message.task, {
          deviceId,
          taskId: message.taskId,
        });
        if (task) {
          broadcastMobile({
            type: "task.event",
            taskId: task.key,
            deviceId,
            taskId: task.taskId,
            event: message.event,
            task,
          });
        }
      }
      return;
    }

    if (message.type === "task.removed") {
      broadcastMobile({
        type: "tasks.remove_task",
        taskKey: `${deviceId}:${message.taskId}`,
        deviceId,
        taskId: message.taskId,
      });
      return;
    }

    if (message.type === "command.result") {
      const command = resolvePendingCommand(
        message.commandId,
        message.status || "ok",
        message.error || ""
      );
      broadcastMobile({ type: "command.status", command });
    }
  });

  socket.on("close", () => {
    if (!deviceId) return;
    const connection = desktopConnections.get(deviceId);
    if (connection?.socket !== socket) return;
    desktopConnections.delete(deviceId);
    rejectPendingDesktopRequestsForDevice(deviceId);
    broadcastMobile({
      type: "device.status",
      device: {
        deviceId,
        name: connection.name || deviceId,
        status: "offline",
        lastSeenAt: now(),
        meta: connection.meta || {},
      },
    });
    broadcastMobile({ type: "tasks.remove_device", deviceId });
    broadcastMobileAvailability();
  });
});

fastify.get("/ws/mobile", { websocket: true }, (socket) => {
  mobileSockets.add(socket);
  Promise.resolve()
    .then(async () => {
      const availability = getMobileAvailability();
      if (availability.status === "desktop_mobile_access_disabled") {
        fastify.log.info(
          { hiddenDesktopCount: availability.hiddenDesktopCount },
          "mobile websocket connected but desktop mobile access is disabled"
        );
      }
      sendJson(socket, {
        type: "bootstrap",
        devices: listDevices(),
        tasks: await listAllTasks(),
        availability,
      });
    })
    .catch(() => {
      sendJson(socket, {
        type: "bootstrap",
        devices: listDevices(),
        tasks: [],
        availability: getMobileAvailability(),
      });
    });

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === "command.create") {
      const { deviceId: targetDeviceId, taskId, command, payload } = message;
      if (!ALLOWED_COMMANDS.has(command)) {
        sendJson(socket, { type: "command.error", error: "unsupported command" });
        return;
      }
      try {
        const created = sendCommandToDesktop(
          String(targetDeviceId || "").trim(),
          String(taskId || "").trim(),
          command,
          payload || {}
        );
        sendJson(socket, { type: "command.accepted", command: created });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "request failed";
        sendJson(socket, { type: "command.error", error: messageText });
      }
    }
  });

  socket.on("close", () => {
    mobileSockets.delete(socket);
  });
});

const port = Number(process.env.BACKEND_PORT || process.env.PORT || 8787);
const host = process.env.BACKEND_HOST || "0.0.0.0";

fastify.listen({ port, host }).catch((error) => {
  fastify.log.error(error);
  process.exit(1);
});
