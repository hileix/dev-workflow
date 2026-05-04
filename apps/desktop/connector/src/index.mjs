import { basename } from "path";
import WebSocket from "ws";
import { readMobileAccessEnabled } from "../../../../packages/core-models/config.mjs";

const backendUrl = process.env.CLOUD_BACKEND_WS_URL || "ws://127.0.0.1:8787/ws/desktop";
const localWsUrl = process.env.LOCAL_WORKFLOW_WS_URL || "ws://127.0.0.1:3000/ws";
const localApiBase = process.env.LOCAL_WORKFLOW_API_BASE || "http://127.0.0.1:3000/api";
const deviceId = process.env.DEVICE_ID || "desktop-local";
const deviceName = process.env.DEVICE_NAME || "Desktop Local";
const defaultWorkFolder = process.env.DEFAULT_WORK_FOLDER || "";

let backendSocket = null;
const localTaskSockets = new Map();
const knownTasks = new Map();
let lastMetaSignature = "";

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

async function loadWorkflowConfig() {
  return fetchJson(`${localApiBase}/workflow`);
}

async function listWorkflows() {
  const data = await fetchJson(`${localApiBase}/workflows`);
  return data.workflows || [];
}

async function activateWorkflow(filename) {
  return fetchJson(`${localApiBase}/workflows/${filename}/activate`, {
    method: "PUT",
  });
}

async function isMobileAccessEnabled() {
  return readMobileAccessEnabled().catch(() => false);
}

async function buildDeviceMeta() {
  const mobileAccessEnabled = await isMobileAccessEnabled();
  if (!mobileAccessEnabled) {
    return {
      localApiBase,
      mobileAccessEnabled: false,
      workflowConfig: null,
      workflows: [],
      workFolders: [],
    };
  }

  const [workflowConfig, workflows, workFolders] = await Promise.all([
    loadWorkflowConfig().catch(() => null),
    listWorkflows().catch(() => []),
    listWorkFolders().catch(() => []),
  ]);

  const mappedWorkFolders = workFolders.map((folder) => ({
    name: folder.name,
    path: folder.path,
  }));
  if (defaultWorkFolder && !mappedWorkFolders.some((folder) => folder.path === defaultWorkFolder)) {
    mappedWorkFolders.unshift({
      name: basename(defaultWorkFolder) || "Default Work Folder",
      path: defaultWorkFolder,
    });
  }

  return {
    localApiBase,
    mobileAccessEnabled: true,
    workflowConfig,
    workflows,
    workFolders: mappedWorkFolders,
  };
}

async function loadTaskState(taskId) {
  return fetchJson(`${localApiBase}/tasks/${taskId}/state`);
}

async function saveTaskUploads(runId, images) {
  if (!runId || !Array.isArray(images) || images.length === 0) return [];
  const form = new FormData();
  let count = 0;
  for (const image of images) {
    if (!image || typeof image !== "object" || !image.name || !image.data) continue;
    form.append(
      "images",
      new Blob([Buffer.from(image.data)], {
        type: image.type || "application/octet-stream",
      }),
      image.name
    );
    count += 1;
  }
  if (count === 0) return [];
  const response = await fetch(`${localApiBase}/tasks/${runId}/upload`, {
    method: "POST",
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `request failed: ${response.status}`);
  }
  return Array.isArray(data.paths) ? data.paths : [];
}

async function normalizeImagePayload(runId, images) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const paths = [];
  const uploads = [];
  for (const image of images) {
    if (typeof image === "string" && image.trim()) {
      paths.push(image.trim());
      continue;
    }
    if (image && typeof image === "object" && image.name && image.data) {
      uploads.push(image);
    }
  }
  if (uploads.length === 0) return paths;
  return [...paths, ...(await saveTaskUploads(runId, uploads))];
}

function buildTaskSnapshot(taskId, data, fallbackWorkFolder = "", runId = "") {
  const state = data?.state || null;
  const workFolder =
    state?.originalWorkFolder ||
    state?.workFolder ||
    fallbackWorkFolder ||
    knownTasks.get(taskId)?.workFolder ||
    "";
  return {
    key: `${deviceId}:${taskId}`,
    deviceId,
    taskId,
    runId: state?.runId || runId || "",
    workFolder,
    state,
    messages: data?.messages || {},
    artifacts: data?.artifacts || {},
    interactions: data?.interactions || {},
    updatedAt: state?.updated || new Date().toISOString(),
  };
}

async function getTaskSnapshot(taskId, fallbackWorkFolder = "", runId = "") {
  const data = await loadTaskState(taskId);
  return buildTaskSnapshot(taskId, data, fallbackWorkFolder, runId);
}

async function listTaskSnapshots() {
  if (!(await isMobileAccessEnabled())) return [];
  const folders = await listWorkFolders().catch(() => []);
  const tasks = [];
  for (const folder of folders) {
    for (const task of folder.tasks || []) {
      try {
        const snapshot = await getTaskSnapshot(task.taskId, folder.path, task.runId || "");
        knownTasks.set(task.taskId, { workFolder: snapshot.workFolder, runId: snapshot.runId });
        tasks.push(snapshot);
      } catch (error) {
        log(`failed to load task ${task.taskId}: ${error.message}`);
      }
    }
  }
  return tasks.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

async function pushTaskSnapshot(taskId) {
  if (!(await isMobileAccessEnabled())) return;
  if (!backendSocket || backendSocket.readyState !== WebSocket.OPEN) return;
  try {
    const task = await getTaskSnapshot(taskId);
    knownTasks.set(taskId, { workFolder: task.workFolder, runId: task.runId });
    sendJson(backendSocket, {
      type: "task.snapshot",
      taskId,
      task,
    });
  } catch (error) {
    log(`failed to push snapshot for ${taskId}: ${error.message}`);
  }
}

async function bootstrapTasks() {
  if (!(await isMobileAccessEnabled())) return;
  const folders = await listWorkFolders().catch(() => []);
  for (const folder of folders) {
    for (const task of folder.tasks || []) {
      knownTasks.set(task.taskId, { workFolder: folder.path, runId: task.runId || "" });
      await pushTaskSnapshot(task.taskId);
    }
  }
}

function attachLocalTask(taskId, workFolder, options = {}) {
  const existing = localTaskSockets.get(taskId);
  if (existing && existing.readyState === WebSocket.OPEN) return existing;

  const socket = new WebSocket(localWsUrl);
  localTaskSockets.set(taskId, socket);
  knownTasks.set(taskId, { workFolder });

  socket.on("open", () => {
    sendJson(socket, {
      type: "start",
      taskId,
      workFolder,
      contextValues: options.contextValues || {},
      images: options.images || [],
      runId: options.runId || "",
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
      knownTasks.set(taskId, {
        workFolder: message.state.originalWorkFolder || message.state.workFolder || workFolder,
      });
    }

    if (!(await isMobileAccessEnabled())) return;

    sendJson(backendSocket, {
      type: "task.event",
      taskId,
      event: message,
    });

    if (
      message.type === "state" ||
      message.type === "phase_content" ||
      message.type === "phase_artifact" ||
      message.type === "user_message"
    ) {
      await pushTaskSnapshot(taskId);
    }
  });

  socket.on("close", () => {
    localTaskSockets.delete(taskId);
  });

  socket.on("error", (error) => {
    log(`local ws error for ${taskId}: ${error.message}`);
  });

  return socket;
}

async function handleCommand(message) {
  const { commandId, taskId, command, payload } = message;
  const taskInfo = knownTasks.get(taskId);
  const workFolder = payload?.workFolder || taskInfo?.workFolder || defaultWorkFolder;

  const sendResult = (status, error = "") => {
    sendJson(backendSocket, {
      type: "command.result",
      commandId,
      status,
      error,
    });
  };

  if (!(await isMobileAccessEnabled())) {
    sendResult("error", "mobile access is disabled");
    return;
  }

  if (command === "start_workflow") {
    if (!taskId || !workFolder) {
      sendResult("error", "taskId and workFolder are required");
      return;
    }
    try {
      const workflowFilename = String(payload?.workflowFilename || "").trim();
      const runId = String(payload?.runId || knownTasks.get(taskId)?.runId || "").trim() || `run-${Date.now()}`;
      const imagePaths = await normalizeImagePayload(runId, payload?.images || []);
      if (workflowFilename) {
        await activateWorkflow(workflowFilename);
      }
      const socket = attachLocalTask(taskId, workFolder, {
        contextValues: payload?.contextValues || {},
        images: imagePaths,
        runId,
      });
      if (socket.readyState === WebSocket.OPEN) {
        sendResult("ok");
        return;
      }
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.once("open", () => sendResult("ok"));
        return;
      }
      sendResult("error", "local workflow socket unavailable");
    } catch (error) {
      sendResult("error", error.message);
    }
    return;
  }

  if (command === "delete_task") {
    if (!taskId) {
      sendResult("error", "taskId is required");
      return;
    }
    try {
      await fetchJson(`${localApiBase}/tasks/${taskId}`, {
        method: "DELETE",
      });
      knownTasks.delete(taskId);
      const existingSocket = localTaskSockets.get(taskId);
      if (existingSocket && existingSocket.readyState <= WebSocket.OPEN) {
        existingSocket.close();
      }
      sendJson(backendSocket, {
        type: "task.removed",
        taskId,
      });
      sendResult("ok");
    } catch (error) {
      sendResult("error", error.message);
    }
    return;
  }

  if (!workFolder) {
    sendResult("error", "workFolder is required to attach task");
    return;
  }

  const socket = attachLocalTask(taskId, workFolder);

  const onOpen = async () => {
    try {
      if (command === "approve") {
        sendJson(socket, { type: "approve", taskId });
      } else if (command === "reject") {
        sendJson(socket, { type: "reject", taskId, rejectTo: payload?.rejectTo });
      } else if (command === "message") {
        const imagePaths = await normalizeImagePayload(taskId, payload?.images || []);
        sendJson(socket, {
          type: "message",
          taskId,
          text: payload?.text || "",
          images: imagePaths,
        });
      } else if (command === "sync_task") {
        pushTaskSnapshot(taskId).then(() => sendResult("ok")).catch((error) => sendResult("error", error.message));
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
    await onOpen();
    return;
  }

  if (socket.readyState === WebSocket.CONNECTING) {
    socket.once("open", () => {
      onOpen().catch((error) => sendResult("error", error.message));
    });
    return;
  }

  sendResult("error", "local workflow socket unavailable");
}

async function handleQuery(message) {
  const { requestId, action, payload } = message;
  const reply = (ok, data = {}, error = "") => {
    sendJson(backendSocket, {
      type: "query.response",
      requestId,
      ok,
      data,
      error,
    });
  };

  try {
    if (action === "list_tasks") {
      reply(true, { tasks: await listTaskSnapshots() });
      return;
    }

    if (action === "get_task") {
      if (!(await isMobileAccessEnabled())) {
        reply(true, { task: null });
        return;
      }
      const taskId = String(payload?.taskId || "").trim();
      if (!taskId) {
        reply(false, {}, "taskId is required");
        return;
      }
      const taskInfo = knownTasks.get(taskId);
      try {
        const task = await getTaskSnapshot(taskId, taskInfo?.workFolder || "");
        reply(true, { task });
      } catch (error) {
        if (error.message === "task not found") {
          reply(true, { task: null });
          return;
        }
        throw error;
      }
      return;
    }

    reply(false, {}, "unsupported query");
  } catch (error) {
    reply(false, {}, error.message);
  }
}

async function syncDeviceMeta(force = false) {
  if (!backendSocket || backendSocket.readyState !== WebSocket.OPEN) return;
  try {
    const meta = await buildDeviceMeta();
    const signature = JSON.stringify(meta);
    if (!force && signature === lastMetaSignature) return;
    lastMetaSignature = signature;
    sendJson(backendSocket, {
      type: "device.hello",
      deviceId,
      name: deviceName,
      meta,
    });
  } catch (error) {
    log(`failed to sync device meta: ${error.message}`);
  }
}

function connectBackend() {
  backendSocket = new WebSocket(backendUrl);

  backendSocket.on("open", async () => {
    lastMetaSignature = "";
    await syncDeviceMeta(true);
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
      return;
    }

    if (message.type === "query.request") {
      await handleQuery(message);
    }
  });

  backendSocket.on("close", () => {
    lastMetaSignature = "";
    setTimeout(connectBackend, 1500);
  });

  backendSocket.on("error", (error) => {
    log(`backend ws error: ${error.message}`);
  });
}

connectBackend();
setInterval(() => {
  syncDeviceMeta().catch((error) => {
    log(`device meta sync interval failed: ${error.message}`);
  });
}, 2000);
