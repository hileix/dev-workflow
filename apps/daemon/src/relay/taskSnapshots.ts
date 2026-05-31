import { basename } from "path";
import { PROTOCOL_VERSION, RELAY_DAEMON_MESSAGE_TYPES } from "@dev-workflow/protocol";
import { getWorkflowConfig } from "../services/settingsService";
import { listWorkflows as listWorkflowDefinitions } from "../services/workflowService";
import { listWorkFolders } from "../services/workfolderService";
import { getTaskState, saveTaskUploads as saveTaskUploadFiles } from "../services/taskService";
import {
  defaultWorkFolder,
  deviceId,
  isRelayOpen,
  knownTasks,
  log,
  sendToRelay,
} from "./state.ts";

export async function buildDeviceMeta() {
  const [workflowConfig, workflows, workFolders] = await Promise.all([
    getWorkflowConfig().catch(() => null),
    listWorkflowDefinitions().then((data) => data.workflows || []).catch(() => []),
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
    workflowConfig,
    workflows,
    workFolders: mappedWorkFolders,
  };
}

async function loadTaskState(taskId, runId = "") {
  return getTaskState(taskId, runId);
}

export async function saveTaskUploads(runId, images) {
  if (!runId || !Array.isArray(images) || images.length === 0) return [];
  const data = await saveTaskUploadFiles(runId, images);
  return Array.isArray(data.paths) ? data.paths : [];
}

export async function normalizeImagePayload(runId, images) {
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

export function buildTaskSnapshot(taskId, data, fallbackWorkFolder = "", runId = "") {
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
    outputArtifacts: data?.outputArtifacts || {},
    interactions: data?.interactions || {},
    updatedAt: state?.updated || new Date().toISOString(),
  };
}

export async function getTaskSnapshot(taskId, fallbackWorkFolder = "", runId = "") {
  const data = await loadTaskState(taskId, runId);
  return buildTaskSnapshot(taskId, data, fallbackWorkFolder, runId);
}

export async function listTaskSnapshots() {
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

export async function pushTaskSnapshot(taskId) {
  if (!isRelayOpen()) return;
  try {
    const task = await getTaskSnapshot(taskId);
    knownTasks.set(taskId, { workFolder: task.workFolder, runId: task.runId });
    sendToRelay({
      type: RELAY_DAEMON_MESSAGE_TYPES.taskSnapshot,
      protocolVersion: PROTOCOL_VERSION,
      taskId,
      task,
    });
  } catch (error) {
    log(`failed to push snapshot for ${taskId}: ${error.message}`);
  }
}

export async function bootstrapTasks() {
  const folders = await listWorkFolders().catch(() => []);
  for (const folder of folders) {
    for (const task of folder.tasks || []) {
      knownTasks.set(task.taskId, { workFolder: folder.path, runId: task.runId || "" });
      await pushTaskSnapshot(task.taskId);
    }
  }
}

function shouldPushTaskSnapshot(event) {
  return event?.type === "state"
    || event?.type === "phase_content"
    || event?.type === "phase_artifact"
    || event?.type === "user_message"
    || event?.type === "phase_interaction";
}

export function createRelayTaskSender(taskId, fallbackWorkFolder = "", fallbackRunId = "") {
  return (event = {}) => {
    if (event.type === "state" && event.state) {
      knownTasks.set(taskId, {
        workFolder: event.state.originalWorkFolder || event.state.workFolder || fallbackWorkFolder,
        runId: event.state.runId || fallbackRunId || "",
      });
    }

    sendToRelay({
      type: RELAY_DAEMON_MESSAGE_TYPES.taskEvent,
      protocolVersion: PROTOCOL_VERSION,
      taskId,
      event,
    });

    if (shouldPushTaskSnapshot(event)) {
      pushTaskSnapshot(taskId).catch((error) => {
        log(`failed to push snapshot for ${taskId}: ${error.message}`);
      });
    }
  };
}
