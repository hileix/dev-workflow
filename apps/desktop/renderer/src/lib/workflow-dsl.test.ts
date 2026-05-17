import { describe, expect, test } from "vitest";
import { validateWorkflowDsl } from "../../../../../packages/core-lib/langgraph-runtime";

function buildWorkflow(overrides = {}) {
  return {
    id: "review-workflow",
    name: "Review Workflow",
    version: 1,
    runtime: {
      engine: "langgraph",
      backend: "claude",
      workspaceAccess: "read",
      options: {},
    },
    steps: [
      {
        id: "review",
        type: "agent",
        label: "Review",
        prompt: "Review the code.",
        next: "gate",
        outputs: [{ key: "review", kind: "markdown", filename: "review.md" }],
      },
      {
        id: "gate",
        type: "condition",
        label: "Review Gate",
        backend: "ai_api",
        aiApiProfileId: "openai",
        prompt: "Return pass or fail.",
        passTo: "done",
        failTo: "review",
      },
      {
        id: "done",
        type: "end",
        label: "Done",
      },
    ],
    ...overrides,
  };
}

describe("validateWorkflowDsl", () => {
  test("normalizes AI API backend and worktree naming fields", () => {
    const workflow = validateWorkflowDsl(buildWorkflow({
      worktree: {
        enabled: true,
        files: [".env"],
        customFiles: [],
        removeOnComplete: false,
        namingProvider: "ai_backend",
        namingAiApiProfileId: "openai",
        useCustomSetupScript: false,
        setupScript: "",
      },
    }));

    expect(workflow.worktree.namingProvider).toBe("ai_backend");
    expect(workflow.worktree.namingAiApiProfileId).toBe("openai");
    expect(workflow.steps[1]).toMatchObject({
      backend: "ai_api",
      aiApiProfileId: "openai",
    });
  });

  test("defaults worktree naming to AI API for new workflow data", () => {
    const workflow = validateWorkflowDsl(buildWorkflow());

    expect(workflow.worktree).toMatchObject({
      enabled: false,
      namingProvider: "ai_api",
      namingAiApiProfileId: "",
    });
  });

  test("rejects unsupported worktree naming providers", () => {
    expect(() => validateWorkflowDsl(buildWorkflow({
      worktree: {
        enabled: true,
        namingProvider: "first-configured-ai-api",
      },
    }))).toThrow("worktree.namingProvider must be ai_api or ai_backend");
  });
});
