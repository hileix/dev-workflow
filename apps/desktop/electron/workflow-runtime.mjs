import { mkdir } from "fs/promises";
import { getBaseDir } from "../../../packages/core-models/config.mjs";
import { getPhaseOrder, getRejectTargets, isAutoPhase, nextPhase } from "../../../packages/core-models/workflow.mjs";
import {
  createTaskRunDir,
  readState,
  writeState,
  makeInitialState,
  updatePhaseStatus,
  appendToPhaseFile,
  clearTaskData,
} from "../../../packages/core-models/state.mjs";
import { upsertTask } from "../../../packages/core-models/workfolders.mjs";
import {
  activeWorkflows,
  sendWorkflowEvent,
  runPhase,
  readArtifact,
  getPhaseContent,
  continuePhaseConversation,
} from "../../../packages/core-lib/claude.mjs";
import { getWorkflow, interpolate } from "../../../packages/core-models/workflow.mjs";
import { prepareWorktree, removeWorktree } from "../../../packages/core-lib/worktree.mjs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { nanoid } from "nanoid";

function createEmitter(sender) {
  return (event) => sender(event);
}

async function finalizeWorktreeIfNeeded(state, forceRemove = false) {
  if (!state?.worktree?.enabled) return;
  if (!forceRemove && !state.worktree.removeOnComplete) return;
  await removeWorktree(state.worktree, { force: forceRemove });
}

async function applyCheckpointPublishRules(taskId, phaseId, state) {
  const workflow = getWorkflow();
  const phase = workflow?.phases?.find((item) => item.id === phaseId);
  const publishRules = phase?.checkpoint?.publish || [];
  const contextValues = state?.contextValues || {};
  if (publishRules.length === 0) return;

  for (const rule of publishRules) {
    const sourceInput = (phase.inputs || []).find((input) => input.name === rule.sourceName);
    const targetOutput = (phase.outputs || []).find((output) => output.key === rule.asOutputKey);
    if (!sourceInput || !targetOutput?.filename) continue;

    let content = "";
    if (sourceInput.sourceType === "workflow_context") {
      content = contextValues[sourceInput.name] || "";
    } else if (sourceInput.sourceType === "phase_output") {
      const sourcePhase = workflow.phases.find((item) => item.id === sourceInput.phaseId);
      const sourceOutput = (sourcePhase?.outputs || []).find((output) => output.key === sourceInput.outputKey);
      if (!sourceOutput?.filename) continue;
      try {
        content = await readFile(
          join(await createTaskRunDir(taskId, state.runId), interpolate(sourceOutput.filename, { taskId, runId: state.runId, ...contextValues })),
          "utf-8"
        );
      } catch {
        content = "";
      }
    }

    if (!content) continue;
    await writeFile(
      join(await createTaskRunDir(taskId, state.runId), interpolate(targetOutput.filename, { taskId, runId: state.runId, ...contextValues })),
      content
    );
  }
}

export async function startWorkflowSession(taskId, workFolder, contextValues, images, runId, sender) {
  if (!taskId || !workFolder) throw new Error("taskId and workFolder required");
  if (!getWorkflow() || getPhaseOrder().length === 0) {
    throw new Error("no workflow configured");
  }

  let existingState = null;
  try {
    existingState = await readState(taskId);
  } catch {}

  if (existingState && existingState.overallStatus !== "completed") {
    const phaseSessionIds = {};
    for (const p of existingState.phases) {
      if (p.sessionId) phaseSessionIds[p.id] = p.sessionId;
    }
    activeWorkflows.set(taskId, {
      workFolder: existingState.workFolder,
      send: createEmitter(sender),
      abortController: null,
      phaseSessionIds,
      runId: existingState.runId || "",
    });
    sender({ type: "state", state: existingState });

    for (const p of existingState.phases) {
      const content = await getPhaseContent(taskId, p.id);
      if (content) sender({ type: "phase_content", phase: p.id, content });
      if (p.status !== "pending") {
        const artifact = await readArtifact(taskId, p.id);
        if (artifact) sender({ type: "phase_artifact", phase: p.id, content: artifact });
      }
    }

    const cur = existingState.currentPhase;
    if (cur && isAutoPhase(cur)) {
      const curPhase = existingState.phases.find((p) => p.id === cur);
      if (curPhase && curPhase.status === "in_progress") {
        runPhase(taskId, cur, phaseSessionIds[cur] || null);
      }
    }
    return;
  }

  if (existingState) await clearTaskData(taskId);
  const finalRunId = runId || nanoid();
  const phaseOrder = getPhaseOrder();
  const dir = await createTaskRunDir(taskId, finalRunId);

  const workflow = getWorkflow();
  const preparedWorktree = await prepareWorktree({
    repoRoot: workFolder,
    taskId,
    worktree: workflow.worktree,
  });
  const runtimeWorkFolder = preparedWorktree.workFolder;
  const baseDir = await getBaseDir();
  const state = makeInitialState(taskId, runtimeWorkFolder, baseDir, contextValues, {
    originalWorkFolder: workFolder,
    runId: finalRunId,
    worktree: preparedWorktree.enabled
      ? {
          enabled: true,
          sourceRoot: preparedWorktree.sourceRoot,
          rootPath: preparedWorktree.rootPath,
          branchName: preparedWorktree.branchName,
          migratedFiles: preparedWorktree.migratedFiles,
          skippedFiles: preparedWorktree.skippedFiles,
          removeOnComplete: preparedWorktree.removeOnComplete,
        }
      : null,
  });
  updatePhaseStatus(state, phaseOrder[0], "in_progress");
  await writeState(taskId, state);

  activeWorkflows.set(taskId, {
    workFolder: runtimeWorkFolder,
    send: createEmitter(sender),
    abortController: null,
    phaseSessionIds: {},
    startImages: images || [],
    runId: finalRunId,
  });
  await upsertTask(workFolder, taskId, "in_progress", finalRunId);
  sender({ type: "state", state });
  runPhase(taskId, phaseOrder[0]);
}

export async function approveWorkflow(taskId, sender) {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");

  const state = await readState(taskId);
  const cur = state.currentPhase;
  await applyCheckpointPublishRules(taskId, cur, state);
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
    await finalizeWorktreeIfNeeded(state);
    upsertTask(state.originalWorkFolder || wf.workFolder, taskId, "completed", state.runId || wf.runId || "").catch(() => {});
  }
  await writeState(taskId, state);
  sender({ type: "state", state });

  if (next && isAutoPhase(next)) {
    runPhase(taskId, next);
  }
}

export async function rejectWorkflow(taskId, rejectTo, sender) {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");

  const phaseOrder = getPhaseOrder();
  const rejectTargets = getRejectTargets();
  const state = await readState(taskId);
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
  await writeState(taskId, state);
  sender({ type: "state", state });

  const content = await getPhaseContent(taskId, rejectTo);
  if (content) sender({ type: "phase_content", phase: rejectTo, content });
}

export async function sendWorkflowMessage(taskId, text, images, sender) {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");

  const state = await readState(taskId);
  const phase = state.currentPhase;

  const userBlock = `\n\n---\n\n**You:** ${text}\n\n`;
  await appendToPhaseFile(taskId, phase, userBlock);
  sender({ type: "user_message", phase, text });

  updatePhaseStatus(state, phase, "in_progress");
  state.overallStatus = "in_progress";
  await writeState(taskId, state);
  sender({ type: "state", state });
  wf.send = createEmitter(sender);
  try {
    await continuePhaseConversation(taskId, phase, text, images || []);
    const latestState = await readState(taskId);
    updatePhaseStatus(latestState, phase, "awaiting_input");
    latestState.overallStatus = "awaiting_input";
    await writeState(taskId, latestState);
    sendWorkflowEvent(wf.send, { type: "phase_done", phase });
    sendWorkflowEvent(wf.send, { type: "state", state: latestState });
  } catch (err) {
    if (err?.name === "AbortError") return;
    sendWorkflowEvent(wf.send, { type: "error", message: err.message });
  }
}

export function detachWorkflowSender(taskId) {
  const wf = activeWorkflows.get(taskId);
  if (!wf) return;
  wf.send = null;
  if (wf.abortController) {
    try { wf.abortController.abort(); } catch {}
    wf.abortController = null;
  }
}

export async function cleanupWorkflowWorktree(taskId, options = {}) {
  let state = null;
  try {
    state = await readState(taskId);
  } catch {
    return false;
  }
  await finalizeWorktreeIfNeeded(state, Boolean(options.forceRemove));
  return true;
}
