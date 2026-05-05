import { query } from "@anthropic-ai/claude-agent-sdk";
import { getBaseDir } from "../../../packages/core-models/config.mjs";
import { readManagedSkillContentSync } from "../../../packages/core-models/skills.mjs";
import { getPhaseOrder, getRejectTargets, isAutoPhase } from "../../../packages/core-models/workflow.mjs";
import {
  createTaskRunDir,
  readState,
  writeState,
  makeInitialState,
  updatePhaseStatus,
  appendToPhaseFile,
  appendPhaseInteraction,
  clearTaskData,
} from "../../../packages/core-models/state.mjs";
import { upsertTask } from "../../../packages/core-models/workfolders.mjs";
import {
  activeWorkflows,
  sendWorkflowEvent,
  runPhase,
  readPhaseOutputArtifacts,
  getPhaseContent,
  continuePhaseConversation,
  completePhaseAfterUserTurn,
} from "../../../packages/core-lib/claude.mjs";
import { getWorkflow } from "../../../packages/core-models/workflow.mjs";
import { prepareWorktree, removeWorktree } from "../../../packages/core-lib/worktree.mjs";
import { nanoid } from "nanoid";

const DEFAULT_WORKTREE_NAMING_SKILL = `Choose a concise Git branch name for this workflow run.

Rules:
- Return exactly one name and no explanation.
- Use Conventional Commits style as a branch prefix: feat/, fix/, docs/, refactor/, test/, chore/, perf/, ci/, build/, or style/.
- Use lowercase kebab-case after the prefix.
- Keep it under 48 characters when practical.
- Prefer the task intent over generic words.`;

function createEmitter(sender) {
  return (event) => sender(event);
}

function cleanGeneratedWorktreeName(value) {
  return String(value || "")
    .trim()
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^["']|["']$/g, "") || "";
}

async function generateWorktreeName({ taskId, workFolder, contextValues, workflow }) {
  const skill = readManagedSkillContentSync("worktree-naming") || DEFAULT_WORKTREE_NAMING_SKILL;
  const context = [
    `Task ID: ${taskId}`,
    `Workflow: ${workflow?.name || ""}`,
    `Work folder: ${workFolder}`,
    `Task context: ${JSON.stringify(contextValues || {})}`,
  ].join("\n");

  const prompt = `${skill}\n\n${context}`;
  try {
    let name = "";
    for await (const message of query({
      prompt,
      options: {
        cwd: workFolder,
        permissionMode: "default",
        maxTurns: 1,
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        name = cleanGeneratedWorktreeName(message.result);
      }
    }
    return name;
  } catch {
    return "";
  }
}

async function finalizeWorktreeIfNeeded(state, forceRemove = false) {
  if (!state?.worktree?.enabled) return;
  if (!forceRemove && !state.worktree.removeOnComplete) return;
  await removeWorktree(state.worktree, { force: forceRemove });
}

export async function startWorkflowSession(taskId, workFolder, contextValues, images, runId, sender, options = {}) {
  if (!taskId || !workFolder) throw new Error("taskId and workFolder required");
  if (!getWorkflow() || getPhaseOrder().length === 0) {
    throw new Error("no workflow configured");
  }

  let existingState = null;
  try {
    existingState = await readState(taskId, runId || "");
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
      const content = await getPhaseContent(taskId, p.id, existingState.runId || "");
      if (content) sender({ type: "phase_content", phase: p.id, content });
      if (p.status !== "pending") {
        const outputArtifacts = await readPhaseOutputArtifacts(taskId, p.id, existingState.runId || "");
        for (const [outputKey, outputContent] of Object.entries(outputArtifacts)) {
          sender({ type: "phase_artifact", phase: p.id, outputKey, content: outputContent });
        }
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

  if (existingState) await clearTaskData(taskId, runId || existingState.runId || "");
  const finalRunId = runId || nanoid();
  const phaseOrder = getPhaseOrder();
  await createTaskRunDir(taskId, finalRunId);

  const workflow = getWorkflow();
  sender({ type: "workflow_starting", taskId, runId: finalRunId });
  const requestedWorktreeName = String(options?.worktreeName || "").trim();
  if (workflow.worktree?.enabled && !requestedWorktreeName) {
    sender({ type: "worktree_naming_started" });
  }
  const worktreeName = workflow.worktree?.enabled
    ? requestedWorktreeName || await generateWorktreeName({ taskId, workFolder, contextValues, workflow })
    : "";
  if (workflow.worktree?.enabled && !requestedWorktreeName) {
    sender({ type: "worktree_naming_completed", name: worktreeName });
  }
  if (workflow.worktree?.enabled) {
    sender({ type: "worktree_preparing", name: worktreeName });
  }
  const preparedWorktree = await prepareWorktree({
    repoRoot: workFolder,
    taskId,
    worktree: workflow.worktree,
    worktreeName,
  });
  if (preparedWorktree.enabled) {
    sender({
      type: "worktree_ready",
      branchName: preparedWorktree.branchName,
      rootPath: preparedWorktree.rootPath,
    });
  }
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
  sender({ type: "phase_initializing", phase: phaseOrder[0] });
  runPhase(taskId, phaseOrder[0]);
}

export async function approveWorkflow(taskId, sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");

  const state = await readState(taskId, runId || wf.runId || "");
  const cur = state.currentPhase;
  if (isAutoPhase(cur)) throw new Error(`cannot approve auto phase ${cur}`);
  wf.send = createEmitter(sender);
  await completePhaseAfterUserTurn(taskId, cur, state.runId || runId || wf.runId || "");
}

export async function rejectWorkflow(taskId, rejectTo, sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");

  const phaseOrder = getPhaseOrder();
  const rejectTargets = getRejectTargets();
  const state = await readState(taskId, runId || wf.runId || "");
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

  const content = await getPhaseContent(taskId, rejectTo, state.runId || runId || wf.runId || "");
  if (content) sender({ type: "phase_content", phase: rejectTo, content });
}

export async function sendWorkflowMessage(taskId, text, images, sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");

  const state = await readState(taskId, runId || wf.runId || "");
  const phase = state.currentPhase;
  const stateRunId = state.runId || runId || wf.runId || "";

  const userBlock = `\n\n---\n\n**You:** ${text}\n\n`;
  await appendToPhaseFile(taskId, phase, userBlock, stateRunId);
  const interaction = await appendPhaseInteraction(taskId, phase, {
    role: "user",
    type: "user_message",
    text,
    imageCount: images?.length || 0,
  }, stateRunId);
  if (interaction) sender({ type: "phase_interaction", phase, interaction });
  sender({ type: "user_message", phase, text });

  updatePhaseStatus(state, phase, "in_progress");
  state.overallStatus = "in_progress";
  await writeState(taskId, state);
  sender({ type: "state", state });
  wf.send = createEmitter(sender);
  wf.runId = stateRunId;
  try {
    await continuePhaseConversation(taskId, phase, text, images || [], { mode: "phase_revision" });
    await completePhaseAfterUserTurn(taskId, phase, stateRunId);
    sendWorkflowEvent(wf.send, { type: "phase_done", phase });
  } catch (err) {
    if (err?.name === "AbortError") return;
    sendWorkflowEvent(wf.send, { type: "error", message: err.message });
  }
}

export async function restartWorkflowPhase(taskId, phase, sender, runId = "") {
  if (!taskId || !phase) throw new Error("taskId and phase required");
  if (!isAutoPhase(phase)) throw new Error(`cannot restart manual phase ${phase}`);

  const existing = activeWorkflows.get(taskId);
  const state = await readState(taskId, runId || existing?.runId || "");
  if (state.currentPhase !== phase) {
    throw new Error(`cannot restart ${phase} while current phase is ${state.currentPhase}`);
  }

  const phaseSessionIds = {};
  for (const p of state.phases) {
    if (p.sessionId) phaseSessionIds[p.id] = p.sessionId;
  }

  if (existing?.abortController) {
    try { existing.abortController.abort(); } catch {}
  }

  activeWorkflows.set(taskId, {
    ...existing,
    workFolder: existing?.workFolder || state.workFolder,
    send: createEmitter(sender),
    abortController: null,
    phaseSessionIds,
    runId: state.runId || existing?.runId || "",
  });

  updatePhaseStatus(state, phase, "in_progress", null);
  state.overallStatus = "in_progress";
  await writeState(taskId, state);
  sender({ type: "state", state });
  sender({ type: "phase_restarted", phase });
  runPhase(taskId, phase);
}

export async function pauseWorkflowPhase(taskId, phase, sender, runId = "") {
  if (!taskId || !phase) throw new Error("taskId and phase required");

  const wf = activeWorkflows.get(taskId);
  const state = await readState(taskId, runId || wf?.runId || "");
  if (state.currentPhase !== phase) {
    throw new Error(`cannot pause ${phase} while current phase is ${state.currentPhase}`);
  }

  if (wf) {
    wf.send = createEmitter(sender);
    if (wf.abortController) {
      try { wf.abortController.abort(); } catch {}
      wf.abortController = null;
    }
  }

  updatePhaseStatus(state, phase, "awaiting_input");
  state.overallStatus = "awaiting_input";
  await writeState(taskId, state);
  upsertTask(state.originalWorkFolder || state.workFolder, taskId, "awaiting_input", state.runId || "", { create: false }).catch(() => {});
  sender({ type: "phase_paused", phase });
  sender({ type: "state", state });
}

export function detachWorkflowSender(taskId, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) return;
  if (runId && wf.runId && wf.runId !== runId) return;
  wf.send = null;
  if (wf.abortController) {
    try { wf.abortController.abort(); } catch {}
    wf.abortController = null;
  }
}

export async function cleanupWorkflowWorktree(taskId, options = {}) {
  let state = null;
  try {
    state = await readState(taskId, options.runId || "");
  } catch {
    return false;
  }
  await finalizeWorktreeIfNeeded(state, Boolean(options.forceRemove));
  return true;
}
