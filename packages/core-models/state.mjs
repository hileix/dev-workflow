import { join } from "path";
import { readFile, writeFile, mkdir, appendFile, rm } from "fs/promises";
import { getBaseDir } from "./config.mjs";
import { getWorkflow, getPhaseOrder, interpolate } from "./workflow.mjs";

export async function taskDir(taskId) {
  const baseDir = await getBaseDir();
  return join(baseDir, taskId);
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
  const artifacts = {};
  const vars = { taskId, ...contextValues };
  for (const p of WORKFLOW.phases) {
    const primaryOutput = Array.isArray(p.outputs) ? p.outputs[0] : null;
    if (primaryOutput?.filename) {
      artifacts[p.group] = join(baseDir, taskId, interpolate(primaryOutput.filename, vars));
    }
  }
  return {
    taskId,
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

export async function readState(taskId) {
  return JSON.parse(await readFile(await stateFilePath(taskId), "utf-8"));
}

export async function writeState(taskId, state) {
  state.updated = new Date().toISOString();
  await writeFile(await stateFilePath(taskId), JSON.stringify(state, null, 2));
}

export async function clearTaskData(taskId) {
  const dir = await messagesDir(taskId);
  await rm(dir, { recursive: true, force: true });
}

export function updatePhaseStatus(state, phaseId, status, sessionId) {
  const phase = state.phases.find((p) => p.id === phaseId);
  if (phase) {
    phase.status = status;
    phase.updated = new Date().toISOString();
    if (sessionId !== undefined) phase.sessionId = sessionId;
  }
}
