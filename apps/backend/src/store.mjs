import { nanoid } from "nanoid";

function now() {
  return new Date().toISOString();
}

export function createStore() {
  const devices = new Map();
  const tasks = new Map();
  const commands = new Map();

  function upsertDevice(device) {
    const previous = devices.get(device.deviceId) || {};
    const next = {
      deviceId: device.deviceId,
      name: device.name || previous.name || device.deviceId,
      status: device.status || previous.status || "offline",
      lastSeenAt: device.lastSeenAt || now(),
      meta: device.meta || previous.meta || {},
    };
    devices.set(device.deviceId, next);
    return next;
  }

  function listDevices() {
    return Array.from(devices.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function setTaskSnapshot(snapshot) {
    const key = `${snapshot.deviceId}:${snapshot.ticketId}`;
    const previous = tasks.get(key) || {};
    const next = {
      key,
      deviceId: snapshot.deviceId,
      ticketId: snapshot.ticketId,
      workFolder: snapshot.workFolder || previous.workFolder || "",
      state: snapshot.state || previous.state || null,
      messages: snapshot.messages || previous.messages || {},
      artifacts: snapshot.artifacts || previous.artifacts || {},
      updatedAt: now(),
    };
    tasks.set(key, next);
    return next;
  }

  function patchTaskEvent(deviceId, ticketId, event) {
    const key = `${deviceId}:${ticketId}`;
    const current = tasks.get(key) || {
      key,
      deviceId,
      ticketId,
      workFolder: "",
      state: null,
      messages: {},
      artifacts: {},
      updatedAt: now(),
    };

    if (event.type === "state") {
      current.state = event.state;
      current.workFolder = event.state?.originalWorkFolder || event.state?.workFolder || current.workFolder;
    } else if (event.type === "phase_content") {
      current.messages = { ...current.messages, [event.phase]: event.content };
    } else if (event.type === "phase_artifact") {
      current.artifacts = { ...current.artifacts, [event.phase]: event.content };
    } else if (event.type === "user_message") {
      const prev = current.messages?.[event.phase] || "";
      current.messages = {
        ...current.messages,
        [event.phase]: `${prev}\n\n---\n\n**You:** ${event.text}\n\n`,
      };
    }

    current.updatedAt = now();
    tasks.set(key, current);
    return current;
  }

  function listTasks() {
    return Array.from(tasks.values())
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map((task) => ({
        key: task.key,
        deviceId: task.deviceId,
        ticketId: task.ticketId,
        workFolder: task.workFolder,
        state: task.state,
        updatedAt: task.updatedAt,
      }));
  }

  function getTask(deviceId, ticketId) {
    return tasks.get(`${deviceId}:${ticketId}`) || null;
  }

  function createCommand(deviceId, ticketId, type, payload = {}) {
    const command = {
      id: nanoid(),
      deviceId,
      ticketId,
      type,
      payload,
      status: "pending",
      createdAt: now(),
      completedAt: null,
      error: "",
    };
    commands.set(command.id, command);
    return command;
  }

  function resolveCommand(commandId, status, error = "") {
    const command = commands.get(commandId);
    if (!command) return null;
    command.status = status;
    command.error = error;
    command.completedAt = now();
    return command;
  }

  function getCommand(commandId) {
    return commands.get(commandId) || null;
  }

  return {
    upsertDevice,
    listDevices,
    setTaskSnapshot,
    patchTaskEvent,
    listTasks,
    getTask,
    createCommand,
    resolveCommand,
    getCommand,
  };
}
