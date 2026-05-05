import { dirname, extname, join, relative, resolve } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { getBaseDir } from "../core-models/config.mjs";
import { getPhaseSkills, getPhaseBackend, getWorkflow, interpolate, isAutoPhase, nextPhase } from "../core-models/workflow.mjs";
import { readState, writeState, updatePhaseStatus, appendToPhaseFile, appendPhaseInteraction, readPhaseMessages, taskDir } from "../core-models/state.mjs";
import { upsertTask } from "../core-models/workfolders.mjs";
import { removeWorktree } from "./worktree.mjs";

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

export function formatToolLog(name, input) {
  try {
    const parsed = JSON.parse(input);
    if (name === "Bash" && parsed.command) return `\`$ ${parsed.command}\``;
    if (name === "Read" && parsed.file_path) return `Reading \`${parsed.file_path}\``;
    if (name === "Edit" && parsed.file_path) return `Editing \`${parsed.file_path}\``;
    if (name === "Write" && parsed.file_path) return `Writing \`${parsed.file_path}\``;
    if ((name === "Grep" || name === "Glob") && parsed.pattern) return `${name}: \`${parsed.pattern}\``;
    if (name === "Skill" && parsed.skill) return `Skill: \`/${parsed.skill}\``;
    return `${name}`;
  } catch {
    return `${name}`;
  }
}

function formatCodexToolLog(item) {
  if (!item) return "Codex";
  if (item.type === "command_execution" && item.command) return `\`$ ${item.command}\``;
  if (item.type === "mcp_tool_call") return `MCP: \`${item.server}.${item.tool}\``;
  if (item.type === "web_search" && item.query) return `WebSearch: \`${item.query}\``;
  if (item.type === "file_change") {
    const count = item.changes?.length || 0;
    return `Updated ${count} file${count === 1 ? "" : "s"}`;
  }
  if (item.type === "todo_list") return "Updated todo list";
  return item.type || "Codex";
}

function guessImageMediaType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function isPathInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (rel && !rel.startsWith("..") && !rel.startsWith("/"));
}

function getToolFilePath(input) {
  return input?.file_path || input?.path || input?.notebook_path || "";
}

function getReadToolPath(toolName, input) {
  if (toolName === "Glob" && !input?.path && String(input?.pattern || "").startsWith("/")) {
    return input.pattern;
  }
  return getToolFilePath(input);
}

async function persistTaskArtifactWrite(toolName, inputJson, taskRunDir) {
  if (toolName !== "Write" || !taskRunDir) return;
  let input;
  try {
    input = JSON.parse(inputJson);
  } catch {
    return;
  }

  const filePath = String(getToolFilePath(input) || "");
  if (!filePath || typeof input.content !== "string") return;
  if (!isPathInside(taskRunDir, filePath)) return;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, input.content);
  return { filePath, content: input.content };
}

function canPhaseEditWorkspace(phaseId) {
  const phase = getWorkflow()?.phases?.find((item) => item.id === phaseId);
  if (phase?.workspaceAccess === "write") return true;
  if (phase?.workspaceAccess === "read") return false;
  const skillRefs = (phase?.skillRefs || []).map((item) => String(item || "").toLowerCase());
  if (skillRefs.includes("implement")) return true;
  const id = String(phase?.id || "").toLowerCase();
  const label = String(phase?.label || "").toLowerCase();
  return id.includes("implement") || label.includes("implement");
}

function createReadOnlyPhaseToolGuard(workFolder, taskRunDir) {
  const readTools = new Set(["Read", "Grep", "Glob", "LS"]);
  const writeTools = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

  return async (toolName, input) => {
    if (readTools.has(toolName)) {
      const filePath = String(getReadToolPath(toolName, input) || "");
      if (!filePath || isPathInside(workFolder, filePath) || isPathInside(taskRunDir, filePath)) {
        return { behavior: "allow" };
      }
      return {
        behavior: "deny",
        message: "This workflow phase can only read the project workspace and its own task artifact files.",
      };
    }
    if (writeTools.has(toolName)) {
      const filePath = String(getToolFilePath(input) || "");
      if (filePath && isPathInside(taskRunDir, filePath)) return { behavior: "allow" };
      return {
        behavior: "deny",
        message: "This workflow phase can only write its own task artifact files. Source edits belong in an implementation phase.",
      };
    }
    return {
      behavior: "deny",
      message: "This workflow phase is read-only for the application workspace. Use an implementation phase for source changes.",
    };
  };
}

async function buildClaudePrompt(prompt, imagePaths) {
  if (!imagePaths || imagePaths.length === 0) return prompt;

  const content = [];
  if (prompt) {
    content.push({ type: "text", text: prompt });
  }

  for (const imagePath of imagePaths) {
    const data = await readFile(imagePath, "base64");
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: guessImageMediaType(imagePath),
        data,
      },
    });
  }

  return (async function* messageStream() {
    yield {
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content,
      },
    };
  })();
}

function buildCodexInput(prompt, imagePaths) {
  if (!imagePaths || imagePaths.length === 0) return prompt;

  const input = [];
  if (prompt) {
    input.push({ type: "text", text: prompt });
  }
  for (const imagePath of imagePaths) {
    input.push({ type: "local_image", path: imagePath });
  }
  return input;
}

function buildCodexEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "CODEX_API_KEY") {
      env[key] = value;
    }
  }
  return env;
}

async function streamClaudeTurn({ prompt, workFolder, sessionId, imagePaths, abortController, onText, onTool, onSession, onArtifactWrite, workspaceWrite, taskRunDir }) {
  const promptInput = await buildClaudePrompt(prompt, imagePaths);
  const phaseTools = workspaceWrite
    ? { type: "preset", preset: "claude_code" }
    : ["Read", "Grep", "Glob", "LS", "Write", "Edit", "MultiEdit", "NotebookEdit"];
  const stream = query({
    prompt: promptInput,
    options: {
      cwd: workFolder,
      resume: sessionId || undefined,
      abortController,
      additionalDirectories: workspaceWrite ? undefined : [taskRunDir],
      includePartialMessages: true,
      permissionMode: workspaceWrite ? "bypassPermissions" : "dontAsk",
      allowDangerouslySkipPermissions: workspaceWrite ? true : undefined,
      canUseTool: workspaceWrite ? undefined : createReadOnlyPhaseToolGuard(workFolder, taskRunDir),
      systemPrompt: { type: "preset", preset: "claude_code" },
      tools: phaseTools,
      settingSources: ["user", "project", "local"],
    },
  });

  let currentTool = null;
  let toolInputJson = "";

  for await (const message of stream) {
    if (message.type === "stream_event") {
      const inner = message.event;
      if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta") {
        if (inner.delta.text) await onText(inner.delta.text);
      } else if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use") {
        currentTool = inner.content_block.name;
        toolInputJson = "";
      } else if (inner.type === "content_block_delta" && inner.delta?.type === "input_json_delta") {
        toolInputJson += inner.delta.partial_json || "";
      } else if (inner.type === "content_block_stop" && currentTool) {
        const artifactWrite = await persistTaskArtifactWrite(currentTool, toolInputJson, taskRunDir);
        if (artifactWrite) await onArtifactWrite(artifactWrite);
        await onTool(formatToolLog(currentTool, toolInputJson));
        currentTool = null;
        toolInputJson = "";
      }
      continue;
    }

    if (message.type === "result") {
      if (message.session_id) onSession(message.session_id);
      if (message.subtype !== "success") {
        const details = Array.isArray(message.errors) && message.errors.length > 0
          ? message.errors.join("; ")
          : message.result || "Claude run failed";
        throw new Error(details);
      }
    }
  }
}

async function streamCodexTurn({ prompt, workFolder, sessionId, imagePaths, abortController, onText, onTool, onSession, workspaceWrite }) {
  const codex = new Codex({ env: buildCodexEnv() });
  const threadOptions = {
    workingDirectory: workFolder,
    sandboxMode: workspaceWrite ? "danger-full-access" : "read-only",
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    networkAccessEnabled: true,
  };
  const thread = sessionId
    ? codex.resumeThread(sessionId, threadOptions)
    : codex.startThread(threadOptions);
  const input = buildCodexInput(prompt, imagePaths);
  const { events } = await thread.runStreamed(input, { signal: abortController.signal });
  const seenItemText = new Map();
  const seenToolItems = new Set();

  for await (const event of events) {
    if (event.type === "thread.started") {
      onSession(event.thread_id);
      continue;
    }

    if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
      const item = event.item;

      if (item.type === "agent_message") {
        const previous = seenItemText.get(item.id) || "";
        const next = item.text || "";
        if (next.startsWith(previous)) {
          const delta = next.slice(previous.length);
          if (delta) await onText(delta);
        } else if (next && next !== previous) {
          await onText(next);
        }
        seenItemText.set(item.id, next);
        continue;
      }

      if (
        (item.type === "command_execution" || item.type === "mcp_tool_call" || item.type === "web_search" || item.type === "file_change" || item.type === "todo_list")
        && !seenToolItems.has(item.id)
      ) {
        seenToolItems.add(item.id);
        await onTool(formatCodexToolLog(item));
      }
      continue;
    }

    if (event.type === "turn.failed") {
      throw new Error(event.error?.message || "Codex run failed");
    }

    if (event.type === "error") {
      throw new Error(event.message || "Codex run failed");
    }
  }

  if (thread.id) onSession(thread.id);
}

async function streamAgentTurn({ backend, prompt, workFolder, sessionId, imagePaths, abortController, onText, onTool, onSession, onArtifactWrite, workspaceWrite, taskRunDir }) {
  if (backend === AI_BACKENDS.CODEX) {
    return streamCodexTurn({ prompt, workFolder, sessionId, imagePaths, abortController, onText, onTool, onSession, workspaceWrite });
  }

  return streamClaudeTurn({ prompt, workFolder, sessionId, imagePaths, abortController, onText, onTool, onSession, onArtifactWrite, workspaceWrite, taskRunDir });
}

async function appendToolLog(taskId, phase, log, runId = "") {
  const message = `\n\n*${log}*\n\n`;
  await appendToPhaseFile(taskId, phase, message, runId);
}

function getOutputByKey(phase, outputKey) {
  return (phase?.outputs || []).find((output) => output.key === outputKey) || null;
}

function describePhaseOutput(output) {
  return output?.key || output?.filename || "document";
}

async function readArtifactFile(taskId, filename, contextValues = {}, runId = "") {
  if (!filename) return "";
  const resolved = interpolate(filename, { taskId, runId, ...contextValues });
  try {
    return await readFile(join(await taskDir(taskId, runId), resolved), "utf-8");
  } catch {
    return "";
  }
}

async function writeArtifactFile(taskId, filename, content, contextValues = {}, runId = "") {
  if (!filename) return;
  const resolved = interpolate(filename, { taskId, runId, ...contextValues });
  await writeFile(join(await taskDir(taskId, runId), resolved), content);
}

async function resolveArtifactPath(taskId, filename, contextValues = {}, runId = "") {
  if (!filename) return "";
  const resolved = interpolate(filename, { taskId, runId, ...contextValues });
  return join(await taskDir(taskId, runId), resolved);
}

async function getPhaseArtifactForPath(taskId, phaseId, filePath, state, runId = "") {
  const workflow = getWorkflow();
  const phase = workflow?.phases?.find((item) => item.id === phaseId);
  for (const output of phase?.outputs || []) {
    if (!output?.key || !output.filename) continue;
    const outputPath = await resolveArtifactPath(taskId, output.filename, state?.contextValues || {}, state?.runId || runId);
    if (resolve(outputPath) === resolve(filePath)) {
      return { outputKey: output.key };
    }
  }
  return null;
}

async function ensurePhaseArtifact(taskId, phaseId, state, runId = "") {
  const workflow = getWorkflow();
  const phase = workflow?.phases?.find((item) => item.id === phaseId);
  const output = (phase?.outputs || [])[0];
  if (!output?.key || !output.filename) return null;
  const content = await readPhaseOutputArtifact(taskId, phaseId, output.key, state.runId || runId);
  return content ? { outputKey: output.key, content } : null;
}

async function validateRequiredPhaseInputs(taskId, phaseId, state, runId = "") {
  const workflow = getWorkflow();
  const phase = workflow?.phases?.find((item) => item.id === phaseId);
  const contextValues = state?.contextValues || {};
  const missing = [];

  for (const input of phase?.inputs || []) {
    if (!input?.name || input.required === false) continue;

    let content = "";
    if (input.sourceType === "workflow_context") {
      content = contextValues[input.name] || "";
    } else if (input.sourceType === "phase_output") {
      const sourcePhase = workflow?.phases?.find((item) => item.id === input.phaseId);
      const sourceOutput = getOutputByKey(sourcePhase, input.outputKey);
      if (sourceOutput?.filename) {
        content = await readArtifactFile(taskId, sourceOutput.filename, contextValues, state?.runId || runId);
      }
    }

    if (!String(content || "").trim()) {
      missing.push(input.sourceType === "phase_output"
        ? `${input.phaseId || "unknown phase"}/${input.outputKey || input.name}`
        : input.name);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Required input document missing for ${phase?.label || phaseId}: ${missing.join(", ")}`);
  }
}

async function validatePhaseOutputs(taskId, phaseId, state, runId = "") {
  const workflow = getWorkflow();
  const phase = workflow?.phases?.find((item) => item.id === phaseId);
  const contextValues = state?.contextValues || {};
  const missing = [];

  for (const output of phase?.outputs || []) {
    if (!output?.filename) continue;
    const content = await readArtifactFile(taskId, output.filename, contextValues, state?.runId || runId);
    if (!String(content || "").trim()) missing.push(describePhaseOutput(output));
  }

  if (missing.length > 0) {
    throw new Error(`Required output document missing for ${phase?.label || phaseId}: ${missing.join(", ")}`);
  }
}

async function publishCheckpointArtifacts(taskId, phaseId, state) {
  const workflow = getWorkflow();
  const phase = workflow?.phases?.find((item) => item.id === phaseId);
  const publishRules = phase?.checkpoint?.publish || [];
  const contextValues = state?.contextValues || {};
  if (publishRules.length === 0) return;

  for (const rule of publishRules) {
    const sourceInput = (phase.inputs || []).find((input) => input.name === rule.sourceName);
    const targetOutput = getOutputByKey(phase, rule.asOutputKey);
    if (!sourceInput || !targetOutput?.filename) continue;

    let content = "";
    if (sourceInput.sourceType === "workflow_context") {
      content = contextValues[sourceInput.name] || "";
    } else if (sourceInput.sourceType === "phase_output") {
      const sourcePhase = workflow.phases.find((item) => item.id === sourceInput.phaseId);
      const sourceOutput = getOutputByKey(sourcePhase, sourceInput.outputKey);
      content = await readArtifactFile(taskId, sourceOutput?.filename, contextValues, state?.runId || "");
    }

    if (!content) continue;
    await writeArtifactFile(taskId, targetOutput.filename, content, contextValues, state?.runId || "");
  }
}

async function buildPhasePrompt(taskId, phase, runId = "") {
  const baseDir = await getBaseDir();
  const state = await readState(taskId, runId);
  const contextValues = state.contextValues || {};
  const PHASE_SKILLS = getPhaseSkills();
  const skillFn = PHASE_SKILLS[phase];
  return {
    prompt: skillFn ? skillFn(taskId, baseDir, contextValues) : "",
    state,
    runId: state.runId || runId,
  };
}

function buildRevisionPrompt(phasePrompt, userFeedback, currentArtifact) {
  return [
    phasePrompt,
    "The user rejected or revised this workflow phase. Treat the following message as feedback for this same phase, not as permission to skip ahead to a later phase.",
    "Stay inside this phase's responsibility. If this is a planning or review phase, update only the phase artifact/document and do not edit application source files. Only implementation phases should edit source files when their phase instructions explicitly require it.",
    currentArtifact ? `Current phase artifact:\n\n${currentArtifact}` : "",
    `User feedback:\n\n${userFeedback}`,
  ].filter(Boolean).join("\n\n");
}

async function completePhase(taskId, phase, runId, workFolder, send) {
  const latestState = await readState(taskId, runId);
  await validateRequiredPhaseInputs(taskId, phase, latestState, runId);
  if (!isAutoPhase(phase)) {
    await publishCheckpointArtifacts(taskId, phase, latestState);
  }
  await validatePhaseOutputs(taskId, phase, latestState, runId);

  updatePhaseStatus(latestState, phase, "completed");

  const next = nextPhase(phase);
  if (next) {
    latestState.currentPhase = next;
    if (!isAutoPhase(next)) {
      updatePhaseStatus(latestState, next, "awaiting_input");
      latestState.overallStatus = "awaiting_input";
      upsertTask(latestState.originalWorkFolder || workFolder, taskId, "awaiting_input", latestState.runId || runId, { create: false }).catch(() => {});
    } else {
      updatePhaseStatus(latestState, next, "in_progress");
      latestState.overallStatus = "in_progress";
    }
  } else {
    latestState.overallStatus = "completed";
    latestState.currentPhase = "completed";
    if (latestState.worktree?.enabled && latestState.worktree.removeOnComplete) {
      await removeWorktree(latestState.worktree).catch(() => {});
    }
    upsertTask(latestState.originalWorkFolder || workFolder, taskId, "completed", latestState.runId || runId, { create: false }).catch(() => {});
  }

  await writeState(taskId, latestState);
  sendWorkflowEvent(send, { type: "state", state: latestState });

  const artifact = await ensurePhaseArtifact(taskId, phase, latestState, runId);
  if (artifact) {
    sendWorkflowEvent(send, {
      type: "phase_artifact",
      phase,
      outputKey: artifact.outputKey,
      content: artifact.content,
    });
  }

  if (next && !isAutoPhase(next)) {
    const content = await getPhaseContent(taskId, next, latestState.runId || runId);
    if (content) sendWorkflowEvent(send, { type: "phase_content", phase: next, content });
  }

  if (next && isAutoPhase(next)) {
    runPhase(taskId, next);
  }

  return latestState;
}

async function markPhaseFailed(taskId, phase, runId, workFolder, message, send, emitPhaseFailed = true) {
  const state = await readState(taskId, runId).catch(() => null);
  if (state) {
    updatePhaseStatus(state, phase, "failed");
    state.currentPhase = phase;
    state.overallStatus = "failed";
    await writeState(taskId, state);
    await upsertTask(state.originalWorkFolder || workFolder, taskId, "failed", state.runId || runId, { create: false }).catch(() => {});
    sendWorkflowEvent(send, { type: "state", state });
  }
  if (emitPhaseFailed) sendWorkflowEvent(send, { type: "phase_failed", phase, message });
}

async function recordPhaseInteraction(taskId, phase, send, interaction, runId = "") {
  const entry = await appendPhaseInteraction(taskId, phase, interaction, runId);
  if (entry) sendWorkflowEvent(send, { type: "phase_interaction", phase, interaction: entry });
  return entry;
}

export async function readPhaseOutputArtifact(taskId, phaseId, outputKey, runId = "") {
  const workflow = getWorkflow();
  const phase = workflow?.phases?.find((item) => item.id === phaseId);
  const output = getOutputByKey(phase, outputKey);
  if (!output?.filename) return "";
  const state = await readState(taskId, runId).catch(() => null);
  return readArtifactFile(taskId, output.filename, state?.contextValues || {}, state?.runId || runId);
}

export async function readPhaseOutputArtifacts(taskId, phaseId, runId = "") {
  const workflow = getWorkflow();
  const phase = workflow?.phases?.find((item) => item.id === phaseId);
  const result = {};
  for (const output of phase?.outputs || []) {
    if (!output?.key || !output.filename) continue;
    const content = await readPhaseOutputArtifact(taskId, phaseId, output.key, runId);
    if (content) result[output.key] = content;
  }
  return result;
}

export async function getPhaseOutputArtifactPath(taskId, phaseId, outputKey, runId = "") {
  const workflow = getWorkflow();
  const phase = workflow?.phases?.find((item) => item.id === phaseId);
  const output = getOutputByKey(phase, outputKey);
  if (!output?.filename) return "";
  const state = await readState(taskId, runId).catch(() => null);
  return resolveArtifactPath(taskId, output.filename, state?.contextValues || {}, state?.runId || runId);
}

export async function getPhaseContent(taskId, phase, runId = "") {
  let stateRunId = runId;
  if (stateRunId) {
    const state = await readState(taskId, stateRunId).catch(() => null);
    if (!state) return "";
    stateRunId = state.runId || stateRunId;
  }
  return readPhaseMessages(taskId, phase, stateRunId);
}

async function runPromptForPhase({ taskId, phase, prompt, sessionId = null, imagePaths = [], runId = "" }) {
  const wf = activeWorkflows.get(taskId);
  if (!wf) return;

  const backend = normalizeAiBackend(getPhaseBackend(phase));
  const workspaceWrite = canPhaseEditWorkspace(phase);
  const taskRunDir = await taskDir(taskId, runId);
  const abortController = new AbortController();
  wf.abortController = abortController;
  sendWorkflowEvent(wf.send, {
    type: "backend_selected",
    phase,
    backend,
    resumed: Boolean(sessionId),
    imageCount: imagePaths.length,
    workspaceWrite,
  });
  try {
    await streamAgentTurn({
      backend,
      prompt,
      workFolder: wf.workFolder,
      sessionId,
      imagePaths,
      abortController,
      workspaceWrite,
      taskRunDir,
      onText: async (text) => {
        sendWorkflowEvent(wf.send, { type: "text_delta", phase, text });
        await recordPhaseInteraction(taskId, phase, wf.send, {
          role: "assistant",
          type: "assistant_delta",
          text,
          backend,
        }, runId);
        await appendToPhaseFile(taskId, phase, text, runId);
      },
      onTool: async (log) => {
        sendWorkflowEvent(wf.send, { type: "tool_use", phase, name: backend, log });
        await recordPhaseInteraction(taskId, phase, wf.send, {
          role: "tool",
          type: "tool_use",
          text: log,
          backend,
        }, runId);
        await appendToolLog(taskId, phase, log, runId);
      },
      onArtifactWrite: async ({ filePath, content }) => {
        const state = await readState(taskId, runId).catch(() => null);
        const artifact = await getPhaseArtifactForPath(taskId, phase, filePath, state, runId);
        if (!artifact) return;
        sendWorkflowEvent(wf.send, {
          type: "phase_artifact",
          phase,
          outputKey: artifact.outputKey,
          content,
        });
      },
      onSession: (nextSessionId) => {
        if (!nextSessionId) return;
        wf.phaseSessionIds[phase] = nextSessionId;
        sendWorkflowEvent(wf.send, {
          type: "session_attached",
          phase,
          backend,
          sessionId: nextSessionId,
        });
        readState(taskId, runId).then((state) => {
          const current = state.phases.find((item) => item.id === phase);
          updatePhaseStatus(state, phase, current?.status || "in_progress", nextSessionId);
          writeState(taskId, state);
        }).catch(() => {});
      },
    });
  } catch (err) {
    if (err?.name !== "AbortError") {
      if (err && typeof err === "object") err.workflowPhaseFailedEmitted = true;
      sendWorkflowEvent(wf.send, {
        type: "phase_failed",
        phase,
        backend,
        message: err?.message || "Agent run failed",
      });
    }
    throw err;
  } finally {
    if (wf.abortController === abortController) {
      wf.abortController = null;
    }
  }
}

export async function runPhase(taskId, phase, sessionId) {
  const wf = activeWorkflows.get(taskId);
  if (!wf) return;
  const { workFolder, send } = wf;
  const runId = wf.runId || "";
  let phaseRunId = runId;

  try {
    const { prompt, state } = await buildPhasePrompt(taskId, phase, runId);
    phaseRunId = state.runId || runId;
    const imagePaths = wf.startImages && wf.startImages.length > 0 ? [...wf.startImages] : [];
    wf.startImages = [];

    await runPromptForPhase({
      taskId,
      phase,
      prompt,
      sessionId: sessionId || null,
      imagePaths,
      runId: phaseRunId,
    });
    await completePhase(taskId, phase, phaseRunId, workFolder, send);
    sendWorkflowEvent(send, { type: "phase_completed", phase });
  } catch (err) {
    if (err?.name === "AbortError") return;
    const message = err?.message || String(err || "Agent run failed");
    await markPhaseFailed(taskId, phase, phaseRunId, workFolder, message, send, !err.workflowPhaseFailedEmitted);
    sendWorkflowEvent(send, { type: "error", phase, message });
  }
}

export async function continuePhaseConversation(taskId, phase, prompt, imagePaths = [], options = {}) {
  const wf = activeWorkflows.get(taskId);
  if (!wf) return;
  let nextPrompt = prompt;
  let sessionId = wf.phaseSessionIds[phase] || null;
  let promptRunId = wf.runId || "";

  if (options.mode === "phase_revision") {
    const phasePrompt = await buildPhasePrompt(taskId, phase, wf.runId || "");
    const phaseConfig = getWorkflow()?.phases?.find((item) => item.id === phase);
    const output = (phaseConfig?.outputs || [])[0];
    const currentArtifact = output?.key
      ? await readPhaseOutputArtifact(taskId, phase, output.key, phasePrompt.runId)
      : "";
    nextPrompt = buildRevisionPrompt(phasePrompt.prompt, prompt, currentArtifact);
    promptRunId = phasePrompt.runId;
  }

  await runPromptForPhase({
    taskId,
    phase,
    prompt: nextPrompt,
    sessionId,
    imagePaths,
    runId: promptRunId,
  });
}

export async function completePhaseAfterUserTurn(taskId, phase, runId = "") {
  const wf = activeWorkflows.get(taskId);
  if (!wf) return null;
  const state = await completePhase(taskId, phase, runId || wf.runId || "", wf.workFolder, wf.send);
  sendWorkflowEvent(wf.send, { type: "phase_completed", phase });
  return state;
}
