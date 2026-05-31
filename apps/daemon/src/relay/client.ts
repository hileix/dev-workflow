import WebSocket from "ws";
import { PROTOCOL_VERSION, RELAY_DAEMON_MESSAGE_TYPES } from "@dev-workflow/protocol";
import { bootstrapTasks, buildDeviceMeta } from "./taskSnapshots.ts";
import { handleCommand } from "./commandHandler.ts";
import { createQueryHandler } from "./queryHandler.ts";
import {
  clearRelayServerSocket,
  deviceId,
  deviceName,
  getRelayServerSocket,
  isRelayOpen,
  log,
  metaSyncIntervalMs,
  reconnectDelayMs,
  relayServerUrl,
  sendToRelay,
  setRelayServerSocket,
} from "./state.ts";

let lastMetaSignature = "";
let reconnectTimer = null;
let metaSyncTimer = null;
let started = false;

const handleQuery = createQueryHandler({ syncDeviceMeta });

async function syncDeviceMeta(force = false) {
  if (!isRelayOpen()) return;
  try {
    const meta = await buildDeviceMeta();
    const signature = JSON.stringify(meta);
    if (!force && signature === lastMetaSignature) return;
    lastMetaSignature = signature;
    sendToRelay({
      type: RELAY_DAEMON_MESSAGE_TYPES.daemonHello,
      protocolVersion: PROTOCOL_VERSION,
      deviceId,
      name: deviceName,
      meta,
    });
  } catch (error) {
    log(`failed to sync device meta: ${error.message}`);
  }
}

function connectRelayServer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const socket = new WebSocket(relayServerUrl);
  setRelayServerSocket(socket);

  socket.on("open", async () => {
    lastMetaSignature = "";
    await syncDeviceMeta(true);
    await bootstrapTasks();
  });

  socket.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === RELAY_DAEMON_MESSAGE_TYPES.commandRequest) {
      await handleCommand(message);
      return;
    }

    if (message.type === RELAY_DAEMON_MESSAGE_TYPES.queryRequest) {
      await handleQuery(message);
    }
  });

  socket.on("close", () => {
    if (getRelayServerSocket() !== socket) return;
    lastMetaSignature = "";
    clearRelayServerSocket(socket);
    if (started) {
      reconnectTimer = setTimeout(connectRelayServer, reconnectDelayMs);
    }
  });

  socket.on("error", (error) => {
    log(`relay server ws error: ${error.message}`);
  });
}

export function startDaemonConnection() {
  if (started) return;
  started = true;
  connectRelayServer();
  metaSyncTimer = setInterval(() => {
    syncDeviceMeta().catch((error) => {
      log(`device meta sync interval failed: ${error.message}`);
    });
  }, metaSyncIntervalMs);
}

export function stopDaemonConnection() {
  started = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (metaSyncTimer) {
    clearInterval(metaSyncTimer);
    metaSyncTimer = null;
  }
  const socket = getRelayServerSocket();
  if (socket && socket.readyState <= WebSocket.OPEN) {
    socket.close();
  }
  clearRelayServerSocket(socket);
}
