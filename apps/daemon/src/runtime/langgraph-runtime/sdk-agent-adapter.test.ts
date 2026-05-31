import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  query: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mocks.query,
}));

vi.mock("child_process", () => ({
  execFile: mocks.execFile,
  spawn: mocks.spawn,
  default: {
    execFile: mocks.execFile,
    spawn: mocks.spawn,
  },
}));

import { createSdkAgentAdapter } from "./index";

let taskDir = "";

async function* claudeResult(result) {
  yield {
    type: "result",
    subtype: "success",
    result,
    session_id: "claude-session",
  };
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
    mocks.query.mockReset();
    mocks.spawn.mockReset();
  });

  afterEach(async () => {
    if (taskDir) await rm(taskDir, { recursive: true, force: true });
    taskDir = "";
  });

  test("does not write AI response into a declared output file", async () => {
    mocks.query.mockReturnValue(claudeResult("AI review response"));
    const adapter = createSdkAgentAdapter({ workFolder: taskDir, taskDir });

    const result = await adapter.runAgent(buildRun());

    expect(result.artifactPath).toBe("");
    expect(result.outputs.review.status).toBe("pending");
    expect(result.outputs.review.artifactPath).toBe(join(taskDir, "review.md"));
    await expect(readFile(join(taskDir, "review.md"), "utf-8")).rejects.toThrow();
  });

  test("marks declared output ready only when the file already exists", async () => {
    await writeFile(join(taskDir, "review.md"), "Written by the agent tool", "utf-8");
    mocks.query.mockReturnValue(claudeResult("AI review response"));
    const adapter = createSdkAgentAdapter({ workFolder: taskDir, taskDir });

    const result = await adapter.runAgent(buildRun());

    expect(result.artifactPath).toBe(join(taskDir, "review.md"));
    expect(result.summary).toBe("Written by the agent tool");
    expect(result.outputs.review).toMatchObject({
      status: "ready",
      artifactPath: join(taskDir, "review.md"),
      summary: "Written by the agent tool",
    });
  });

  test("runs read-only Codex steps with a writable task directory", async () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    mocks.spawn.mockReturnValue(child);
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
      expect(mocks.spawn).toHaveBeenCalled();
    });
    child.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "codex-thread" })}\n`);
    child.stdout.write(`${JSON.stringify({ type: "item.completed", item: { id: "msg-1", type: "agent_message", text: "Codex response" } })}\n`);
    child.stdout.write(`${JSON.stringify({ type: "turn.completed", usage: null })}\n`);
    child.stdout.end();
    child.emit("exit", 0, null);

    await runPromise;

    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringContaining("@openai/codex"),
      expect.arrayContaining([
        "exec",
        "--json",
        "--sandbox",
        "workspace-write",
        "--cd",
        taskDir,
        "--skip-git-repo-check",
        "--config",
        "model_reasoning_effort=\"low\"",
      ]),
      expect.objectContaining({ env: expect.any(Object), signal: expect.any(AbortSignal) }),
    );
  });

  test("resumes an existing Codex step session with only the pending user message", async () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const stdinChunks = [];
    child.stdin.on("data", (chunk) => stdinChunks.push(Buffer.from(chunk)));
    mocks.spawn.mockReturnValue(child);
    const adapter = createSdkAgentAdapter({ workFolder: "/project", taskDir });

    const runPromise = adapter.runAgent(buildRun({
      agent: {
        backend: "codex",
        workspaceAccess: "write",
        options: {},
      },
      state: {
        taskId: "task-1",
        runId: "run-1",
        workFolder: "/project",
        taskDir,
        taskInputs: { task: "make it red" },
        stepOutputs: {},
        pendingMessages: {
          review: "make it green",
        },
      },
      sessionId: "codex-session",
    }));

    await vi.waitFor(() => {
      expect(mocks.spawn).toHaveBeenCalled();
    });
    child.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "codex-session" })}\n`);
    child.stdout.write(`${JSON.stringify({ type: "item.completed", item: { id: "msg-1", type: "agent_message", text: "Done" } })}\n`);
    child.stdout.write(`${JSON.stringify({ type: "turn.completed", usage: null })}\n`);
    child.stdout.end();
    child.emit("exit", 0, null);

    await runPromise;

    expect(Buffer.concat(stdinChunks).toString("utf-8")).toBe("make it green");
  });
});
