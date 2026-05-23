import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawnPty: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: mocks.execFile,
  default: {
    execFile: mocks.execFile,
  },
}));

vi.mock("node-pty", () => ({
  spawn: mocks.spawnPty,
}));

import { createSdkAgentAdapter } from "../../../../../packages/core-lib/langgraph-runtime";

let taskDir = "";

function createMockPty() {
  const pty = new EventEmitter();
  pty.write = vi.fn();
  pty.kill = vi.fn();
  pty.onData = (callback) => {
    pty.on("data", callback);
    return { dispose: () => pty.off("data", callback) };
  };
  pty.onExit = (callback) => {
    pty.on("exit", (exitCode = 0, signal = null) => callback({ exitCode, signal }));
    return { dispose: () => {} };
  };
  pty.resize = vi.fn();
  return pty;
}

function emitClaudeResult(pty, result) {
  pty.emit("data", `${JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session" })}\n`);
  pty.emit("data", `${JSON.stringify({ type: "result", subtype: "success", result, session_id: "claude-session" })}\n`);
  pty.emit("exit", 0, null);
}

function emitCodexResult(pty) {
  pty.emit("data", `${JSON.stringify({ type: "thread.started", thread_id: "codex-thread" })}\n`);
  pty.emit("data", `${JSON.stringify({ type: "item.completed", item: { id: "msg-1", type: "agent_message", text: "Codex response" } })}\n`);
  pty.emit("data", `${JSON.stringify({ type: "turn.completed", usage: null })}\n`);
  pty.emit("exit", 0, null);
}

function buildRun(overrides = {}) {
  return {
    step: {
      id: "review",
      type: "agent",
      prompt: "Review the code.",
      outputs: [{ key: "review", kind: "markdown", filename: "review.md" }],
    },
    agent: {
      backend: "claude",
      workspaceAccess: "read",
      options: {},
    },
    state: {
      taskId: "task-1",
      runId: "run-1",
      workFolder: taskDir,
      taskDir,
      taskInputs: {},
      stepOutputs: {},
    },
    ...overrides,
  };
}

describe("createSdkAgentAdapter output artifacts", () => {
  beforeEach(async () => {
    taskDir = await mkdir(join(tmpdir(), `sdk-agent-adapter-${Date.now()}-`), { recursive: true });
    mocks.execFile.mockReset();
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(null, "__DEV_WORKFLOW_SHELL_ENV__\0PATH=/usr/bin\0"));
    mocks.spawnPty.mockReset();
  });

  afterEach(async () => {
    if (taskDir) await rm(taskDir, { recursive: true, force: true });
    taskDir = "";
  });

  test("does not write AI response into a declared output file", async () => {
    const pty = createMockPty();
    mocks.spawnPty.mockReturnValue(pty);
    const adapter = createSdkAgentAdapter({ workFolder: taskDir, taskDir });

    const runPromise = adapter.runAgent(buildRun());
    await vi.waitFor(() => expect(mocks.spawnPty).toHaveBeenCalled());
    emitClaudeResult(pty, "AI review response");
    const result = await runPromise;

    expect(result.artifactPath).toBe("");
    expect(result.outputs.review.status).toBe("pending");
    expect(result.outputs.review.artifactPath).toBe(join(taskDir, "review.md"));
    await expect(readFile(join(taskDir, "review.md"), "utf-8")).rejects.toThrow();
  });

  test("marks declared output ready only when the file already exists", async () => {
    await writeFile(join(taskDir, "review.md"), "Written by the agent tool", "utf-8");
    const pty = createMockPty();
    mocks.spawnPty.mockReturnValue(pty);
    const adapter = createSdkAgentAdapter({ workFolder: taskDir, taskDir });

    const runPromise = adapter.runAgent(buildRun());
    await vi.waitFor(() => expect(mocks.spawnPty).toHaveBeenCalled());
    emitClaudeResult(pty, "AI review response");
    const result = await runPromise;

    expect(result.artifactPath).toBe(join(taskDir, "review.md"));
    expect(result.summary).toBe("Written by the agent tool");
    expect(result.outputs.review).toMatchObject({
      status: "ready",
      artifactPath: join(taskDir, "review.md"),
      summary: "Written by the agent tool",
    });
  });

  test("runs read-only Codex steps with a writable task directory", async () => {
    const pty = createMockPty();
    mocks.spawnPty.mockReturnValue(pty);
    const adapter = createSdkAgentAdapter({ workFolder: "/project", taskDir });

    const runPromise = adapter.runAgent(buildRun({
      agent: {
        backend: "codex",
        workspaceAccess: "read",
        options: { thread: { modelReasoningEffort: "low" } },
      },
      state: {
        taskId: "task-1",
        runId: "run-1",
        workFolder: "/project",
        taskDir,
        taskInputs: {},
        stepOutputs: {},
      },
    }));

    await vi.waitFor(() => {
      expect(mocks.spawnPty).toHaveBeenCalled();
    });
    emitCodexResult(pty);

    await runPromise;

    expect(mocks.spawnPty).toHaveBeenCalledWith(
      expect.stringContaining("@openai/codex"),
      expect.arrayContaining([
        "--no-alt-screen",
        "--sandbox",
        "workspace-write",
        "--cd",
        "/project",
        "--add-dir",
        taskDir,
        "--config",
        "model_reasoning_effort=\"low\"",
      ]),
      expect.objectContaining({
        cols: 80,
        env: expect.any(Object),
        name: "xterm-256color",
        rows: 24,
      }),
    );
  });
});
