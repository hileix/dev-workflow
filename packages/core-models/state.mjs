import { join } from "path";
import { readFile, writeFile, mkdir, appendFile, rm, rename } from "fs/promises";
import { getBaseDir, getWorkfoldersFile } from "./config.mjs";
import { getWorkflow, getWorkflowConfigShape, getWorkflowStepOrder, interpolate } from "./workflow.mjs";

export function assertSafeRunId(runId) {
  const value = String(runId || "").trim();
  if (!value) return "";
  if (value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error("invalid runId");
  }
  return value;
}

async function resolveTaskRunId(taskId, requestedRunId = "") {
  const safeRequestedRunId = assertSafeRunId(requestedRunId);
  if (safeRequestedRunId) return safeRequestedRunId;
  if (!taskId) return "";
  const baseDir = await getBaseDir();
  const file = getWorkfoldersFile(baseDir);
  try {
    const folders = JSON.parse(await readFile(file, "utf-8"));
    for (const folder of folders || []) {
      for (const task of folder.tasks || []) {
        const storedTaskId = task.taskId || task.ticketId;
        if (storedTaskId === taskId) {
          return assertSafeRunId(task.runId || storedTaskId);
        }
      }
    }
  } catch {}
  return "";
}

export async function getTaskRunId(taskId, runId = "") {
  return resolveTaskRunId(taskId, runId);
}

export async function taskDir(taskId, runId = "") {
  const baseDir = await getBaseDir();
  const resolvedRunId = await resolveTaskRunId(taskId, runId);
  if (!resolvedRunId) throw new Error("task not found");
  return join(baseDir, resolvedRunId);
}

async function stateFilePath(taskId) {
  return join(await taskDir(taskId), "workflow-state.json");
}

async function messagesDir(taskId, runId = "") {
  return join(await taskDir(taskId, runId), "messages");
}

async function interactionsDir(taskId, runId = "") {
  return join(await taskDir(taskId, runId), "interactions");
}

export async function appendToPhaseFile(taskId, phase, text, runId = "") {
  if (!taskId || !phase) return;
  const dir = await messagesDir(taskId, runId);
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, `${phase}.md`), text);
}

export async function appendPhaseInteraction(taskId, phase, interaction, runId = "") {
  if (!taskId || !phase || !interaction) return null;
  const dir = await interactionsDir(taskId, runId);
  await mkdir(dir, { recursive: true });
  const entry = {
    id: interaction.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: interaction.at || new Date().toISOString(),
    phase,
    ...interaction,
  };
  await appendFile(join(dir, `${phase}.jsonl`), `${JSON.stringify(entry)}\n`);
  return entry;
}

export async function readPhaseMessages(taskId, phase, runId = "") {
  try {
    return await readFile(join(await messagesDir(taskId, runId), `${phase}.md`), "utf-8");
  } catch {
    return "";
  }
}

export async function readPhaseInteractions(taskId, phase, runId = "") {
  try {
    const raw = await readFile(join(await interactionsDir(taskId, runId), `${phase}.jsonl`), "utf-8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function makeInitialState(taskId, workFolder, baseDir, contextValues, options = {}) {
  const WORKFLOW = options.workflow || getWorkflow();
  const PHASE_ORDER = getWorkflowStepOrder(WORKFLOW);
  const now = new Date().toISOString();
  const runId = options.runId || taskId;
  const artifacts = {};
  const vars = { taskId, runId, ...contextValues };
  for (const p of WORKFLOW.steps) {
    const primaryOutput = Array.isArray(p.outputs) ? p.outputs[0] : null;
    if (primaryOutput?.filename) {
      artifacts[p.id] = join(baseDir, runId, interpolate(primaryOutput.filename, vars));
    }
  }
  return {
    taskId,
    runId,
    workFolder,
    originalWorkFolder: options.originalWorkFolder || workFolder,
    worktree: options.worktree || null,
    workflowFilename: options.workflowFilename || "",
    workflowDefinition: WORKFLOW,
    workflowConfig: options.workflowConfig || getWorkflowConfigShape(WORKFLOW),
    created: now,
    updated: now,
    currentPhase: PHASE_ORDER[0],
    currentStep: PHASE_ORDER[0],
    overallStatus: "in_progress",
    phases: PHASE_ORDER.map((id) => ({ id, status: "pending", updated: null, sessionId: null })),
    steps: PHASE_ORDER.map((id) => ({ id, status: "pending", updated: null, sessionId: null })),
    artifacts,
    contextValues: contextValues || {},
    sessionMap: {},
    stepOutputs: {},
    stepArtifacts: {},
    stepDecisions: {},
    pendingMessages: {},
    logs: [],
  };
}

export async function createTaskRunDir(taskId, runId) {
  const baseDir = await getBaseDir();
  const safeRunId = assertSafeRunId(runId);
  await mkdir(join(baseDir, safeRunId), { recursive: true });
  return join(baseDir, safeRunId);
}

export async function readState(taskId, runId = "") {
  const baseDir = await getBaseDir();
  const resolvedRunId = await resolveTaskRunId(taskId, runId);
  if (!resolvedRunId) throw new Error("task not found");
  const state = JSON.parse(await readFile(join(baseDir, resolvedRunId, "workflow-state.json"), "utf-8"));
  if (state.taskId && state.taskId !== taskId) throw new Error("task not found");
  return state;
}

export async function writeState(taskId, state) {
  const baseDir = await getBaseDir();
  const runId = assertSafeRunId(state?.runId || await resolveTaskRunId(taskId));
  if (!runId) throw new Error("task not found");
  state.updated = new Date().toISOString();
  const dir = join(baseDir, runId);
  const target = join(dir, "workflow-state.json");
  const tmp = join(dir, `.workflow-state.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  await mkdir(dir, { recursive: true });
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, target);
}

export async function clearTaskData(taskId, runId = "") {
  const baseDir = await getBaseDir();
  const resolvedRunId = await resolveTaskRunId(taskId, runId);
  if (!resolvedRunId) return;
  await rm(join(baseDir, resolvedRunId), { recursive: true, force: true });
}

export function updatePhaseStatus(state, phaseId, status, sessionId) {
  const phase = state.phases.find((p) => p.id === phaseId);
  if (phase) {
    phase.status = status;
    phase.updated = new Date().toISOString();
    if (sessionId !== undefined) phase.sessionId = sessionId;
  }
  if (Array.isArray(state.steps)) {
    const step = state.steps.find((p) => p.id === phaseId);
    if (step) {
      step.status = status;
      step.updated = new Date().toISOString();
      if (sessionId !== undefined) step.sessionId = sessionId;
    }
  }
}
