import { join } from "path";
import { readFile, writeFile, mkdir, appendFile, rm } from "fs/promises";
import { getBaseDir, getWorkfoldersFile } from "./config.mjs";
import { getWorkflow, getPhaseOrder, interpolate } from "./workflow.mjs";

async function resolveTaskRunId(taskId) {
  if (!taskId) return "";
  const baseDir = await getBaseDir();
  const file = getWorkfoldersFile(baseDir);
  try {
    const folders = JSON.parse(await readFile(file, "utf-8"));
    for (const folder of folders || []) {
      for (const task of folder.tasks || []) {
        if (task.taskId === taskId && task.runId) {
          return task.runId;
        }
      }
    }
  } catch {}
  return "";
}

export async function getTaskRunId(taskId) {
  return resolveTaskRunId(taskId);
}

export async function taskDir(taskId) {
  const baseDir = await getBaseDir();
  const runId = await resolveTaskRunId(taskId);
  if (!runId) throw new Error("task not found");
  return join(baseDir, runId);
}

async function stateFilePath(taskId) {
  return join(await taskDir(taskId), "workflow-state.json");
}

async function messagesDir(taskId) {
  return join(await taskDir(taskId), "messages");
}

export async function appendToPhaseFile(taskId, phase, text) {
  if (!taskId || !phase) return;
  const dir = await messagesDir(taskId);
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, `${phase}.md`), text);
}

export async function readPhaseMessages(taskId, phase) {
  try {
    return await readFile(join(await messagesDir(taskId), `${phase}.md`), "utf-8");
  } catch {
    return "";
  }
}

export function makeInitialState(taskId, workFolder, baseDir, contextValues, options = {}) {
  const WORKFLOW = getWorkflow();
  const PHASE_ORDER = getPhaseOrder();
  const now = new Date().toISOString();
  const runId = options.runId || taskId;
  const artifacts = {};
  const vars = { taskId, runId, ...contextValues };
  for (const p of WORKFLOW.phases) {
    const primaryOutput = Array.isArray(p.outputs) ? p.outputs[0] : null;
    if (primaryOutput?.filename) {
      artifacts[p.group] = join(baseDir, runId, interpolate(primaryOutput.filename, vars));
    }
  }
  return {
    taskId,
    runId,
    workFolder,
    originalWorkFolder: options.originalWorkFolder || workFolder,
    worktree: options.worktree || null,
    created: now,
    updated: now,
    currentPhase: PHASE_ORDER[0],
    overallStatus: "in_progress",
    phases: PHASE_ORDER.map((id) => ({ id, status: "pending", updated: null, sessionId: null })),
    artifacts,
    contextValues: contextValues || {},
  };
}

export async function createTaskRunDir(taskId, runId) {
  const baseDir = await getBaseDir();
  await mkdir(join(baseDir, runId), { recursive: true });
  return join(baseDir, runId);
}

export async function readState(taskId) {
  const baseDir = await getBaseDir();
  const runId = await resolveTaskRunId(taskId);
  if (!runId) throw new Error("task not found");
  return JSON.parse(await readFile(join(baseDir, runId, "workflow-state.json"), "utf-8"));
}

export async function writeState(taskId, state) {
  const baseDir = await getBaseDir();
  const runId = state?.runId || await resolveTaskRunId(taskId);
  if (!runId) throw new Error("task not found");
  state.updated = new Date().toISOString();
  await mkdir(join(baseDir, runId), { recursive: true });
  await writeFile(join(baseDir, runId, "workflow-state.json"), JSON.stringify(state, null, 2));
}

export async function clearTaskData(taskId) {
  const baseDir = await getBaseDir();
  const runId = await resolveTaskRunId(taskId);
  if (!runId) return;
  await rm(join(baseDir, runId), { recursive: true, force: true });
}

export function updatePhaseStatus(state, phaseId, status, sessionId) {
  const phase = state.phases.find((p) => p.id === phaseId);
  if (phase) {
    phase.status = status;
    phase.updated = new Date().toISOString();
    if (sessionId !== undefined) phase.sessionId = sessionId;
  }
}
