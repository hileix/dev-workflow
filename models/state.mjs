import { join } from "path";
import { readFile, writeFile, mkdir, appendFile, rm } from "fs/promises";
import { getBaseDir } from "./config.mjs";
import { getWorkflow, getPhaseOrder, interpolate } from "./workflow.mjs";

export async function taskDir(ticketId) {
  const baseDir = await getBaseDir();
  return join(baseDir, ticketId);
}

async function stateFilePath(ticketId) {
  return join(await taskDir(ticketId), "workflow-state.json");
}

async function messagesDir(ticketId) {
  return join(await taskDir(ticketId), "messages");
}

export async function appendToPhaseFile(ticketId, phase, text) {
  if (!ticketId || !phase) return;
  const dir = await messagesDir(ticketId);
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, `${phase}.md`), text);
}

export async function readPhaseMessages(ticketId, phase) {
  try {
    return await readFile(join(await messagesDir(ticketId), `${phase}.md`), "utf-8");
  } catch {
    return "";
  }
}

export function makeInitialState(ticketId, workFolder, baseDir, promptValues) {
  const WORKFLOW = getWorkflow();
  const PHASE_ORDER = getPhaseOrder();
  const now = new Date().toISOString();
  const artifacts = {};
  const vars = { ticketId, ...promptValues };
  for (const p of WORKFLOW.phases) {
    if (p.artifact) {
      artifacts[p.group] = join(baseDir, ticketId, interpolate(p.artifact, vars));
    }
  }
  return {
    ticketId,
    workFolder,
    created: now,
    updated: now,
    currentPhase: PHASE_ORDER[0],
    overallStatus: "in_progress",
    phases: PHASE_ORDER.map((id) => ({ id, status: "pending", updated: null, sessionId: null })),
    artifacts,
    promptValues: promptValues || {},
  };
}

export async function readState(ticketId) {
  return JSON.parse(await readFile(await stateFilePath(ticketId), "utf-8"));
}

export async function writeState(ticketId, state) {
  state.updated = new Date().toISOString();
  await writeFile(await stateFilePath(ticketId), JSON.stringify(state, null, 2));
}

export async function clearTaskData(ticketId) {
  const dir = await messagesDir(ticketId);
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
