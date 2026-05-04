import { extname, join } from "path";
import { readFile, writeFile } from "fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { getBaseDir } from "../core-models/config.mjs";
import { getPhaseSkills, getPhaseArtifactFiles, getPhaseBackend, getWorkflow, interpolate, isAutoPhase, nextPhase } from "../core-models/workflow.mjs";
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

async function streamClaudeTurn({ prompt, workFolder, sessionId, imagePaths, abortController, onText, onTool, onSession }) {
  const promptInput = await buildClaudePrompt(prompt, imagePaths);
  const stream = query({
    prompt: promptInput,
    options: {
      cwd: workFolder,
      resume: sessionId || undefined,
      abortController,
      includePartialMessages: true,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      systemPrompt: { type: "preset", preset: "claude_code" },
      tools: { type: "preset", preset: "claude_code" },
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

async function streamCodexTurn({ prompt, workFolder, sessionId, imagePaths, abortController, onText, onTool, onSession }) {
  const codex = new Codex();
  const threadOptions = {
    workingDirectory: workFolder,
    sandboxMode: "danger-full-access",
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

async function streamAgentTurn({ backend, prompt, workFolder, sessionId, imagePaths, abortController, onText, onTool, onSession }) {
  if (backend === AI_BACKENDS.CODEX) {
    return streamCodexTurn({ prompt, workFolder, sessionId, imagePaths, abortController, onText, onTool, onSession });
  }

  return streamClaudeTurn({ prompt, workFolder, sessionId, imagePaths, abortController, onText, onTool, onSession });
}

async function appendToolLog(taskId, phase, log) {
  const message = `\n\n*${log}*\n\n`;
  await appendToPhaseFile(taskId, phase, message);
}

function getOutputByKey(phase, outputKey) {
  return (phase?.outputs || []).find((output) => output.key === outputKey) || null;
}

async function readArtifactFile(taskId, filename, contextValues = {}) {
  if (!filename) return "";
  const resolved = interpolate(filename, { taskId, ...contextValues });
  try {
    return await readFile(join(await taskDir(taskId), resolved), "utf-8");
  } catch {
    return "";
  }
}

async function writeArtifactFile(taskId, filename, content, contextValues = {}) {
  if (!filename) return;
  const resolved = interpolate(filename, { taskId, ...contextValues });
  await writeFile(join(await taskDir(taskId), resolved), content);
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
      content = await readArtifactFile(taskId, sourceOutput?.filename, contextValues);
    }

    if (!content) continue;
    await writeArtifactFile(taskId, targetOutput.filename, content, contextValues);
  }
}

async function recordPhaseInteraction(taskId, phase, send, interaction) {
  const entry = await appendPhaseInteraction(taskId, phase, interaction);
  if (entry) sendWorkflowEvent(send, { type: "phase_interaction", phase, interaction: entry });
  return entry;
}

export async function readArtifact(taskId, phase) {
  const PHASE_ARTIFACT_FILES = getPhaseArtifactFiles();
  const fn = PHASE_ARTIFACT_FILES[phase];
  if (fn) {
    const state = await readState(taskId).catch(() => null);
    try { return await readFile(join(await taskDir(taskId), fn(taskId, state?.contextValues || {})), "utf-8"); } catch {}
  }
  return "";
}

export async function getPhaseContent(taskId, phase) {
  const messages = await readPhaseMessages(taskId, phase);
  if (!isAutoPhase(phase)) {
    const artifact = await readArtifact(taskId, phase);
    if (artifact) return messages ? artifact + "\n\n---\n\n" + messages : artifact;
  }
  if (messages) return messages;
  const artifact = await readArtifact(taskId, phase);
  if (artifact) return artifact;
  return "";
}

async function runPromptForPhase({ taskId, phase, prompt, sessionId = null, imagePaths = [] }) {
  const wf = activeWorkflows.get(taskId);
  if (!wf) return;

  const backend = normalizeAiBackend(getPhaseBackend(phase));
  const abortController = new AbortController();
  wf.abortController = abortController;
  sendWorkflowEvent(wf.send, {
    type: "backend_selected",
    phase,
    backend,
    resumed: Boolean(sessionId),
    imageCount: imagePaths.length,
  });
  try {
    await streamAgentTurn({
      backend,
      prompt,
      workFolder: wf.workFolder,
      sessionId,
      imagePaths,
      abortController,
      onText: async (text) => {
        sendWorkflowEvent(wf.send, { type: "text_delta", phase, text });
        await recordPhaseInteraction(taskId, phase, wf.send, {
          role: "assistant",
          type: "assistant_delta",
          text,
          backend,
        });
        await appendToPhaseFile(taskId, phase, text);
      },
      onTool: async (log) => {
        sendWorkflowEvent(wf.send, { type: "tool_use", phase, name: backend, log });
        await recordPhaseInteraction(taskId, phase, wf.send, {
          role: "tool",
          type: "tool_use",
          text: log,
          backend,
        });
        await appendToolLog(taskId, phase, log);
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
        readState(taskId).then((state) => {
          const current = state.phases.find((item) => item.id === phase);
          updatePhaseStatus(state, phase, current?.status || "in_progress", nextSessionId);
          writeState(taskId, state);
        }).catch(() => {});
      },
    });
  } catch (err) {
    if (err?.name !== "AbortError") {
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

  try {
    const baseDir = await getBaseDir();
    const state = await readState(taskId);
    const contextValues = state.contextValues || {};
    const PHASE_SKILLS = getPhaseSkills();
    const skillFn = PHASE_SKILLS[phase];
    const prompt = skillFn ? skillFn(taskId, baseDir, contextValues) : "";
    const imagePaths = wf.startImages && wf.startImages.length > 0 ? [...wf.startImages] : [];
    wf.startImages = [];

    await runPromptForPhase({
      taskId,
      phase,
      prompt,
      sessionId: sessionId || null,
      imagePaths,
    });
    sendWorkflowEvent(send, { type: "phase_completed", phase });

    const latestState = await readState(taskId);
    updatePhaseStatus(latestState, phase, "completed");
    if (!isAutoPhase(phase)) {
      await publishCheckpointArtifacts(taskId, phase, latestState);
    }
    const next = nextPhase(phase);
    if (next) {
      latestState.currentPhase = next;
      if (!isAutoPhase(next)) {
        updatePhaseStatus(latestState, next, "awaiting_input");
        latestState.overallStatus = "awaiting_input";
        upsertTask(latestState.originalWorkFolder || workFolder, taskId, "awaiting_input").catch(() => {});
      } else {
        updatePhaseStatus(latestState, next, "in_progress");
      }
    } else {
      latestState.overallStatus = "completed";
      latestState.currentPhase = "completed";
      if (latestState.worktree?.enabled && latestState.worktree.removeOnComplete) {
        await removeWorktree(latestState.worktree).catch(() => {});
      }
      upsertTask(latestState.originalWorkFolder || workFolder, taskId, "completed").catch(() => {});
    }
    await writeState(taskId, latestState);
    sendWorkflowEvent(send, { type: "state", state: latestState });

    let artifact = await readArtifact(taskId, phase);
    if (!artifact) {
      const messages = await readPhaseMessages(taskId, phase);
      if (messages) artifact = messages;
    }
    if (artifact) sendWorkflowEvent(send, { type: "phase_artifact", phase, content: artifact });

    if (next && !isAutoPhase(next)) {
      const content = await getPhaseContent(taskId, next);
      if (content) sendWorkflowEvent(send, { type: "phase_content", phase: next, content });
    }

    if (next && isAutoPhase(next)) {
      runPhase(taskId, next);
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
    sendWorkflowEvent(send, { type: "error", message: err.message });
  }
}

export async function continuePhaseConversation(taskId, phase, prompt, imagePaths = []) {
  const wf = activeWorkflows.get(taskId);
  if (!wf) return;
  await runPromptForPhase({
    taskId,
    phase,
    prompt,
    sessionId: wf.phaseSessionIds[phase] || null,
    imagePaths,
  });
}
