import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import OpenAI from "openai";
import { realpath, stat } from "fs/promises";
import { join, relative, resolve } from "path";
import { getBaseDir, readAiApiProfileSync, readAiApiProfilesSync, readAiBackendOverrideSync } from "../../../packages/core-models/config";
import { readManagedSkillContentSync } from "../../../packages/core-models/skills";
import {
  assertSafeWorkflowFilename,
  getActiveWorkflowFile,
  getWorkflow,
  getWorkflowConfigShape,
  getWorkflowRejectTargets,
  getWorkflowStepOrder,
  getWorkflowStepType,
  isWorkflowAutoStep,
  readWorkflowFileSync,
} from "../../../packages/core-models/workflow";
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
} from "../../../packages/core-models/state";
import { WORKFLOW_DEBUG_EVENT_TYPES } from "../../../packages/core-models/debug-events";
import { upsertTask } from "../../../packages/core-models/workfolders";
import { activeWorkflows, getPhaseContent, normalizeAiBackend, normalizeWorktreeNamingProvider, readPhaseOutputArtifacts, stopActiveWorkflow, WORKTREE_NAMING_PROVIDERS } from "../../../packages/core-lib/claude";
import { prepareWorktree, removeWorktree } from "../../../packages/core-lib/worktree";
import { buildWorkflowGraphFromDsl, createAppSdkAgentAdapter, createSdkAgentAdapter, FileCheckpointSaver } from "../../../packages/core-lib/langgraph-runtime/index";
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

const activeGraphs = new Map();

function isAbortError(error) {
  return error?.name === "AbortError"
    || error?.code === "ABORT_ERR"
    || /abort|aborted|cancelled|canceled/i.test(String(error?.message || ""));
}

function isPathInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (rel && !rel.startsWith("..") && !rel.startsWith("/"));
}

async function getSafeRunImagePaths(taskId, runId, images = []) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const uploadDir = resolve(await taskDir(taskId, runId), "uploads");
  const realUploadDir = await realpath(uploadDir).catch(() => "");
  if (!realUploadDir) return [];
  const safePaths = [];

  for (const imagePath of images) {
    const resolvedPath = resolve(String(imagePath || ""));
    if (!isPathInside(uploadDir, resolvedPath)) continue;
    const fileStat = await stat(resolvedPath).catch(() => null);
    if (!fileStat?.isFile()) continue;
    const realImagePath = await realpath(resolvedPath).catch(() => "");
    if (realImagePath && isPathInside(realUploadDir, realImagePath)) safePaths.push(realImagePath);
  }

  return safePaths;
}

function createEmitter(sender, taskId, runId = "") {
  return (event = {}) => sender?.({
    ...event,
    taskId,
    runId,
  });
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

function buildLocalWorktreeNameFallback(taskId, taskInputs = {}) {
  const text = [
    taskId,
    ...Object.values(taskInputs || {}).filter((value) => typeof value === "string"),
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

async function generateWorktreeNameWithAiApi({ prompt, profileId }) {
  const profile = profileId ? readAiApiProfileSync(profileId) : readAiApiProfilesSync()[0] || null;
  if (!profile?.apiKey || !profile?.model) return "";
  const client = new OpenAI({
    apiKey: profile.apiKey,
    baseURL: profile.baseUrl || undefined,
  });
  const completion = await client.chat.completions.create({
    model: profile.model,
    messages: [
      {
        role: "system",
        content: "Return exactly one concise Git branch name and no explanation.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });
  return completion.choices?.[0]?.message?.content || "";
}

function getThreadId(taskId, runId) {
  return `${taskId}:${runId}`;
}

function getRuntimeWorkflow(wf, state = null) {
  return wf?.workflow || state?.workflowDefinition || getWorkflow();
}

function getStepType(workflow, stepId) {
  return getWorkflowStepType(workflow, stepId);
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
    pendingImagePaths: langState.pendingImagePaths || currentState.pendingImagePaths || {},
    logs: langState.logs || currentState.logs || [],
  };

  for (const phase of next.phases || []) {
    const sessionKey = phase.id;
    const sessionId = next.sessionMap?.[sessionKey] || phase.sessionId;
    if (sessionId) phase.sessionId = sessionId;
  }

  return next;
}

function setRunningStep(state, workflow, stepId) {
  if (!stepId || stepId === "completed") return;
  for (const phase of state.phases || []) {
    if (phase.id === stepId) {
      phase.status = getStepType(workflow, stepId) === "checkpoint" ? "awaiting_input" : "in_progress";
    } else if (phase.status === "in_progress") {
      phase.status = "completed";
    }
  }
  for (const step of state.steps || []) {
    const phase = state.phases.find((item) => item.id === step.id);
    if (phase) Object.assign(step, phase);
  }
}

function markCompletedBeforeCurrent(state, workflow) {
  const order = getWorkflowStepOrder(workflow);
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

async function persistLangGraphState(taskId, runId, langState, workflow) {
  const state = await readState(taskId, runId);
  const runtimeWorkflow = workflow || state.workflowDefinition || getWorkflow();
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
    setRunningStep(next, runtimeWorkflow, next.currentPhase);
    markCompletedBeforeCurrent(next, runtimeWorkflow);
  }

  await writeState(taskId, next);
  return next;
}

async function generateWorktreeName({ taskId, workFolder, taskInputs, workflow }) {
  const skill = readManagedSkillContentSync("worktree-naming") || DEFAULT_WORKTREE_NAMING_SKILL;
  const provider = normalizeWorktreeNamingProvider(workflow?.worktree?.namingProvider);
  const localFallback = buildLocalWorktreeNameFallback(taskId, taskInputs);
  const context = [
    `Task ID: ${taskId}`,
    `Workflow: ${workflow?.name || ""}`,
    `Work folder: ${workFolder}`,
    `Task inputs: ${JSON.stringify(taskInputs || {})}`,
    localFallback ? `Fallback name if needed: ${localFallback}` : "",
  ].join("\n");

  const prompt = `${skill}

Additional rules:
- If the task is written in Chinese or another non-English language, translate the intent into a short English slug.
- Do not return generic names like chore/task, chore/update, or task.
- Prefer the fallback name only if it accurately describes the task.

${context}`;
  try {
    if (provider === WORKTREE_NAMING_PROVIDERS.AI_API) {
      const content = await generateWorktreeNameWithAiApi({ prompt, profileId: workflow?.worktree?.namingAiApiProfileId || "" });
      const name = cleanGeneratedWorktreeName(content);
      return isGenericWorktreeName(name) ? localFallback : name || localFallback;
    }

    const backend = normalizeAiBackend(readAiBackendOverrideSync());
    const adapter = createSdkAgentAdapter({
      workFolder,
      taskDir: workFolder,
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
        taskInputs,
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
  return buildWorkflowGraphFromDsl(wf.workflow, adapter, { checkpointer: new FileCheckpointSaver(join(wf.taskRunDir, "checkpoints")) });
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

function resetGraph(taskId, runId) {
  activeGraphs.delete(getThreadId(taskId, runId));
}

async function invokeGraph(taskId, runId, input) {
  const wf = activeWorkflows.get(taskId);
  if (!wf) return null;

  const graph = getOrCreateGraph(taskId, runId, wf);
  let result;
  try {
    result = await graph.invoke(input, createGraphConfig(taskId, runId));
  } catch (error) {
    if (isAbortError(error)) {
      const state = await readState(taskId, runId).catch(() => null);
      if (state?.overallStatus === "paused") return state;
    }
    throw error;
  }
  const state = await persistLangGraphState(taskId, runId, result, wf.workflow);
  wf.send({ type: "state", state });

  if (isInterrupted(result)) return state;
  if (state.overallStatus === "completed") {
    await finalizeWorktreeIfNeeded(state);
    await upsertTask(state.originalWorkFolder || state.workFolder, taskId, "completed", state.runId || runId, { create: false });
  }
  return state;
}

async function ensureCheckpointReady(taskId, runId, state) {
  const wf = activeWorkflows.get(taskId);
  const workflow = getRuntimeWorkflow(wf, state);
  if (getStepType(workflow, state.currentStep || state.currentPhase) !== "checkpoint") return;

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
  await persistLangGraphState(taskId, runId, result, workflow);
}

async function markWorkflowFailed(taskId, runId, phase, error, sender) {
  const state = await readState(taskId, runId);
  const message = error?.message || "Workflow run failed";
  updatePhaseStatus(state, phase || state.currentPhase, "failed");
  state.overallStatus = "failed";
  state.logs = [...(state.logs || []), `failed:${phase || state.currentPhase}:${message}`];
  await writeState(taskId, state);
  await upsertTask(state.originalWorkFolder || state.workFolder, taskId, "failed", state.runId || runId, { create: false }).catch(() => {});
  sender?.({ type: "phase_failed", phase: phase || state.currentPhase, message });
  sender?.({ type: "state", state });
  return state;
}

export async function startWorkflowSession(taskId, workFolder, taskInputs, images, runId, sender, options = {}) {
  if (!taskId || !workFolder) throw new Error("taskId and workFolder required");
  const workflowFilename = String(options?.workflowFilename || "").trim();
  const workflow = workflowFilename ? readWorkflowFileSync(assertSafeWorkflowFilename(workflowFilename)) : getWorkflow();
  if (!workflow || getWorkflowStepOrder(workflow).length === 0) throw new Error("no workflow configured");

  let existingState = null;
  try {
    existingState = await readState(taskId, runId || "");
  } catch {}

  if (existingState && existingState.overallStatus !== "completed") {
    const existingRunId = existingState.runId || runId || "";
    const send = createEmitter(sender, taskId, existingRunId);
    activeWorkflows.set(taskId, {
      workFolder: existingState.workFolder,
      taskRunDir: await taskDir(taskId, existingRunId),
      send,
      abortController: null,
      runId: existingRunId,
      workflow: existingState.workflowDefinition,
    });
    send({ type: "state", state: existingState });
    await emitExistingTaskFiles(taskId, existingState, send);
    return;
  }

  if (existingState) await clearTaskData(taskId, runId || existingState.runId || "");
  const finalRunId = runId || nanoid();
  await createTaskRunDir(taskId, finalRunId);

  const activeWorkflowFile = workflowFilename || getActiveWorkflowFile();
  const send = createEmitter(sender, taskId, finalRunId);
  send({ type: WORKFLOW_DEBUG_EVENT_TYPES.WORKFLOW_STARTING });
  const requestedWorktreeName = String(options?.worktreeName || "").trim();
  if (workflow.worktree?.enabled && !requestedWorktreeName) send({ type: WORKFLOW_DEBUG_EVENT_TYPES.WORKTREE_NAMING_STARTED });
  const worktreeName = workflow.worktree?.enabled
    ? requestedWorktreeName || await generateWorktreeName({ taskId, workFolder, taskInputs, workflow })
    : "";
  if (workflow.worktree?.enabled && !requestedWorktreeName) {
    send({ type: WORKFLOW_DEBUG_EVENT_TYPES.WORKTREE_NAMING_COMPLETED, name: worktreeName });
  }
  if (workflow.worktree?.enabled) send({ type: WORKFLOW_DEBUG_EVENT_TYPES.WORKTREE_PREPARING, name: worktreeName });
  const preparedWorktree = await prepareWorktree({
    repoRoot: workFolder,
    taskId,
    worktree: workflow.worktree,
    worktreeName,
  });
  if (preparedWorktree.enabled) {
    send({
      type: WORKFLOW_DEBUG_EVENT_TYPES.WORKTREE_READY,
      branchName: preparedWorktree.branchName,
      rootPath: preparedWorktree.rootPath,
    });
  }

  const runtimeWorkFolder = preparedWorktree.workFolder;
  const baseDir = await getBaseDir();
  const state = makeInitialState(taskId, runtimeWorkFolder, baseDir, taskInputs, {
    workflow,
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
  const stepOrder = getWorkflowStepOrder(workflow);
  updatePhaseStatus(state, stepOrder[0], "in_progress");
  await writeState(taskId, state);

  const taskRunDir = await taskDir(taskId, finalRunId);
  activeWorkflows.set(taskId, {
    workFolder: runtimeWorkFolder,
    taskRunDir,
    send,
    abortController: null,
    runId: finalRunId,
    workflow,
  });
  await upsertTask(workFolder, taskId, "in_progress", finalRunId);
  send({ type: "state", state });

  const safeImages = await getSafeRunImagePaths(taskId, finalRunId, images);
  const graph = createGraph(taskId, finalRunId, activeWorkflows.get(taskId), safeImages);
  activeGraphs.set(getThreadId(taskId, finalRunId), graph);
  try {
    await invokeGraph(taskId, finalRunId, {
      taskId,
      runId: finalRunId,
      workFolder: runtimeWorkFolder,
      taskDir: taskRunDir,
      currentStep: stepOrder[0],
      overallStatus: "in_progress",
      taskInputs: taskInputs || {},
    });
  } catch (err) {
    await markWorkflowFailed(taskId, finalRunId, stepOrder[0], err, send);
    throw err;
  }
}

export async function approveWorkflow(taskId, sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");
  const state = await readState(taskId, runId || wf.runId || "");
  const stateRunId = state.runId || runId || wf.runId || "";
  wf.send = createEmitter(sender, taskId, stateRunId);
  await ensureCheckpointReady(taskId, stateRunId, state);
  wf.send({ type: "phase_approved", phase: state.currentPhase, requestedBy: "user", trigger: "checkpoint" });
  try {
    await invokeGraph(taskId, stateRunId, new Command({
      resume: {
        approved: true,
        notes: "Approved by user.",
      },
    }));
  } catch (err) {
    await markWorkflowFailed(taskId, stateRunId, state.currentPhase, err, wf.send);
    throw err;
  }
}

export async function rejectWorkflow(taskId, rejectTo, reason = "", sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");
  const state = await readState(taskId, runId || wf.runId || "");
  const cur = state.currentPhase;
  const workflow = getRuntimeWorkflow(wf, state);
  const allowed = getWorkflowRejectTargets(workflow)[cur];
  if (!allowed || !allowed.includes(rejectTo)) throw new Error(`cannot reject from ${cur} to ${rejectTo}`);
  const stateRunId = state.runId || runId || wf.runId || "";
  const send = createEmitter(sender, taskId, stateRunId);
  wf.send = send;
  await ensureCheckpointReady(taskId, stateRunId, state);
  const notes = String(reason || "").trim();
  if (!notes) throw new Error("reject reason is required");
  send({ type: "phase_rejected", phase: cur, rejectTo, requestedBy: "user", trigger: "checkpoint" });
  await appendToPhaseFile(taskId, rejectTo, `\n\n---\n\n**You:** ${notes}\n\n`, stateRunId);
  const interaction = await appendPhaseInteraction(taskId, rejectTo, {
    role: "user",
    type: "user_message",
    text: notes,
  }, stateRunId);
  if (interaction) send({ type: "phase_interaction", phase: rejectTo, interaction });
  send({ type: "user_message", phase: rejectTo, text: notes });
  try {
    await invokeGraph(taskId, stateRunId, new Command({
      resume: {
        approved: false,
        rejectTo,
        notes,
      },
    }));
  } catch (err) {
    await markWorkflowFailed(taskId, stateRunId, cur, err, wf.send);
    throw err;
  }
}

export async function sendWorkflowMessage(taskId, text, images, sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");

  const state = await readState(taskId, runId || wf.runId || "");
  const phase = state.currentPhase;
  const stateRunId = state.runId || runId || wf.runId || "";
  const send = createEmitter(sender, taskId, stateRunId);
  const safeImages = await getSafeRunImagePaths(taskId, stateRunId, images);

  const userBlock = `\n\n---\n\n**You:** ${text}\n\n`;
  await appendToPhaseFile(taskId, phase, userBlock, stateRunId);
  if (safeImages.length) {
    const attachmentBlock = safeImages.map((imagePath) => `- ${imagePath}`).join("\n");
    await appendToPhaseFile(taskId, phase, `**Attached images:**\n${attachmentBlock}\n\n`, stateRunId);
  }
  const interaction = await appendPhaseInteraction(taskId, phase, {
    role: "user",
    type: "user_message",
    text,
    imageCount: safeImages.length,
    imagePaths: safeImages,
  }, stateRunId);
  const notes = String(text || "").trim();
  state.pendingMessages = {
    ...(state.pendingMessages || {}),
    [phase]: notes
      ? [state.pendingMessages?.[phase], notes].filter(Boolean).join("\n\n")
      : (state.pendingMessages?.[phase] || ""),
  };
  state.pendingImagePaths = {
    ...(state.pendingImagePaths || {}),
    [phase]: [
      ...((state.pendingImagePaths?.[phase] || []).filter(Boolean)),
      ...safeImages,
    ],
  };
  await writeState(taskId, state);
  if (interaction) send({ type: "phase_interaction", phase, interaction });
  send({ type: "user_message", phase, text });
}

export async function resumeWorkflowPhase(taskId, phase, sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");
  const state = await readState(taskId, runId || wf.runId || "");
  const workflow = getRuntimeWorkflow(wf, state);
  if (!isWorkflowAutoStep(workflow, phase)) throw new Error(`cannot resume manual phase ${phase}`);
  if (state.currentPhase !== phase) throw new Error(`cannot resume ${phase} while current phase is ${state.currentPhase}`);
  if (state.overallStatus !== "paused") throw new Error(`cannot resume ${phase} while workflow status is ${state.overallStatus}`);
  const stateRunId = state.runId || runId || wf.runId || "";
  wf.send = createEmitter(sender, taskId, stateRunId);
  resetGraph(taskId, stateRunId);
  updatePhaseStatus(state, phase, "in_progress");
  state.overallStatus = "in_progress";
  await writeState(taskId, state);
  wf.send({ type: "phase_resumed", phase, requestedBy: "user", trigger: "toolbar" });
  wf.send({ type: "state", state });
  try {
    await invokeGraph(taskId, stateRunId, new Command({
      resume: null,
      update: {
        ...state,
        currentStep: phase,
        overallStatus: "in_progress",
      },
    }));
  } catch (err) {
    await markWorkflowFailed(taskId, stateRunId, phase, err, wf.send);
    throw err;
  }
}

export async function retryWorkflowPhase(taskId, phase, sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) throw new Error("workflow not found");
  const state = await readState(taskId, runId || wf.runId || "");
  const workflow = getRuntimeWorkflow(wf, state);
  if (!isWorkflowAutoStep(workflow, phase)) throw new Error(`cannot retry manual phase ${phase}`);
  if (state.currentPhase !== phase) throw new Error(`cannot retry ${phase} while current phase is ${state.currentPhase}`);
  if (state.overallStatus !== "failed") throw new Error(`cannot retry ${phase} while workflow status is ${state.overallStatus}`);
  const stateRunId = state.runId || runId || wf.runId || "";
  wf.send = createEmitter(sender, taskId, stateRunId);
  if (wf.abortController) {
    try { wf.abortController.abort(); } catch {}
    wf.abortController = null;
  }
  resetGraph(taskId, stateRunId);
  updatePhaseStatus(state, phase, "in_progress");
  state.overallStatus = "in_progress";
  await writeState(taskId, state);
  await upsertTask(state.originalWorkFolder || state.workFolder, taskId, "in_progress", stateRunId, { create: false }).catch(() => {});
  wf.send({ type: "phase_retried", phase, requestedBy: "user", trigger: "toolbar" });
  wf.send({ type: "state", state });
  try {
    await invokeGraph(taskId, stateRunId, {
      ...state,
      currentStep: phase,
      overallStatus: "in_progress",
    });
  } catch (err) {
    await markWorkflowFailed(taskId, stateRunId, phase, err, wf.send);
    throw err;
  }
}

export async function pauseWorkflowPhase(taskId, phase, sender, runId = "") {
  const wf = activeWorkflows.get(taskId);
  const state = await readState(taskId, runId || wf?.runId || "");
  const stateRunId = state.runId || runId || wf?.runId || "";
  const send = createEmitter(sender, taskId, stateRunId);
  if (state.currentPhase !== phase) throw new Error(`cannot pause ${phase} while current phase is ${state.currentPhase}`);
  const workflow = getRuntimeWorkflow(wf, state);
  if (!isWorkflowAutoStep(workflow, phase)) throw new Error(`cannot pause manual phase ${phase}`);
  if (state.overallStatus !== "in_progress") throw new Error(`cannot pause workflow while status is ${state.overallStatus}`);
  if (wf?.abortController) {
    try { wf.abortController.abort(); } catch {}
    wf.abortController = null;
  }
  resetGraph(taskId, stateRunId);
  updatePhaseStatus(state, phase, "paused");
  state.overallStatus = "paused";
  await writeState(taskId, state);
  await upsertTask(state.originalWorkFolder || state.workFolder, taskId, "paused", stateRunId, { create: false }).catch(() => {});
  send({ type: "phase_paused", phase, requestedBy: "user", trigger: "toolbar" });
  send({ type: "state", state });
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
