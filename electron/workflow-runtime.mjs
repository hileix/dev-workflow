import { spawn } from "child_process";
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
  formatToolLog,
  runPhase,
  readArtifact,
  getPhaseContent,
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
      child: null,
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
    child: null,
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
  const priorSessionId = wf.phaseSessionIds[phase] || null;

  const userBlock = `\n\n---\n\n**You:** ${text}\n\n`;
  await appendToPhaseFile(ticketId, phase, userBlock);
  sender({ type: "user_message", phase, text });

  const args = [
    "-p", text,
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--dangerously-skip-permissions",
  ];
  if (images && images.length > 0) {
    for (const imgPath of images) args.push("--file", imgPath);
  }
  if (priorSessionId) args.push("--resume", priorSessionId);

  updatePhaseStatus(state, phase, "in_progress");
  state.overallStatus = "in_progress";
  await writeState(ticketId, state);
  sender({ type: "state", state });

  const child = spawn(process.env.CLAUDE_PATH || "claude", args, {
    cwd: wf.workFolder,
    stdio: ["ignore", "pipe", "pipe"],
  });
  wf.child = child;
  wf.send = createEmitter(sender);

  let buffer = "";
  let currentTool = null;
  let toolInputJson = "";

  function processLine(line) {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event.type === "stream_event") {
        const inner = event.event;
        if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta") {
          const delta = inner.delta.text;
          sendWorkflowEvent(wf.send, { type: "text_delta", phase, text: delta });
          appendToPhaseFile(ticketId, phase, delta);
        } else if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use") {
          currentTool = inner.content_block.name;
          toolInputJson = "";
        } else if (inner.type === "content_block_delta" && inner.delta?.type === "input_json_delta") {
          toolInputJson += inner.delta.partial_json;
        } else if (inner.type === "content_block_stop" && currentTool) {
          const log = formatToolLog(currentTool, toolInputJson);
          const logMsg = `\n\n*${log}*\n\n`;
          sendWorkflowEvent(wf.send, { type: "tool_use", phase, name: currentTool, log });
          appendToPhaseFile(ticketId, phase, logMsg);
          currentTool = null;
          toolInputJson = "";
        }
      } else if (event.type === "result") {
        wf.phaseSessionIds[phase] = event.session_id;
      }
    } catch {}
  }

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) processLine(line);
  });
  child.stderr.on("data", () => {});
  child.on("close", async () => {
    if (buffer.trim()) processLine(buffer);
    wf.child = null;
    try {
      const latestState = await readState(ticketId);
      sendWorkflowEvent(wf.send, { type: "phase_done", phase });
      sendWorkflowEvent(wf.send, { type: "state", state: latestState });
    } catch {}
  });
}

export function detachWorkflowSender(ticketId) {
  const wf = activeWorkflows.get(ticketId);
  if (!wf) return;
  wf.send = null;
  if (wf.child) {
    wf.child.kill();
    wf.child = null;
  }
}
