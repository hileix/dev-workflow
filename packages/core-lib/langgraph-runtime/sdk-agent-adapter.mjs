import { query } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, extname, join, relative, resolve } from "path";
import { readManagedSkillContentSync } from "../../core-models/skills.mjs";
import { createContentPreview, createContentSummary, formatStepOutputForPrompt } from "./artifacts.mjs";

const SDK_BACKENDS = {
  CLAUDE: "claude",
  CODEX: "codex",
};

function isPathInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (rel && !rel.startsWith("..") && !rel.startsWith("/"));
}

function renderTemplate(template, state) {
  const contextValues = state.contextValues || {};
  const vars = {
    taskId: state.taskId || "",
    runId: state.runId || "",
    workFolder: state.workFolder || "",
    taskDir: state.taskDir || "",
    ...contextValues,
  };
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function readSkillContent(ref, readSkillContentSync) {
  const content = readSkillContentSync(ref);
  return content ? String(content).trim() : "";
}

function renderStepInputs(step, state) {
  const parts = [];
  const contextValues = state.contextValues || {};
  const stepOutputs = state.stepOutputs || {};

  for (const input of step.inputs || []) {
    if (input.sourceType === "workflow_context") {
      parts.push(`## ${input.name}\n\n${contextValues[input.name] || ""}`);
      continue;
    }

    if (input.sourceType === "step_output") {
      const output = stepOutputs[input.stepId];
      parts.push([
        `## ${input.name}`,
        output?.summary ? `Summary: ${output.summary}` : "",
        output?.artifactPath ? `Artifact: ${output.artifactPath}` : "",
        output?.contentPreview ? ["", "Preview:", output.contentPreview].join("\n") : "",
      ].filter(Boolean).join("\n"));
    }
  }

  return parts.filter(Boolean).join("\n\n");
}

function buildPrompt({ step, agent, state, readSkillContentSync }) {
  const parts = [];
  const pendingMessage = String(state.pendingMessages?.[step.id] || "").trim();
  const agentSkill = agent.skill ? readSkillContent(agent.skill, readSkillContentSync) : "";
  if (agentSkill) parts.push(agentSkill);

  if (pendingMessage) {
    parts.push(["# User feedback", "", pendingMessage].join("\n"));
  }

  if (step.instructions) parts.push(renderTemplate(step.instructions, state));

  const stepSkill = step.skill ? readSkillContent(step.skill, readSkillContentSync) : "";
  if (stepSkill) parts.push(stepSkill);

  if (step.prompt) parts.push(renderTemplate(step.prompt, state));

  const stepInputs = renderStepInputs(step, state);
  if (stepInputs) parts.push(["# Declared inputs", "", stepInputs].join("\n"));

  const previousOutputs = Object.entries(state.stepOutputs || {})
    .map(([stepId, output]) => formatStepOutputForPrompt(stepId, output))
    .filter(Boolean)
    .join("\n\n");

  parts.push([
    "# Runtime context",
    "",
    `Task ID: ${state.taskId || ""}`,
    `Run ID: ${state.runId || ""}`,
    `Current step: ${step.id}`,
    `Task directory: ${state.taskDir || ""}`,
    "",
    "## Workflow context",
    "",
    JSON.stringify(state.contextValues || {}, null, 2),
    previousOutputs ? `\n## Previous step outputs\n\n${previousOutputs}` : "",
  ].filter(Boolean).join("\n"));

  return parts.filter(Boolean).join("\n\n");
}

function guessImageMediaType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

async function buildClaudePrompt(prompt, imagePaths) {
  if (!imagePaths || imagePaths.length === 0) return prompt;

  const content = [];
  if (prompt) content.push({ type: "text", text: prompt });

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
  if (prompt) input.push({ type: "text", text: prompt });
  for (const imagePath of imagePaths) input.push({ type: "local_image", path: imagePath });
  return input;
}

function buildCodexEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "CODEX_API_KEY") env[key] = value;
  }
  return env;
}

function getToolFilePath(input) {
  return input?.file_path || input?.path || input?.notebook_path || "";
}

function formatClaudeToolLog(name, input) {
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

function canWriteWorkspace(step, agent) {
  return step.workspaceAccess === "write" || (!step.workspaceAccess && agent.workspaceAccess === "write");
}

function createReadOnlyClaudeToolGuard(workFolder, taskDir) {
  const readTools = new Set(["Read", "Grep", "Glob", "LS"]);
  const writeTools = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

  return async (toolName, input) => {
    if (readTools.has(toolName)) {
      const filePath = String(getToolFilePath(input) || "");
      if (!filePath || isPathInside(workFolder, filePath) || isPathInside(taskDir, filePath)) {
        return { behavior: "allow" };
      }
      return { behavior: "deny", message: "This step can only read the project workspace and task files." };
    }

    if (writeTools.has(toolName)) {
      const filePath = String(getToolFilePath(input) || "");
      if (filePath && isPathInside(taskDir, filePath)) return { behavior: "allow" };
      return { behavior: "deny", message: "This step can only write its own task artifact files." };
    }

    return { behavior: "deny", message: "This step is read-only for the workspace." };
  };
}

async function streamClaudeSdk({ prompt, workFolder, taskDir, sessionId, imagePaths, abortController, workspaceWrite, agent, onText, onTool, onSession }) {
  const promptInput = await buildClaudePrompt(prompt, imagePaths);
  const stream = query({
    prompt: promptInput,
    options: {
      cwd: workFolder,
      resume: sessionId || undefined,
      abortController,
      additionalDirectories: workspaceWrite ? undefined : [taskDir],
      includePartialMessages: true,
      permissionMode: workspaceWrite ? "bypassPermissions" : "dontAsk",
      allowDangerouslySkipPermissions: workspaceWrite ? true : undefined,
      canUseTool: workspaceWrite ? undefined : createReadOnlyClaudeToolGuard(workFolder, taskDir),
      systemPrompt: { type: "preset", preset: "claude_code" },
      tools: workspaceWrite ? { type: "preset", preset: "claude_code" } : ["Read", "Grep", "Glob", "LS", "Write", "Edit", "MultiEdit", "NotebookEdit"],
      settingSources: ["user", "project", "local"],
      model: agent.model || undefined,
      ...(agent.options || {}),
    },
  });

  let currentTool = null;
  let toolInputJson = "";
  let fallbackResult = "";
  let nextSessionId = "";

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
        await onTool(formatClaudeToolLog(currentTool, toolInputJson));
        currentTool = null;
        toolInputJson = "";
      }
      continue;
    }

      if (message.type === "result") {
        if (message.session_id) {
          nextSessionId = message.session_id;
          await onSession(nextSessionId);
        }
      if (message.subtype !== "success") {
        const details = Array.isArray(message.errors) && message.errors.length > 0
          ? message.errors.join("; ")
          : message.result || "Claude run failed";
        throw new Error(details);
      }
      fallbackResult = message.result || "";
    }
  }

  return { sessionId: nextSessionId || sessionId || "", fallbackResult };
}

async function streamCodexSdk({ prompt, workFolder, sessionId, imagePaths, abortController, workspaceWrite, agent, onText, onTool, onSession }) {
  const codex = new Codex({
    env: buildCodexEnv(),
    ...(agent.options?.client || {}),
  });
  const threadOptions = {
    workingDirectory: workFolder,
    sandboxMode: workspaceWrite ? "danger-full-access" : "read-only",
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    networkAccessEnabled: true,
    model: agent.model || undefined,
    ...(agent.options?.thread || {}),
  };
  const thread = sessionId
    ? codex.resumeThread(sessionId, threadOptions)
    : codex.startThread(threadOptions);
  const input = buildCodexInput(prompt, imagePaths);
  const { events } = await thread.runStreamed(input, { signal: abortController.signal });
  const seenItemText = new Map();
  const seenToolItems = new Set();
  let completed = false;

  for await (const event of events) {
    if (event.type === "turn.completed") {
      completed = true;
      break;
    }

    if (event.type === "thread.started") {
      await onSession(event.thread_id);
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

    if (event.type === "turn.failed") throw new Error(event.error?.message || "Codex run failed");
    if (event.type === "error") throw new Error(event.message || "Codex run failed");
  }

  if (thread.id) await onSession(thread.id);
  return { sessionId: thread.id || sessionId || "", completed };
}

function resolveOutputPath(taskDir, step, state) {
  const filename = renderTemplate(step.output?.filename || "", state);
  if (!filename) return "";
  const outputPath = resolve(taskDir, filename);
  if (!isPathInside(taskDir, outputPath)) throw new Error(`step ${step.id} output filename escapes taskDir`);
  return outputPath;
}

async function writeOutputArtifact(taskDir, step, state, content) {
  const outputPath = resolveOutputPath(taskDir, step, state);
  if (!outputPath || content === undefined) return "";
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf-8");
  return outputPath;
}

export function createSdkAgentAdapter(options = {}) {
  const readSkillContentSync = options.readSkillContentSync || readManagedSkillContentSync;
  const onEvent = options.onEvent || (() => {});

  return {
    async runAgent({ step, agent, state, sessionId, sessionKey }) {
      const backend = String(agent.backend || "").trim();
      const workFolder = state.workFolder || options.workFolder || process.cwd();
      const taskDir = state.taskDir || options.taskDir || workFolder;
      const imagePaths = options.imagePaths || state.imagePaths || [];
      const abortController = options.abortController || new AbortController();
      const workspaceWrite = canWriteWorkspace(step, agent);
      const prompt = buildPrompt({ step, agent, state, readSkillContentSync });
      let content = "";
      let nextSessionId = sessionId || "";

      const callbacks = {
        onText: async (text) => {
          content += text;
          await onEvent({ type: "text_delta", step: step.id, phase: step.id, backend, text });
        },
        onTool: async (log) => {
          await onEvent({ type: "tool_use", step: step.id, phase: step.id, backend, log });
        },
        onSession: async (value) => {
          if (!value) return;
          nextSessionId = value;
          await onEvent({ type: "session_attached", step: step.id, phase: step.id, sessionKey: sessionKey || step.contextGroup || step.id, backend, sessionId: value });
        },
      };

      if (backend === SDK_BACKENDS.CLAUDE) {
        const result = await streamClaudeSdk({
          prompt,
          workFolder,
          taskDir,
          sessionId,
          imagePaths,
          abortController,
          workspaceWrite,
          agent,
          ...callbacks,
        });
        nextSessionId = result.sessionId || nextSessionId;
        if (!content && result.fallbackResult) content = result.fallbackResult;
      } else if (backend === SDK_BACKENDS.CODEX) {
        const result = await streamCodexSdk({
          prompt,
          workFolder,
          sessionId,
          imagePaths,
          abortController,
          workspaceWrite,
          agent,
          ...callbacks,
        });
        nextSessionId = result.sessionId || nextSessionId;
      } else {
        throw new Error(`unsupported SDK agent backend ${backend}`);
      }

      const artifactPath = await writeOutputArtifact(taskDir, step, state, content);
      const summary = createContentSummary(content);
      const contentPreview = createContentPreview(content);
      if (artifactPath) {
        await onEvent({ type: "artifact_written", step: step.id, phase: step.id, backend, artifactPath, summary, contentPreview });
      }

      return {
        sessionId: nextSessionId,
        content,
        summary,
        contentPreview,
        artifactPath,
      };
    },
  };
}
