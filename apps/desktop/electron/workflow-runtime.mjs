import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import { join } from "path";
import { getBaseDir, getWorkflowDir, readAiBackendOverrideSync } from "../../../packages/core-models/config.mjs";
import { readManagedSkillContentSync } from "../../../packages/core-models/skills.mjs";
import { getActiveWorkflowFile, getPhaseOrder, getRejectTargets, getWorkflow, getWorkflowConfigShape, isAutoPhase, loadWorkflow, setActiveWorkflowFile } from "../../../packages/core-models/workflow.mjs";
import {
  appendPhaseInteraction,
  appendToPhaseFile,
  clearTaskData,
  createTaskRunDir,
  makeInitialState,
  readState,
  updatePhaseStatus,
  writeState,
  taskDir,
} from "../../../packages/core-models/state.mjs";
import { upsertTask } from "../../../packages/core-models/workfolders.mjs";
import { activeWorkflows, getPhaseContent, normalizeAiBackend, readPhaseOutputArtifacts, stopActiveWorkflow } from "../../../packages/core-lib/claude.mjs";
import { prepareWorktree, removeWorktree } from "../../../packages/core-lib/worktree.mjs";
import { buildWorkflowGraphFromDsl, createAppSdkAgentAdapter, createMemoryCheckpointer, createSdkAgentAdapter } from "../../../packages/core-lib/langgraph-runtime/index.mjs";
import { nanoid } from "nanoid";

const DEFAULT_WORKTREE_NAMING_SKILL = `Choose a concise Git branch name for this workflow run.

Rules:
- Return exactly one name and no explanation.
- Use Conventional Commits style as a branch prefix: feat/, fix/, docs/, refactor/, test/, chore/, perf/, ci/, build/, or style/.
- Use lowercase kebab-case after the prefix.
- Keep it under 48 characters when practical.
- Prefer the task intent over generic words.
- If the task is not English, translate the intent into a short English slug.
- Do not return generic names like chore/task or task.`;

const graphCheckpointer = createMemoryCheckpointer();
const activeGraphs = new Map();

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

function addUniqueToken(tokens, value) {
  const token = String(value || "").trim();
  if (token && !tokens.includes(token)) tokens.push(token);
}

function buildLocalWorktreeNameFallback(taskId, contextValues = {}) {
  const text = [
    taskId,
    ...Object.values(contextValues || {}).filter((value) => typeof value === "string"),
  ].join(" ").toLowerCase();
  const tokens = [];
  let prefix = "chore";

  if (/bug|fix|error|issue|修复|错误|问题/.test(text)) prefix = "fix";
  else if (/docs?|readme|文档/.test(text)) prefix = "docs";
  else if (/test|测试/.test(text)) prefix = "test";
  else if (/refactor|重构/.test(text)) prefix = "refactor";
  else if (/style|css|color|background|颜色|色|背景|样式/.test(text)) prefix = "style";
  else if (/add|create|implement|新增|添加|实现/.test(text)) prefix = "feat";

  if (/change|update|modify|set|修改|更改|设置/.test(text)) addUniqueToken(tokens, "update");
  if (/add|create|implement|新增|添加|实现/.test(text)) addUniqueToken(tokens, "add");
  if (/home\s*page|homepage|首页|主页/.test(text)) addUniqueToken(tokens, "homepage");
  if (/background\s*color|背景色/.test(text)) addUniqueToken(tokens, "background");
  if (/background|背景/.test(text)) addUniqueToken(tokens, "background");
  if (/red|红色|变红/.test(text)) addUniqueToken(tokens, "red");
  if (/blue|蓝色/.test(text)) addUniqueToken(tokens, "blue");
  if (/green|绿色/.test(text)) addUniqueToken(tokens, "green");
  if (/black|黑色/.test(text)) addUniqueToken(tokens, "black");
  if (/white|白色/.test(text)) addUniqueToken(tokens, "white");

  const asciiWords = text.match(/[a-z0-9]+/g) || [];
  for (const word of asciiWords) {
    if (tokens.length >= 6) break;
    if (["the", "a", "an", "to", "of", "for", "and", "task", "please"].includes(word)) continue;
    addUniqueToken(tokens, word);
  }

  if (tokens.length === 0) return "";
  return `${prefix}/${tokens.slice(0, 6).join("-")}`;
}

function isGenericWorktreeName(value) {
  const cleaned = cleanGeneratedWorktreeName(value)
    .toLowerCase()
    .replace(/\\/g, "/");
  const suffix = cleaned.split("/").filter(Boolean).pop() || "";
  return !suffix || /^(task|todo|work|change|update)(-\d+)?$/.test(suffix);
}

function getThreadId(taskId, runId) {
  return `${taskId}:${runId}`;
}

function getStepType(stepId) {
  const step = getWorkflow()?.steps?.find((item) => item.id === stepId);
  return step?.type || "";
}

function createGraphConfig(taskId, runId) {
  return {
    configurable: {
      thread_id: getThreadId(taskId, runId),
    },
  };
}

function syncStateShape(langState, currentState) {
  const next = {
    ...currentState,
    currentPhase: langState.currentStep || currentState.currentPhase,
    currentStep: langState.currentStep || currentState.currentStep,
    overallStatus: langState.overallStatus || currentState.overallStatus,
    sessionMap: langState.sessionMap || currentState.sessionMap || {},
    stepOutputs: langState.stepOutputs || currentState.stepOutputs || {},
    stepArtifacts: langState.stepArtifacts || currentState.stepArtifacts || {},
    stepDecisions: langState.stepDecisions || currentState.stepDecisions || {},
    pendingMessages: langState.pendingMessages || currentState.pendingMessages || {},
    logs: langState.logs || currentState.logs || [],
  };

  for (const phase of next.phases || []) {
    const sessionKey = phase.id;
    const sessionId = next.sessionMap?.[sessionKey] || phase.sessionId;
    if (sessionId) phase.sessionId = sessionId;
  }

  return next;
}

function setRunningStep(state, stepId) {
  if (!stepId || stepId === "completed") return;
  for (const phase of state.phases || []) {
    if (phase.id === stepId) {
      phase.status = getStepType(stepId) === "checkpoint" ? "awaiting_input" : "in_progress";
    } else if (phase.status === "in_progress") {
      phase.status = "completed";
    }
  }
  for (const step of state.steps || []) {
    const phase = state.phases.find((item) => item.id === step.id);
    if (phase) Object.assign(step, phase);
  }
}

function markCompletedBeforeCurrent(state) {
  const order = getPhaseOrder();
  const currentIndex = order.indexOf(state.currentPhase);
  for (let i = 0; i < order.length; i += 1) {
    const phaseId = order[i];
    const phase = state.phases.find((item) => item.id === phaseId);
    if (!phase) continue;
    if (state.overallStatus === "completed" || (currentIndex >= 0 && i < currentIndex)) {
      phase.status = "completed";
    }
  }
}

async function persistLangGraphState(taskId, runId, langState) {
  const state = await readState(taskId, runId);
  const next = syncStateShape(langState, state);

  if (isInterrupted(langState)) {
    const interruptValue = langState[INTERRUPT]?.[0]?.value;
    const stepId = interruptValue?.stepId || next.currentPhase;
    next.currentPhase = stepId;
    next.currentStep = stepId;
    next.overallStatus = "awaiting_input";
    updatePhaseStatus(next, stepId, "awaiting_input");
  } else if (next.overallStatus === "completed") {
    next.currentPhase = "completed";
    next.currentStep = "completed";
    for (const phase of next.phases) updatePhaseStatus(next, phase.id, "completed", phase.sessionId);
  } else {
    setRunningStep(next, next.currentPhase);
    markCompletedBeforeCurrent(next);
  }

  await writeState(taskId, next);
  return next;
}

async function generateWorktreeName({ taskId, workFolder, contextValues, workflow }) {
  const skill = readManagedSkillContentSync("worktree-naming") || DEFAULT_WORKTREE_NAMING_SKILL;
  const backend = normalizeAiBackend(readAiBackendOverrideSync());
  const localFallback = buildLocalWorktreeNameFallback(taskId, contextValues);
  const context = [
    `Task ID: ${taskId}`,
    `Workflow: ${workflow?.name || ""}`,
    `Work folder: ${workFolder}`,
    `Task context: ${JSON.stringify(contextValues || {})}`,
    localFallback ? `Fallback name if needed: ${localFallback}` : "",
  ].join("\n");

  const prompt = `${skill}

Additional rules:
- If the task is written in Chinese or another non-English language, translate the intent into a short English slug.
- Do not return generic names like chore/task, chore/update, or task.
- Prefer the fallback name only if it accurately describes the task.

${context}`;
  try {
    const adapter = createSdkAgentAdapter({
      workFolder,
      taskDir: workFolder,
      readSkillContentSync: readManagedSkillContentSync,
    });
    const result = await adapter.runAgent({
      step: {
        id: "worktree-naming",
        instructions: prompt,
        workspaceAccess: "read",
      },
      agent: {
        backend,
        workspaceAccess: "read",
        options: backend === "claude" ? { maxTurns: 1 } : {},
      },
      state: {
        taskId,
        runId: "",
        workFolder,
        taskDir: workFolder,
        contextValues,
      },
      sessionId: "",
      sessionKey: "worktree-naming",
    });
    const name = cleanGeneratedWorktreeName(result.content);
    return isGenericWorktreeName(name) ? localFallback : name || localFallback;
  } catch {
    return localFallback;
  }
}

async function finalizeWorktreeIfNeeded(state, forceRemove = false) {
  if (!state?.worktree?.enabled) return;
  if (!forceRemove && !state.worktree.removeOnComplete) return;
  await removeWorktree(state.worktree, { force: forceRemove });
}

async function emitExistingTaskFiles(taskId, state, send) {
  for (const p of state.phases) {
    const content = await getPhaseContent(taskId, p.id, state.runId || "");
    if (content) send({ type: "phase_content", phase: p.id, content });
    if (p.status !== "pending") {
      const outputArtifacts = await readPhaseOutputArtifacts(taskId, p.id, state.runId || "");
      for (const [outputKey, outputContent] of Object.entries(outputArtifacts)) {
        send({ type: "phase_artifact", phase: p.id, outputKey, content: outputContent });
      }
    }
  }
}

function createGraph(taskId, runId, wf, imagePaths = []) {
  const taskRunAbortController = new AbortController();
  wf.abortController = taskRunAbortController;
  const aiBackendOverride = readAiBackendOverrideSync();
  const adapter = createAppSdkAgentAdapter({
    taskId,
    runId,
    send: (message) => wf.send?.(message),
    workFolder: wf.workFolder,
    taskRunDir: wf.taskRunDir,
    imagePaths,
    abortController: taskRunAbortController,
    aiBackendOverride,
  });
  return buildWorkflowGraphFromDsl(getWorkflow(), adapter, { checkpointer: graphCheckpointer });
}

function getOrCreateGraph(taskId, runId, wf) {
  const threadId = getThreadId(taskId, runId);
  let graph = activeGraphs.get(threadId);
  if (!graph) {
    graph = createGraph(taskId, runId, wf);
    activeGraphs.set(threadId, graph);
  }
  return graph;
}

async function invokeGraph(taskId, runId, input) {
  const wf = activeWorkflows.get(taskId);
  if (!wf) return null;

  const graph = getOrCreateGraph(taskId, runId, wf);

  const result = await graph.invoke(input, createGraphConfig(taskId, runId));
  const state = await persistLangGraphState(taskId, runId, result);
  wf.send({ type: "state", state });

  if (isInterrupted(result)) return state;
  if (state.overallStatus === "completed") {
    await finalizeWorktreeIfNeeded(state);
    await upsertTask(state.originalWorkFolder || state.workFolder, taskId, "completed", state.runId || runId, { create: false });
  }
  return state;
}

async function ensureCheckpointReady(taskId, runId, state) {
  if (getStepType(state.currentStep || state.currentPhase) !== "checkpoint") return;

  const wf = activeWorkflows.get(taskId);
  if (!wf) return;
  const graph = getOrCreateGraph(taskId, runId, wf);
  const checkpoint = graph?.getState
    ? await graph.getState(createGraphConfig(taskId, runId)).catch(() => null)
    : null;
  const hasInterrupt = Array.isArray(checkpoint?.tasks)
    && checkpoint.tasks.some((task) => Array.isArray(task.interrupts) && task.interrupts.length > 0);
  if (hasInterrupt) return;

  const result = await graph.invoke(new Command({
    update: {
      ...state,
      currentStep: state.currentStep || state.currentPhase,
      overallStatus: "awaiting_input",
    },
    goto: state.currentStep || state.currentPhase,
  }), createGraphConfig(taskId, runId));
  await persistLangGraphState(taskId, runId, result);
}

export async function startWorkflowSession(taskId, workFolder, contextValues, images, runId, sender, options = {}) {
  if (!taskId || !workFolder) throw new Error("taskId and workFolder required");
  const workflowFilename = String(options?.workflowFilename || "").trim();
  if (workflowFilename) {
    if (!workflowFilename.endsWith(".json")) throw new Error("invalid workflow filename");
    loadWorkflow(join(getWorkflowDir(), workflowFilename));
    setActiveWorkflowFile(workflowFilename);
  }
  if (!getWorkflow() || getPhaseOrder().length === 0) throw new Error("no workflow configured");

  let existingState = null;
  try {
    existingState = await readState(taskId, runId || "");
  } catch {}

  if (existingState && existingState.overallStatus !== "completed") {
    activeWorkflows.set(taskId, {
      workFolder: existingState.workFolder,
      taskRunDir: await taskDir(taskId, existingState.runId || runId || ""),
      send: createEmitter(sender),
      abortController: null,
      runId: existingState.runId || runId || "",
    });
    sender({ type: "state", state: existingState });
    await emitExistingTaskFiles(taskId, existingState, createEmitter(sender));
    return;
  }

  if (existingState) await clearTaskData(taskId, runId || existingState.runId || "");
  const finalRunId = runId || nanoid();
  await createTaskRunDir(taskId, finalRunId);

  const workflow = getWorkflow();
  const activeWorkflowFile = getActiveWorkflowFile();
  sender({ type: "workflow_starting", taskId, runId: finalRunId });
  const requestedWorktreeName = String(options?.worktreeName || "").trim();
  if (workflow.worktree?.enabled && !requestedWorktreeName) sender({ type: "worktree_naming_started" });
  const worktreeName = workflow.worktree?.enabled
    ? requestedWorktreeName || await generateWorktreeName({ taskId, workFolder, contextValues, workflow })
    : "";
  if (workflow.worktree?.enabled && !requestedWorktreeName) sender({ type: "worktree_naming_completed", name: worktreeName });
  if (workflow.worktree?.enabled) sender({ type: "worktree_preparing", name: worktreeName });
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
    workflowFilename: activeWorkflowFile,
    workflowConfig: getWorkflowConfigShape(workflow),
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
  updatePhaseStatus(state, getPhaseOrder()[0], "in_progress");
  await writeState(taskId, state);

  const taskRunDir = await taskDir(taskId, finalRunId);
  activeWorkflows.set(taskId, {
    workFolder: runtimeWorkFolder,
    taskRunDir,
    send: createEmitter(sender),
    abortController: null,
    runId: finalRunId,
  });
  await upsertTask(workFolder, taskId, "in_progress", finalRunId);
  sender({ type: "state", state });

  const graph = createGraph(taskId, finalRunId, activeWorkflows.get(taskId), images || []);
  activeGraphs.set(getThreadId(taskId, finalRunId), graph);
  await invokeGraph(taskId, finalRunId, {
    taskId,
    runId: finalRunId,
    workFolder: runtimeWorkFolder,
    taskDir: taskRunDir,
    currentStep: getPhaseOrder()[0],
    overallStatus: "in_progress",
    contextValues: contextValues || {},
  });
}

export async function approveWorkflow(taskId, sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");
  wf.send = createEmitter(sender);
  const state = await readState(taskId, runId || wf.runId || "");
  const stateRunId = state.runId || runId || wf.runId || "";
  await ensureCheckpointReady(taskId, stateRunId, state);
  await invokeGraph(taskId, stateRunId, new Command({
    resume: {
      approved: true,
      notes: "Approved by user.",
    },
  }));
}

export async function rejectWorkflow(taskId, rejectTo, reason = "", sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");
  const state = await readState(taskId, runId || wf.runId || "");
  const cur = state.currentPhase;
  const allowed = getRejectTargets()[cur];
  if (!allowed || !allowed.includes(rejectTo)) throw new Error(`cannot reject from ${cur} to ${rejectTo}`);
  wf.send = createEmitter(sender);
  const stateRunId = state.runId || runId || wf.runId || "";
  await ensureCheckpointReady(taskId, stateRunId, state);
  const notes = String(reason || "").trim();
  if (!notes) throw new Error("reject reason is required");
  await appendToPhaseFile(taskId, rejectTo, `\n\n---\n\n**You:** ${notes}\n\n`, stateRunId);
  const interaction = await appendPhaseInteraction(taskId, rejectTo, {
    role: "user",
    type: "user_message",
    text: notes,
  }, stateRunId);
  if (interaction) sender({ type: "phase_interaction", phase: rejectTo, interaction });
  sender({ type: "user_message", phase: rejectTo, text: notes });
  await invokeGraph(taskId, stateRunId, new Command({
    resume: {
      approved: false,
      rejectTo,
      notes,
    },
  }));
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
}

export async function restartWorkflowPhase(taskId, phase, sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");
  if (!isAutoPhase(phase)) throw new Error(`cannot restart manual phase ${phase}`);
  const state = await readState(taskId, runId || wf.runId || "");
  if (state.currentPhase !== phase) throw new Error(`cannot restart ${phase} while current phase is ${state.currentPhase}`);
  updatePhaseStatus(state, phase, "in_progress", null);
  state.overallStatus = "in_progress";
  await writeState(taskId, state);
  sender({ type: "phase_restarted", phase });
  sender({ type: "state", state });
  await invokeGraph(taskId, state.runId || runId || wf.runId || "", {
    ...state,
    currentStep: phase,
  });
}

export async function pauseWorkflowPhase(taskId, phase, sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  const state = await readState(taskId, runId || wf?.runId || "");
  if (state.currentPhase !== phase) throw new Error(`cannot pause ${phase} while current phase is ${state.currentPhase}`);
  if (wf?.abortController) {
    try { wf.abortController.abort(); } catch {}
    wf.abortController = null;
  }
  updatePhaseStatus(state, phase, "awaiting_input");
  state.overallStatus = "awaiting_input";
  await writeState(taskId, state);
  await upsertTask(state.originalWorkFolder || state.workFolder, taskId, "awaiting_input", state.runId || "", { create: false }).catch(() => {});
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

export { stopActiveWorkflow };
