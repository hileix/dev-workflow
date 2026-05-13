import { join } from "path";
import { readFile } from "fs/promises";
import { getWorkflow, interpolate } from "../core-models/workflow";
import { readState, readPhaseMessages, taskDir } from "../core-models/state";

export const AI_BACKENDS = {
  CLAUDE: "claude",
  CODEX: "codex",
};

export const SUPPORTED_AI_BACKENDS = [AI_BACKENDS.CLAUDE, AI_BACKENDS.CODEX];
export const DEFAULT_AI_BACKEND = AI_BACKENDS.CLAUDE;
export const activeWorkflows = new Map();

export function normalizeAiBackend(value) {
  return SUPPORTED_AI_BACKENDS.includes(value) ? value : DEFAULT_AI_BACKEND;
}

export function sendWorkflowEvent(send, data) {
  if (!send) return;
  try {
    send(data);
  } catch {}
}

export function wsSend(ws, data) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(data));
  } catch {}
}

export function killAllChildren() {
  for (const [, wf] of activeWorkflows) {
    if (wf.abortController) {
      try { wf.abortController.abort(); } catch {}
      wf.abortController = null;
    }
  }
}

export function stopActiveWorkflow(taskId, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) return;
  if (runId && wf.runId && wf.runId !== runId) return;
  if (wf.abortController) {
    try { wf.abortController.abort(); } catch {}
    wf.abortController = null;
  }
  activeWorkflows.delete(taskId);
}

function getWorkflowForState(state) {
  return state?.workflowDefinition || getWorkflow();
}

function getStepById(stepId, workflow = getWorkflow()) {
  return workflow?.steps?.find((item) => item.id === stepId) || null;
}

function getOutputByKey(step, outputKey) {
  return (step?.outputs || []).find((output) => output.key === outputKey) || null;
}

async function readArtifactFile(taskId, filename, taskInputs = {}, runId = "") {
  if (!filename) return "";
  const resolved = interpolate(filename, { taskId, runId, ...taskInputs });
  try {
    return await readFile(join(await taskDir(taskId, runId), resolved), "utf-8");
  } catch {
    return "";
  }
}

async function resolveArtifactPath(taskId, filename, taskInputs = {}, runId = "") {
  if (!filename) return "";
  const resolved = interpolate(filename, { taskId, runId, ...taskInputs });
  return join(await taskDir(taskId, runId), resolved);
}

export async function readPhaseOutputArtifact(taskId, stepId, outputKey, runId = "") {
  const state = await readState(taskId, runId).catch(() => null);
  const stepOutput = state?.stepOutputs?.[stepId]?.outputs?.[outputKey] || null;
  const artifactPath = stepOutput?.artifactPath || "";
  if (artifactPath) {
    try {
      return await readFile(artifactPath, "utf-8");
    } catch {}
  }
  const step = getStepById(stepId, getWorkflowForState(state));
  const output = getOutputByKey(step, outputKey);
  if (!output?.filename) return "";
  return readArtifactFile(taskId, output.filename, state?.taskInputs || {}, state?.runId || runId);
}

export async function readPhaseOutputArtifacts(taskId, stepId, runId = "") {
  const state = await readState(taskId, runId).catch(() => null);
  const step = getStepById(stepId, getWorkflowForState(state));
  const result = {};
  for (const output of step?.outputs || []) {
    if (!output?.key || !output.filename) continue;
    const content = await readPhaseOutputArtifact(taskId, stepId, output.key, runId);
    if (content) result[output.key] = content;
  }
  return result;
}

export async function getPhaseOutputArtifactPath(taskId, stepId, outputKey, runId = "") {
  const state = await readState(taskId, runId).catch(() => null);
  const stepOutput = state?.stepOutputs?.[stepId]?.outputs?.[outputKey] || null;
  if (stepOutput?.artifactPath) return stepOutput.artifactPath;
  const step = getStepById(stepId, getWorkflowForState(state));
  const output = getOutputByKey(step, outputKey);
  if (!output?.filename) return "";
  return resolveArtifactPath(taskId, output.filename, state?.taskInputs || {}, state?.runId || runId);
}

export async function getPhaseContent(taskId, stepId, runId = "") {
  let stateRunId = runId;
  if (stateRunId) {
    const state = await readState(taskId, stateRunId).catch(() => null);
    if (!state) return "";
    stateRunId = state.runId || stateRunId;
  }
  return readPhaseMessages(taskId, stepId, stateRunId);
}
