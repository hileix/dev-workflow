import { randomUUID } from "crypto";
import { PassThrough, Writable } from "stream";
import { execFile } from "child_process";
import { createRequire } from "module";
import readline from "readline";
import { readFile } from "fs/promises";
import { extname, join, relative, resolve } from "path";
import { spawn as spawnPty } from "node-pty";
import { EventEmitter } from "events";
import { createContentPreview, createContentSummary, formatStepOutputForPrompt } from "./artifacts";
import { getStorageDir } from "../../core-models/config";

const SDK_BACKENDS = {
  CLAUDE: "claude",
  CODEX: "codex",
};
const require = createRequire(import.meta.url);
const PTY_TERM_NAME = "xterm-256color";
const AGENT_ENV_EXCLUDES = new Set([
  "NODE_OPTIONS",
  "ELECTRON_RUN_AS_NODE",
  "CODEX_API_KEY",
  "CODEX_CI",
  "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
  "CODEX_MANAGED_BY_BUN",
  "CODEX_MANAGED_PACKAGE_ROOT",
  "CODEX_THREAD_ID",
]);
const SHELL_ENV_MARKER = "__DEV_WORKFLOW_SHELL_ENV__";
const SHELL_ENV_TIMEOUT_MS = 5000;
const shellEnvCache = new Map();
const liveAgentSessions = new Map();

function createLiveAgentSession(sessionId, processHandle, backend) {
  const session = {
    backend,
    process: processHandle,
    sessionId,
  };
  liveAgentSessions.set(sessionId, session);
  return session;
}

function getLiveAgentSession(sessionId) {
  return liveAgentSessions.get(sessionId) || null;
}

function dropLiveAgentSession(sessionId) {
  liveAgentSessions.delete(sessionId);
}

export function sendInteractiveSessionInput(sessionId, value) {
  const session = getLiveAgentSession(sessionId);
  if (!session?.process?.stdin || session.process.stdin.destroyed) return false;
  const text = String(value || "");
  if (!text) return true;
  session.process.stdin.write(text.endsWith("\r") || text.endsWith("\n") ? text : `${text}\r`);
  return true;
}

export function writeInteractiveSessionInput(sessionId, value) {
  const session = getLiveAgentSession(sessionId);
  if (!session?.process?.stdin || session.process.stdin.destroyed) return false;
  const text = String(value || "");
  if (!text) return true;
  session.process.stdin.write(text);
  return true;
}

export function resizeInteractiveSession(sessionId, cols, rows) {
  const session = getLiveAgentSession(sessionId);
  if (!session?.process?.resize) return false;
  session.process.resize(cols, rows);
  return true;
}

export function interruptInteractiveSession(sessionId) {
  const session = getLiveAgentSession(sessionId);
  if (!session?.process?.stdin || session.process.stdin.destroyed) return false;
  try {
    session.process.stdin.write("\x03");
    return true;
  } catch {
    return false;
  }
}

export function closeInteractiveSession(sessionId) {
  const session = getLiveAgentSession(sessionId);
  if (!session) return false;
  try {
    session.process.kill("SIGTERM");
  } catch {}
  dropLiveAgentSession(sessionId);
  return true;
}

export async function runInteractiveAgentSession(options = {}) {
  return await streamInteractiveCli(options);
}

function isPathInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (rel && !rel.startsWith("..") && !rel.startsWith("/"));
}

function renderTemplate(template, state) {
  const taskInputs = state.taskInputs || {};
  const vars = {
    taskId: state.taskId || "",
    runId: state.runId || "",
    workFolder: state.workFolder || "",
    taskDir: state.taskDir || "",
    ...taskInputs,
  };
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function renderStepInputs(step, state) {
  const parts = [];
  const taskInputs = state.taskInputs || {};
  const stepOutputs = state.stepOutputs || {};

  for (const input of step.inputs || []) {
    if (input.sourceType === "task_input") {
      parts.push(`## ${input.name}\n\n${taskInputs[input.name] || ""}`);
      continue;
    }

    if (input.sourceType === "step_output") {
      const output = stepOutputs[input.stepId]?.outputs?.[input.outputKey] || stepOutputs[input.stepId];
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

function buildPrompt({ step, state }) {
  const parts = [];
  const pendingMessage = String(state.pendingMessages?.[step.id] || "").trim();
  const pendingImageCount = state.pendingImagePaths?.[step.id]?.length || 0;

  if (pendingMessage) {
    parts.push(["# User feedback", "", pendingMessage].join("\n"));
  }

  if (pendingImageCount > 0) {
    parts.push(["# Attached images", "", `The user attached ${pendingImageCount} image${pendingImageCount === 1 ? "" : "s"} for this step.`].join("\n"));
  }

  if (step.instructions) parts.push(renderTemplate(step.instructions, state));

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
    "## Task inputs",
    "",
    JSON.stringify(state.taskInputs || {}, null, 2),
    previousOutputs ? `\n## Previous step outputs\n\n${previousOutputs}` : "",
  ].filter(Boolean).join("\n"));

  return parts.filter(Boolean).join("\n\n");
}

function buildWorkspaceAccessPrompt(workspaceWrite, workFolder, taskDir) {
  if (workspaceWrite) return "";
  return [
    "# Workspace access",
    "",
    "The project workspace is read-only for this step.",
    `You may read files in: ${workFolder || ""}`,
    `You may write only task artifact files under: ${taskDir || ""}`,
    "Do not create, edit, move, or delete files in the project workspace.",
  ].join("\n");
}

function buildInteractivePrompt(prompt, imagePaths = []) {
  const parts = [String(prompt || "").trim()].filter(Boolean);
  if (Array.isArray(imagePaths) && imagePaths.length > 0) {
    parts.push([
      "# Attached images",
      "",
      ...imagePaths.map((imagePath, index) => `${index + 1}. ${imagePath}`),
    ].join("\n"));
  }
  return parts.join("\n\n");
}

function guessImageMediaType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function getShellArgs(shell, command) {
  return ["-lc", command];
}

function sanitizeAgentEnv(source = {}) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || AGENT_ENV_EXCLUDES.has(key)) continue;
    env[key] = value;
  }
  return env;
}

function parseShellEnv(raw) {
  const entries = String(raw || "").split("\0");
  const markerIndex = entries.indexOf(SHELL_ENV_MARKER);
  if (markerIndex < 0) return {};
  const env = {};
  for (const entry of entries.slice(markerIndex + 1)) {
    const index = entry.indexOf("=");
    if (index <= 0) continue;
    env[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return env;
}

function readUserShellEnv(workFolder) {
  const shell = process.env.SHELL || "/bin/sh";
  const cwd = workFolder || process.cwd();
  const cacheKey = `${shell}:${cwd}`;
  if (shellEnvCache.has(cacheKey)) return shellEnvCache.get(cacheKey);

  const command = `printf '${SHELL_ENV_MARKER}\\0'; env -0`;
  const promise = new Promise((resolve) => {
    execFile(shell, getShellArgs(shell, command), {
      cwd,
      env: sanitizeAgentEnv(process.env),
      maxBuffer: 1024 * 1024,
      timeout: SHELL_ENV_TIMEOUT_MS,
    }, (error, stdout) => {
      if (error) {
        resolve({});
        return;
      }
      resolve(parseShellEnv(stdout));
    });
  });
  shellEnvCache.set(cacheKey, promise);
  return promise;
}

async function buildAgentEnv(workFolder, extraEnv = {}) {
  const shellEnv = await readUserShellEnv(workFolder);
  return sanitizeAgentEnv({
    ...process.env,
    ...shellEnv,
    ...extraEnv,
  });
}

function createSpawnedProcessFromPty(command, args, options = {}) {
  const pty = spawnPty(command, args, {
    cwd: options.cwd || process.cwd(),
    env: sanitizeAgentEnv(options.env || process.env),
    name: PTY_TERM_NAME,
    cols: 80,
    rows: 24,
  });
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  let killed = false;
  let exitCode = null;
  let closed = false;

  const closeStdout = () => {
    if (closed) return;
    closed = true;
    stdout.end();
  };

  const killPty = (signal = "SIGTERM") => {
    if (closed) return true;
    closed = true;
    closeStdout();
    try {
      pty.kill(signal);
      return true;
    } catch (error) {
      emitter.emit("error", error);
      return false;
    }
  };

  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      if (closed) {
        callback(new Error("PTY process is closed"));
        return;
      }
      try {
        pty.write(chunk);
        callback();
      } catch (error) {
        callback(error);
      }
    },
    final(callback) {
      try {
        pty.write("\x04");
      } catch {}
      callback();
    },
  });

  pty.onData((chunk) => {
    if (closed || stdout.destroyed) return;
    stdout.write(chunk);
  });

  pty.onExit((event) => {
    killed = true;
    exitCode = event.exitCode ?? null;
    closeStdout();
    emitter.emit("exit", exitCode, event.signal ?? null);
  });

  if (options.signal) {
    if (options.signal.aborted) {
      killPty("SIGINT");
    } else {
      options.signal.addEventListener("abort", () => {
        killPty("SIGINT");
      }, { once: true });
    }
  }

  return {
    stdin,
    stdout,
    get killed() {
      return killed;
    },
    get exitCode() {
      return exitCode;
    },
    kill: killPty,
    resize(cols, rows) {
      try {
        pty.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
        return true;
      } catch {
        return false;
      }
    },
    on(event, listener) {
      emitter.on(event, listener);
    },
    once(event, listener) {
      emitter.once(event, listener);
    },
    off(event, listener) {
      emitter.off(event, listener);
    },
  };
}

function createCodexSpawnedProcess(command, args, options = {}) {
  return createSpawnedProcessFromPty(command, args, options);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function createPipedPtyProcess(command, args, input, options = {}) {
  const shell = process.env.SHELL || "/bin/sh";
  const script = [
    "printf '%s\\n'",
    shellQuote(input),
    "|",
    shellQuote(command),
    ...args.map(shellQuote),
  ].join(" ");
  return createSpawnedProcessFromPty(shell, ["-lc", script], options);
}

async function buildClaudeUserMessage(prompt, imagePaths) {
  const content = [];
  if (prompt) content.push({ type: "text", text: prompt });

  for (const imagePath of imagePaths || []) {
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

  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content,
    },
  };
}

function getClaudeCliPath() {
  const platformPackage = {
    "darwin-arm64": "@anthropic-ai/claude-agent-sdk-darwin-arm64",
    "darwin-x64": "@anthropic-ai/claude-agent-sdk-darwin-x64",
    "linux-arm64": "@anthropic-ai/claude-agent-sdk-linux-arm64",
    "linux-x64": "@anthropic-ai/claude-agent-sdk-linux-x64",
    "win32-arm64": "@anthropic-ai/claude-agent-sdk-win32-arm64",
    "win32-x64": "@anthropic-ai/claude-agent-sdk-win32-x64",
  }[`${process.platform}-${process.arch}`];

  if (!platformPackage) return "claude";

  try {
    const packagePath = require.resolve(`${platformPackage}/package.json`);
    return join(packagePath, "..", process.platform === "win32" ? "claude.exe" : "claude");
  } catch {
    return "claude";
  }
}

function getCodexCliPath() {
  const platformPackage = {
    "darwin-arm64": "@openai/codex-darwin-arm64",
    "darwin-x64": "@openai/codex-darwin-x64",
    "linux-arm64": "@openai/codex-linux-arm64",
    "linux-x64": "@openai/codex-linux-x64",
    "win32-arm64": "@openai/codex-win32-arm64",
    "win32-x64": "@openai/codex-win32-x64",
  }[`${process.platform}-${process.arch}`];

  if (!platformPackage) return "codex";

  try {
    const packagePath = require.resolve(`${platformPackage}/package.json`);
    const targetTriple = {
      "darwin-arm64": "aarch64-apple-darwin",
      "darwin-x64": "x86_64-apple-darwin",
      "linux-arm64": "aarch64-unknown-linux-musl",
      "linux-x64": "x86_64-unknown-linux-musl",
      "win32-arm64": "aarch64-pc-windows-msvc",
      "win32-x64": "x86_64-pc-windows-msvc",
    }[`${process.platform}-${process.arch}`];
    if (!targetTriple) return "codex";
    return join(packagePath, "..", "vendor", targetTriple, "codex", process.platform === "win32" ? "codex.exe" : "codex");
  } catch {
    try {
      return require.resolve("@openai/codex/bin/codex.js");
    } catch {
      return "codex";
    }
  }
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

async function streamInteractiveCli({
  backend,
  prompt,
  workFolder,
  taskDir,
  sessionId,
  imagePaths,
  abortController,
  workspaceWrite,
  agent,
  onText,
  onSession,
}) {
  const env = await buildAgentEnv(workFolder);
  const liveSessionId = sessionId || randomUUID();
  const command = backend === SDK_BACKENDS.CODEX ? getCodexCliPath() : getClaudeCliPath();
  const args = [];

  // 为 Codex 和 Claude 创建项目级别的 Stop hook 来检测完成
  let projectHooksPath = null;
  let hookCompletionPromise = null;
  let completionMarkerPath = null;
  let actualSessionId = null;

  // 两者都支持项目级别的 hooks
  const { writeFile, mkdir, access, unlink } = await import("fs/promises");
  const { tmpdir } = await import("os");

  const hookDir = join(tmpdir(), "dev-workflow-hooks");
  await mkdir(hookDir, { recursive: true });
  completionMarkerPath = join(hookDir, `completed-${liveSessionId}.txt`);

  // 在项目目录下创建 .claude/settings.json（不是 hooks.json）
  const projectConfigDir = backend === SDK_BACKENDS.CODEX
    ? join(workFolder, ".codex")
    : join(workFolder, ".claude");
  projectHooksPath = join(projectConfigDir, "settings.json");

  try {
    await mkdir(projectConfigDir, { recursive: true });

    // 创建项目级别的 hooks 配置
    // 根据官方文档，hooks 应该在 settings.json 中，并且需要额外的 hooks 数组嵌套
    const projectHooksConfig = {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `touch "${completionMarkerPath}"`,
                timeout: 5
              }
            ]
          }
        ]
      }
    };

    await writeFile(projectHooksPath, JSON.stringify(projectHooksConfig, null, 2));
  } catch (error) {
    console.warn("Failed to create project hooks:", error);
  }

  // 创建一个 Promise 来监听完成标记文件
  hookCompletionPromise = new Promise((resolve) => {
    const checkInterval = setInterval(async () => {
      try {
        // 如果我们已经知道了实际的 sessionId，也检查那个文件
        if (actualSessionId && actualSessionId !== liveSessionId) {
          const actualMarkerPath = join(hookDir, `completed-${actualSessionId}.txt`);
          try {
            await access(actualMarkerPath);
            clearInterval(checkInterval);
            resolve({ code: 0, signal: null, reason: "hook_completed" });
            return;
          } catch {}
        }

        // 检查原始的 liveSessionId 文件
        await access(completionMarkerPath);
        clearInterval(checkInterval);
        resolve({ code: 0, signal: null, reason: "hook_completed" });
      } catch {
        // 文件还不存在，继续等待
      }
    }, 500);

    // 30分钟超时
    setTimeout(() => {
      console.warn("[Hook Debug] ⏰ Hook completion timeout (30 minutes)");
      clearInterval(checkInterval);
      resolve({ code: 0, signal: null, reason: "hook_timeout" });
    }, 30 * 60 * 1000);
  });

  if (backend === SDK_BACKENDS.CODEX) {
    args.push(
      "--no-alt-screen",
      "--sandbox",
      "danger-full-access",
      "--cd",
      workFolder || process.cwd(),
      "--config",
      "approval_policy=\"never\"",
      "--config",
      "sandbox_workspace_write.network_access=true",
    );
    const modelReasoningEffort = agent.options?.thread?.modelReasoningEffort || "";
    if (agent.model) args.push("--model", agent.model);
    if (modelReasoningEffort) args.push("--config", `model_reasoning_effort="${modelReasoningEffort}"`);
    for (const imagePath of imagePaths || []) args.push("--image", imagePath);
  } else {
    args.push(
      "--permission-mode",
      "bypassPermissions",
      "--setting-sources",
      "user,project,local",
      "--dangerously-skip-permissions",
    );
    if (agent.model) args.push("--model", agent.model);
    const maxTurns = agent.options?.maxTurns ?? 50;
    args.push("--max-turns", String(maxTurns));
  }

  const interactivePrompt = buildInteractivePrompt(prompt, backend === SDK_BACKENDS.CODEX ? imagePaths : []);
  if (interactivePrompt) args.push(interactivePrompt);

  const child = createSpawnedProcessFromPty(command, args, {
    cwd: workFolder || process.cwd(),
    env,
    signal: abortController.signal,
  });
  if (!child.stdout) throw new Error(`${backend} CLI has no stdout`);

  createLiveAgentSession(liveSessionId, child, backend);
  await onSession(liveSessionId);

  // 监听输出以捕获实际的 session ID
  // Claude Code 在启动时会输出 session ID
  let sessionIdCaptured = false;

  let transcript = "";
  const output = [];
  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  const stdout = child.stdout;
  const onData = async (chunk) => {
    const text = String(chunk || "");
    if (!text) return;
    output.push(text);
    transcript += text;

    // 尝试从输出中捕获 session ID
    // Claude Code 输出格式可能包含 session ID
    if (!sessionIdCaptured) {
      // 匹配 UUID 格式的 session ID
      const sessionIdMatch = text.match(/session[_\s-]?id[:\s]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
      if (sessionIdMatch) {
        const capturedSessionId = sessionIdMatch[1];
        if (capturedSessionId !== liveSessionId) {
          actualSessionId = capturedSessionId;
          sessionIdCaptured = true;

          // 更新 hook 配置
          const actualMarkerPath = join(hookDir, `completed-${actualSessionId}.txt`);

          try {
            const projectHooksConfig = {
              hooks: {
                Stop: [
                  {
                    hooks: [
                      {
                        type: "command",
                        command: `touch "${actualMarkerPath}"`,
                        timeout: 5
                      }
                    ]
                  }
                ]
              }
            };
            await writeFile(projectHooksPath, JSON.stringify(projectHooksConfig, null, 2));
          } catch (error) {
            console.warn("Failed to update hooks with captured sessionId:", error);
          }
        }
      }
    }

    await onText(text);
  };
  const onDataListener = (chunk) => {
    void onData(chunk);
  };

  stdout.on("data", onDataListener);

  try {
    const promises = [exitPromise];

    // 只使用 hook 检测
    if (hookCompletionPromise) {
      promises.push(hookCompletionPromise);
    }

    const result = await Promise.race(promises);

    if (result.reason === "hook_completed") {
      // Hook 检测到完成，主动关闭进程
      try {
        child.kill("SIGTERM");
      } catch {}
    } else if (result.reason === "hook_timeout") {
      // Hook 超时（30分钟）
      console.warn("Hook completion timeout, force closing process");
      try {
        child.kill("SIGTERM");
      } catch {}
    } else if (result.code !== 0 || result.signal) {
      const detail = result.signal ? `signal ${result.signal}` : `code ${result.code ?? 1}`;
      throw new Error(`${backend} CLI exited with ${detail}: ${output.join("")}`);
    }
  } finally {
    stdout.off("data", onDataListener);
    dropLiveAgentSession(liveSessionId);

    // 清理项目级别的 settings.json 文件
    if (projectHooksPath) {
      try {
        const { unlink } = await import("fs/promises");
        await unlink(projectHooksPath);
      } catch {}
    }

    // 清理标记文件（可能有两个：liveSessionId 和 actualSessionId）
    try {
      const { unlink } = await import("fs/promises");
      await unlink(completionMarkerPath);
    } catch {}

    if (actualSessionId && actualSessionId !== liveSessionId) {
      try {
        const { unlink } = await import("fs/promises");
        const actualMarkerPath = join(hookDir, `completed-${actualSessionId}.txt`);
        await unlink(actualMarkerPath);
      } catch {}
    }
  }

  return { sessionId: liveSessionId, fallbackResult: transcript };
}

function resolveOutputPath(taskDir, step, state) {
  const filename = renderTemplate(step.outputs?.[0]?.filename || "", state);
  if (!filename) return "";
  const outputPath = resolve(taskDir, filename);
  if (!isPathInside(taskDir, outputPath)) throw new Error(`step ${step.id} output filename escapes taskDir`);
  return outputPath;
}

function resolveDeclaredOutputPath(taskDir, output, state) {
  const filename = renderTemplate(output?.filename || "", state);
  if (!filename) return "";
  const outputPath = resolve(taskDir, filename);
  if (!isPathInside(taskDir, outputPath)) throw new Error(`step output filename escapes taskDir`);
  return outputPath;
}

async function writeOutputArtifact(taskDir, step, state, content) {
  const outputPath = resolveOutputPath(taskDir, step, state);
  if (!outputPath) return "";
  try {
    await readFile(outputPath, "utf-8");
    return outputPath;
  } catch {}
  return "";
}

export function createSdkAgentAdapter(options = {}) {
  const onEvent = options.onEvent || (() => {});

  return {
    async runAgent({ step, agent, state, sessionId, sessionKey }) {
      const backend = String(agent.backend || "").trim();
      const workFolder = state.workFolder || options.workFolder || process.cwd();
      const taskDir = state.taskDir || options.taskDir || workFolder;
      const imagePaths = [
        ...(options.imagePaths || []),
        ...(state.pendingImagePaths?.[step.id] || []),
      ];
      const abortController = options.abortController || new AbortController();
      const workspaceWrite = canWriteWorkspace(step, agent);
      const prompt = [
        buildWorkspaceAccessPrompt(workspaceWrite, workFolder, taskDir),
        buildPrompt({ step, state }),
      ].filter(Boolean).join("\n\n");
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
          await onEvent({ type: "session_attached", step: step.id, phase: step.id, sessionKey: sessionKey || step.id, backend, sessionId: value });
        },
      };

      if (backend === SDK_BACKENDS.CLAUDE || backend === SDK_BACKENDS.CODEX) {
        const result = await runInteractiveAgentSession({
          backend,
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
      } else {
        throw new Error(`unsupported SDK agent backend ${backend}`);
      }

      const artifactPath = await writeOutputArtifact(taskDir, step, state, content);
      let artifactContent = content;
      if (artifactPath) {
        try {
          artifactContent = await readFile(artifactPath, "utf-8");
        } catch {}
      }
      const summary = createContentSummary(artifactContent);
      const contentPreview = createContentPreview(artifactContent);
      const outputs = {};
      for (const output of step.outputs || []) {
        const outputPath = resolveDeclaredOutputPath(taskDir, output, state);
        if (!outputPath) continue;
        outputs[output.key] = {
          kind: output.kind || "markdown",
          summary,
          contentPreview,
          artifactPath: outputPath,
          status: artifactPath && resolve(outputPath) === resolve(artifactPath) ? "ready" : "pending",
        };
      }
      if (artifactPath) {
        await onEvent({ type: "artifact_written", step: step.id, phase: step.id, backend, artifactPath, summary, contentPreview });
      }

      return {
        sessionId: nextSessionId,
        content,
        summary,
        contentPreview,
        artifactPath,
        outputs,
      };
    },
  };
}
