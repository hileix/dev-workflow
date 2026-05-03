import WebSocket from "ws";

const backendUrl = process.env.CLOUD_BACKEND_WS_URL || "ws://127.0.0.1:8787/ws/desktop";
const localWsUrl = process.env.LOCAL_WORKFLOW_WS_URL || "ws://127.0.0.1:3000/ws";
const localApiBase = process.env.LOCAL_WORKFLOW_API_BASE || "http://127.0.0.1:3000/api";
const deviceId = process.env.DEVICE_ID || "desktop-local";
const deviceName = process.env.DEVICE_NAME || "Desktop Local";
const defaultWorkFolder = process.env.DEFAULT_WORK_FOLDER || "";

let backendSocket = null;
const localTaskSockets = new Map();
const knownTasks = new Map();

function log(message, extra) {
  if (extra !== undefined) {
    console.log(`[connector] ${message}`, extra);
    return;
  }
  console.log(`[connector] ${message}`);
}

function sendJson(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json",
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `request failed: ${response.status}`);
  }
  return data;
}

async function listWorkFolders() {
  return fetchJson(`${localApiBase}/workfolders`);
}

async function loadTaskState(ticketId) {
  return fetchJson(`${localApiBase}/tasks/${ticketId}/state`);
}

async function pushTaskSnapshot(ticketId) {
  if (!backendSocket || backendSocket.readyState !== WebSocket.OPEN) return;
  try {
    const data = await loadTaskState(ticketId);
    const workFolder = data.state?.originalWorkFolder || data.state?.workFolder || "";
    knownTasks.set(ticketId, { workFolder });
    sendJson(backendSocket, {
      type: "task.snapshot",
      ticketId,
      workFolder,
      state: data.state,
      messages: data.messages || {},
      artifacts: data.artifacts || {},
    });
  } catch (error) {
    log(`failed to push snapshot for ${ticketId}: ${error.message}`);
  }
}

async function bootstrapTasks() {
  const folders = await listWorkFolders().catch(() => []);
  for (const folder of folders) {
    for (const task of folder.tasks || []) {
      knownTasks.set(task.ticketId, { workFolder: folder.path });
      await pushTaskSnapshot(task.ticketId);
    }
  }
}

function attachLocalTask(ticketId, workFolder) {
  const existing = localTaskSockets.get(ticketId);
  if (existing && existing.readyState === WebSocket.OPEN) return existing;

  const socket = new WebSocket(localWsUrl);
  localTaskSockets.set(ticketId, socket);
  knownTasks.set(ticketId, { workFolder });

  socket.on("open", () => {
    sendJson(socket, {
      type: "start",
      ticketId,
      workFolder,
      promptValues: {},
    });
  });

  socket.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === "state" && message.state) {
      knownTasks.set(ticketId, {
        workFolder: message.state.originalWorkFolder || message.state.workFolder || workFolder,
      });
    }

    sendJson(backendSocket, {
      type: "task.event",
      ticketId,
      event: message,
    });

    if (message.type === "state" || message.type === "phase_content" || message.type === "phase_artifact") {
      await pushTaskSnapshot(ticketId);
    }
  });

  socket.on("close", () => {
    localTaskSockets.delete(ticketId);
  });

  socket.on("error", (error) => {
    log(`local ws error for ${ticketId}: ${error.message}`);
  });

  return socket;
}

async function handleCommand(message) {
  const { commandId, ticketId, command, payload } = message;
  const taskInfo = knownTasks.get(ticketId);
  const workFolder = payload?.workFolder || taskInfo?.workFolder || defaultWorkFolder;

  if (!workFolder) {
    sendJson(backendSocket, {
      type: "command.result",
      commandId,
      status: "error",
      error: "workFolder is required to attach task",
    });
    return;
  }

  const socket = attachLocalTask(ticketId, workFolder);
  const sendResult = (status, error = "") => {
    sendJson(backendSocket, {
      type: "command.result",
      commandId,
      status,
      error,
    });
  };

  const onOpen = () => {
    try {
      if (command === "approve") {
        sendJson(socket, { type: "approve", ticketId });
      } else if (command === "reject") {
        sendJson(socket, { type: "reject", ticketId, rejectTo: payload?.rejectTo });
      } else if (command === "message") {
        sendJson(socket, { type: "message", ticketId, text: payload?.text || "", images: payload?.images || [] });
      } else if (command === "sync_task") {
        pushTaskSnapshot(ticketId).then(() => sendResult("ok")).catch((error) => sendResult("error", error.message));
        return;
      } else {
        sendResult("error", "unsupported command");
        return;
      }
      sendResult("ok");
    } catch (error) {
      sendResult("error", error.message);
    }
  };

  if (socket.readyState === WebSocket.OPEN) {
    onOpen();
    return;
  }

  if (socket.readyState === WebSocket.CONNECTING) {
    socket.once("open", onOpen);
    return;
  }

  sendResult("error", "local workflow socket unavailable");
}

function connectBackend() {
  backendSocket = new WebSocket(backendUrl);

  backendSocket.on("open", async () => {
    sendJson(backendSocket, {
      type: "device.hello",
      deviceId,
      name: deviceName,
      meta: {
        localApiBase,
      },
    });
    await bootstrapTasks();
  });

  backendSocket.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === "command.request") {
      await handleCommand(message);
    }
  });

  backendSocket.on("close", () => {
    setTimeout(connectBackend, 1500);
  });

  backendSocket.on("error", (error) => {
    log(`backend ws error: ${error.message}`);
  });
}

connectBackend();
