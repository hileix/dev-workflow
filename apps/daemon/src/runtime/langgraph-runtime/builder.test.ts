import { Command } from "@langchain/langgraph";
import { describe, expect, test } from "vitest";
import { buildWorkflowGraphFromDsl, createMemoryCheckpointer } from "./index";

function buildWorkflow() {
  return {
    id: "revision-workflow",
    name: "Revision Workflow",
    version: 1,
    runtime: {
      engine: "langgraph",
      backend: "codex",
      workspaceAccess: "write",
      options: {},
    },
    steps: [
      {
        id: "implement",
        type: "agent",
        label: "Implement",
        next: "code_review",
        prompt: "Implement {{task}}",
        outputs: [{ key: "implementation", kind: "markdown", filename: "implementation.md" }],
      },
      {
        id: "code_review",
        type: "agent",
        label: "Code Review",
        next: "risk_gate",
        prompt: "Review implementation",
        outputs: [{ key: "review", kind: "markdown", filename: "review.md" }],
      },
      {
        id: "risk_gate",
        type: "condition",
        label: "Risk Gate",
        prompt: "Check risk",
        passTo: "review",
        failTo: "implement",
        outputs: [{ key: "risk", kind: "markdown", filename: "risk.md" }],
      },
      {
        id: "review",
        type: "checkpoint",
        label: "Review",
        question: "Approve?",
        approve: "done",
        rejectTo: "implement",
        rejectTargets: ["implement"],
      },
      {
        id: "done",
        type: "end",
        label: "Done",
      },
    ],
  };
}

describe("buildWorkflowGraphFromDsl revision messages", () => {
  test("keeps checkpoint rejection notes on AI steps before the checkpoint", async () => {
    const seenPendingMessages = {
      implement: [],
      code_review: [],
      risk_gate: [],
    };
    let riskRunCount = 0;
    const graph = buildWorkflowGraphFromDsl(buildWorkflow(), {
      async runAgent({ step, state }) {
        if (step.id === "implement") {
          seenPendingMessages.implement.push(state.pendingMessages?.implement || "");
          return {
            content: "implemented",
            sessionId: state.sessionMap?.implement || "implement-session",
          };
        }
        if (step.id === "code_review") {
          seenPendingMessages.code_review.push(state.pendingMessages?.code_review || "");
          return {
            content: "reviewed",
            sessionId: state.sessionMap?.code_review || "code-review-session",
          };
        }

        riskRunCount += 1;
        seenPendingMessages.risk_gate.push(state.pendingMessages?.risk_gate || "");
        return {
          content: riskRunCount === 1 || riskRunCount === 3
            ? "{\"passed\": true}"
            : "{\"passed\": false, \"reason\": \"missing verification\"}",
        };
      },
    }, { checkpointer: createMemoryCheckpointer() });
    const config = { configurable: { thread_id: "revision-test" } };

    await graph.invoke({
      taskId: "task-1",
      runId: "run-1",
      workFolder: "/repo",
      taskDir: "/task",
      currentStep: "implement",
      overallStatus: "in_progress",
      taskInputs: { task: "make it red" },
    }, config);

    await graph.invoke(new Command({
      resume: {
        approved: false,
        rejectTo: "implement",
        notes: "make it green",
      },
    }), config);

    expect(seenPendingMessages).toEqual({
      implement: ["", "make it green", "make it green"],
      code_review: ["", "make it green", "make it green"],
      risk_gate: ["", "make it green", "make it green"],
    });
  });
});
