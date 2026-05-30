import WebSocket from "ws";
import { RELAY_WS_PATHS } from "@dev-workflow/protocol";

export const relayServerUrl = process.env.RELAY_SERVER_WS_URL
  || process.env.CLOUD_BACKEND_WS_URL
  || `ws://127.0.0.1:8787${RELAY_WS_PATHS.daemon}`;
export const deviceId = process.env.DEVICE_ID || "local-daemon";
export const deviceName = process.env.DEVICE_NAME || "Local Daemon";
export const defaultWorkFolder = process.env.DEFAULT_WORK_FOLDER || "";
export const reconnectDelayMs = Number(process.env.DAEMON_RECONNECT_DELAY_MS || 1500);
export const metaSyncIntervalMs = Number(process.env.DAEMON_META_SYNC_INTERVAL_MS || 2000);

export const knownTasks = new Map();

let relayServerSocket = null;

export function log(message, extra = undefined) {
  if (extra !== undefined) {
    console.log(`[daemon] ${message}`, extra);
    return;
  }
  console.log(`[daemon] ${message}`);
}

export function getRelayServerSocket() {
  return relayServerSocket;
}

export function setRelayServerSocket(socket) {
  relayServerSocket = socket;
}

export function clearRelayServerSocket(socket = null) {
  if (!socket || relayServerSocket === socket) {
    relayServerSocket = null;
  }
}

export function isRelayOpen() {
  return relayServerSocket?.readyState === WebSocket.OPEN;
}

export function sendJson(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

export function sendToRelay(payload) {
  sendJson(relayServerSocket, payload);
}
