import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { createStore } from "./store.mjs";

const fastify = Fastify({ logger: true });
const store = createStore();
const desktopSockets = new Map();
const mobileSockets = new Set();

function sendJson(socket, payload) {
  if (!socket || socket.readyState !== 1) return;
  socket.send(JSON.stringify(payload));
}

function broadcastMobile(payload) {
  for (const socket of mobileSockets) {
    sendJson(socket, payload);
  }
}

function publicTask(task) {
  if (!task) return null;
  return {
    key: task.key,
    deviceId: task.deviceId,
    ticketId: task.ticketId,
    workFolder: task.workFolder,
    state: task.state,
    messages: task.messages,
    artifacts: task.artifacts,
    updatedAt: task.updatedAt,
  };
}

await fastify.register(cors, { origin: true });
await fastify.register(websocket);

fastify.get("/health", async () => ({ ok: true }));

fastify.get("/api/devices", async () => ({
  devices: store.listDevices(),
}));

fastify.get("/api/tasks", async () => ({
  tasks: store.listTasks(),
}));

fastify.get("/api/tasks/:deviceId/:ticketId", async (request, reply) => {
  const { deviceId, ticketId } = request.params;
  const task = store.getTask(deviceId, ticketId);
  if (!task) return reply.code(404).send({ error: "task not found" });
  return { task: publicTask(task) };
});

fastify.post("/api/tasks/:deviceId/:ticketId/commands", async (request, reply) => {
  const { deviceId, ticketId } = request.params;
  const { type, payload } = request.body || {};
  const desktopSocket = desktopSockets.get(deviceId);
  if (!desktopSocket || desktopSocket.readyState !== 1) {
    return reply.code(409).send({ error: "device is offline" });
  }
  if (!["approve", "reject", "message", "sync_task"].includes(type)) {
    return reply.code(400).send({ error: "unsupported command" });
  }

  const command = store.createCommand(deviceId, ticketId, type, payload);
  sendJson(desktopSocket, {
    type: "command.request",
    commandId: command.id,
    ticketId,
    command: type,
    payload: payload || {},
  });
  broadcastMobile({ type: "command.status", command });
  return { command };
});

fastify.get("/ws/desktop", { websocket: true }, (socket) => {
  let deviceId = null;

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === "device.hello") {
      deviceId = String(message.deviceId || "").trim();
      if (!deviceId) return;
      desktopSockets.set(deviceId, socket);
      const device = store.upsertDevice({
        deviceId,
        name: message.name || deviceId,
        status: "online",
        lastSeenAt: new Date().toISOString(),
        meta: message.meta || {},
      });
      sendJson(socket, {
        type: "device.accepted",
        device,
        tasks: store.listTasks().filter((task) => task.deviceId === deviceId),
      });
      broadcastMobile({ type: "device.status", device });
      return;
    }

    if (!deviceId) return;

    if (message.type === "task.snapshot") {
      const task = store.setTaskSnapshot({
        deviceId,
        ticketId: message.ticketId,
        workFolder: message.workFolder,
        state: message.state,
        messages: message.messages,
        artifacts: message.artifacts,
      });
      broadcastMobile({ type: "task.snapshot", task: publicTask(task) });
      return;
    }

    if (message.type === "task.event") {
      const task = store.patchTaskEvent(deviceId, message.ticketId, message.event || {});
      broadcastMobile({
        type: "task.event",
        taskId: task.key,
        deviceId,
        ticketId: message.ticketId,
        event: message.event,
        task: publicTask(task),
      });
      return;
    }

    if (message.type === "command.result") {
      const command = store.resolveCommand(message.commandId, message.status || "ok", message.error || "");
      if (command) {
        broadcastMobile({ type: "command.status", command });
      }
      return;
    }
  });

  socket.on("close", () => {
    if (!deviceId) return;
    desktopSockets.delete(deviceId);
    const device = store.upsertDevice({
      deviceId,
      status: "offline",
      lastSeenAt: new Date().toISOString(),
    });
    broadcastMobile({ type: "device.status", device });
  });
});

fastify.get("/ws/mobile", { websocket: true }, (socket) => {
  mobileSockets.add(socket);
  sendJson(socket, {
    type: "bootstrap",
    devices: store.listDevices(),
    tasks: store.listTasks(),
  });

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === "command.create") {
      const { deviceId, ticketId, command, payload } = message;
      const desktopSocket = desktopSockets.get(deviceId);
      if (!desktopSocket || desktopSocket.readyState !== 1) {
        sendJson(socket, { type: "command.error", error: "device is offline" });
        return;
      }
      const created = store.createCommand(deviceId, ticketId, command, payload);
      sendJson(desktopSocket, {
        type: "command.request",
        commandId: created.id,
        ticketId,
        command,
        payload: payload || {},
      });
      broadcastMobile({ type: "command.status", command: created });
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
