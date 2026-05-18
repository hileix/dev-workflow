import { describe, expect, test } from "vitest";
import { getSelectedPhaseFromWorkflowState } from "./workflowStore";

describe("getSelectedPhaseFromWorkflowState", () => {
  test("prefers the active phase over a stale currentPhase", () => {
    expect(getSelectedPhaseFromWorkflowState({
      currentPhase: "implement",
      phases: [
        { id: "implement", status: "completed" },
        { id: "code_review", status: "in_progress" },
      ],
    })).toBe("code_review");
  });

  test("shows the latest started phase when the run is completed", () => {
    expect(getSelectedPhaseFromWorkflowState({
      currentPhase: "completed",
      phases: [
        { id: "implement", status: "completed" },
        { id: "code_review", status: "completed" },
      ],
    })).toBe("code_review");
  });

  test("falls back to currentPhase when there is no active phase", () => {
    expect(getSelectedPhaseFromWorkflowState({
      currentPhase: "code_review",
      phases: [
        { id: "implement", status: "completed" },
        { id: "code_review", status: "pending" },
      ],
    })).toBe("code_review");
  });
});
