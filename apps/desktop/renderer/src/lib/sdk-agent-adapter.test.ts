import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mocks.query,
}));

vi.mock("@openai/codex-sdk", () => ({
  Codex: vi.fn(),
}));

import { createSdkAgentAdapter } from "../../../../../packages/core-lib/langgraph-runtime";

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
    mocks.query.mockReset();
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
});
