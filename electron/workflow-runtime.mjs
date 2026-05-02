import { mkdir } from "fs/promises";
import { getBaseDir } from "../models/config.mjs";
import { getPhaseOrder, getRejectTargets, isAutoPhase, nextPhase } from "../models/workflow.mjs";
import {
  taskDir,
  readState,
  writeState,
  makeInitialState,
  updatePhaseStatus,
  appendToPhaseFile,
  clearTaskData,
} from "../models/state.mjs";
import { upsertTask } from "../models/workfolders.mjs";
import {
  activeWorkflows,
  sendWorkflowEvent,
  runPhase,
  readArtifact,
  getPhaseContent,
  continuePhaseConversation,
} from "../lib/claude.mjs";

function createEmitter(sender) {
  return (event) => sender(event);
}

export async function startWorkflowSession(ticketId, workFolder, promptValues, images, sender) {
  if (!ticketId || !workFolder) throw new Error("ticketId and workFolder required");

  let existingState = null;
  try {
    existingState = await readState(ticketId);
  } catch {}

  if (existingState && existingState.overallStatus !== "completed") {
    const phaseSessionIds = {};
    for (const p of existingState.phases) {
      if (p.sessionId) phaseSessionIds[p.id] = p.sessionId;
    }
    activeWorkflows.set(ticketId, {
      workFolder: existingState.workFolder,
      send: createEmitter(sender),
      abortController: null,
      phaseSessionIds,
    });
    sender({ type: "state", state: existingState });

    for (const p of existingState.phases) {
      const content = await getPhaseContent(ticketId, p.id);
      if (content) sender({ type: "phase_content", phase: p.id, content });
      if (p.status !== "pending") {
        const artifact = await readArtifact(ticketId, p.id);
        if (artifact) sender({ type: "phase_artifact", phase: p.id, content: artifact });
      }
    }

    const cur = existingState.currentPhase;
    if (cur && isAutoPhase(cur)) {
      const curPhase = existingState.phases.find((p) => p.id === cur);
      if (curPhase && curPhase.status === "in_progress") {
        runPhase(ticketId, cur, phaseSessionIds[cur] || null);
      }
    }
    return;
  }

  if (existingState) await clearTaskData(ticketId);
  const phaseOrder = getPhaseOrder();
  const dir = await taskDir(ticketId);
  await mkdir(dir, { recursive: true });

  const baseDir = await getBaseDir();
  const state = makeInitialState(ticketId, workFolder, baseDir, promptValues);
  updatePhaseStatus(state, phaseOrder[0], "in_progress");
  await writeState(ticketId, state);

  activeWorkflows.set(ticketId, {
    workFolder,
    send: createEmitter(sender),
    abortController: null,
    phaseSessionIds: {},
    startImages: images || [],
  });
  await upsertTask(workFolder, ticketId, "in_progress");
  sender({ type: "state", state });
  runPhase(ticketId, phaseOrder[0]);
}

export async function approveWorkflow(ticketId, sender) {
  const wf = activeWorkflows.get(ticketId);
  if (!wf) throw new Error("workflow not found");

  const state = await readState(ticketId);
  const cur = state.currentPhase;
  updatePhaseStatus(state, cur, "completed");
  const next = nextPhase(cur);
  if (next) {
    state.currentPhase = next;
    if (isAutoPhase(next)) {
      updatePhaseStatus(state, next, "in_progress");
      state.overallStatus = "in_progress";
    } else {
      updatePhaseStatus(state, next, "awaiting_input");
      state.overallStatus = "awaiting_input";
    }
  } else {
    state.overallStatus = "completed";
    state.currentPhase = "completed";
    upsertTask(wf.workFolder, ticketId, "completed").catch(() => {});
  }
  await writeState(ticketId, state);
  sender({ type: "state", state });

  if (next && isAutoPhase(next)) {
    runPhase(ticketId, next);
  }
}

export async function rejectWorkflow(ticketId, rejectTo, sender) {
  const wf = activeWorkflows.get(ticketId);
  if (!wf) throw new Error("workflow not found");

  const phaseOrder = getPhaseOrder();
  const rejectTargets = getRejectTargets();
  const state = await readState(ticketId);
  const cur = state.currentPhase;
  const allowed = rejectTargets[cur];
  if (!allowed || !allowed.includes(rejectTo)) {
    throw new Error(`cannot reject from ${cur} to ${rejectTo}`);
  }

  const targetIdx = phaseOrder.indexOf(rejectTo);
  for (let i = targetIdx; i < phaseOrder.length; i++) {
    const pid = phaseOrder[i];
    updatePhaseStatus(state, pid, pid === rejectTo ? "awaiting_input" : "pending");
  }
  state.currentPhase = rejectTo;
  state.overallStatus = "awaiting_input";
  await writeState(ticketId, state);
  sender({ type: "state", state });

  const content = await getPhaseContent(ticketId, rejectTo);
  if (content) sender({ type: "phase_content", phase: rejectTo, content });
}

export async function sendWorkflowMessage(ticketId, text, images, sender) {
  const wf = activeWorkflows.get(ticketId);
  if (!wf) throw new Error("workflow not found");

  const state = await readState(ticketId);
  const phase = state.currentPhase;

  const userBlock = `\n\n---\n\n**You:** ${text}\n\n`;
  await appendToPhaseFile(ticketId, phase, userBlock);
  sender({ type: "user_message", phase, text });

  updatePhaseStatus(state, phase, "in_progress");
  state.overallStatus = "in_progress";
  await writeState(ticketId, state);
  sender({ type: "state", state });
  wf.send = createEmitter(sender);
  try {
    await continuePhaseConversation(ticketId, phase, text, images || []);
    const latestState = await readState(ticketId);
    updatePhaseStatus(latestState, phase, "awaiting_input");
    latestState.overallStatus = "awaiting_input";
    await writeState(ticketId, latestState);
    sendWorkflowEvent(wf.send, { type: "phase_done", phase });
    sendWorkflowEvent(wf.send, { type: "state", state: latestState });
  } catch (err) {
    if (err?.name === "AbortError") return;
    sendWorkflowEvent(wf.send, { type: "error", message: err.message });
  }
}

export function detachWorkflowSender(ticketId) {
  const wf = activeWorkflows.get(ticketId);
  if (!wf) return;
  wf.send = null;
  if (wf.abortController) {
    try { wf.abortController.abort(); } catch {}
    wf.abortController = null;
  }
}
