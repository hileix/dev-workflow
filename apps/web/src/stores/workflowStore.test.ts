import { describe, expect, test } from "vitest";
import { getPhasesWithRunningPhase, getSelectedPhaseFromWorkflowState, removeTaskRunFromState } from "./workflowStore";

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

  test("resets later phases when an earlier phase starts running again", () => {
    expect(getPhasesWithRunningPhase([
      { id: "implement", status: "completed" },
      { id: "code_review", status: "completed" },
      { id: "risk_gate", status: "completed" },
      { id: "review", status: "awaiting_input" },
      { id: "commit", status: "pending" },
    ], "implement", "now")).toEqual([
      { id: "implement", status: "in_progress", updated: "now" },
      { id: "code_review", status: "pending", updated: "now" },
      { id: "risk_gate", status: "pending", updated: "now" },
      { id: "review", status: "pending", updated: "now" },
      { id: "commit", status: "pending", updated: undefined },
    ]);
  });
});

describe("removeTaskRunFromState", () => {
  test("removes the selected run and leaves other runs for the same task", () => {
    const nextState = removeTaskRunFromState({
      activeTask: "task-1",
      workflowState: { taskId: "task-1", runId: "run-1" },
      workflowStatesByRun: {
        "task-1:run-1": { taskId: "task-1", runId: "run-1" },
        "task-1:run-2": { taskId: "task-1", runId: "run-2" },
      },
      selectedPhaseByRun: { "task-1:run-1": "a", "task-1:run-2": "b" },
      phaseMessagesByRun: { "task-1:run-1": {}, "task-1:run-2": {} },
      phaseOutputArtifactsByRun: { "task-1:run-1": {}, "task-1:run-2": {} },
      phaseInteractionsByRun: { "task-1:run-1": {}, "task-1:run-2": {} },
      isStreamingByRun: { "task-1:run-1": true, "task-1:run-2": false },
      streamingPhaseByRun: { "task-1:run-1": "a", "task-1:run-2": null },
      connectionStateByRun: { "task-1:run-1": "connected", "task-1:run-2": "disconnected" },
      debugEventsByRun: { "task-1:run-1": [], "task-1:run-2": [] },
      lastEventAtByRun: { "task-1:run-1": "now", "task-1:run-2": "later" },
      lastErrorByRun: { "task-1:run-1": { message: "error" }, "task-1:run-2": null },
    }, "task-1", "run-1");

    expect(nextState.activeTask).toBe(null);
    expect(nextState.workflowState).toBe(null);
    expect(nextState.workflowStatesByRun).toEqual({
      "task-1:run-2": { taskId: "task-1", runId: "run-2" },
    });
    expect(nextState.selectedPhaseByRun).toEqual({ "task-1:run-2": "b" });
    expect(nextState.isStreamingByRun).toEqual({ "task-1:run-2": false });
  });

  test("removes all cached runs when no runId is provided", () => {
    const nextState = removeTaskRunFromState({
      activeTask: "task-1",
      workflowState: { taskId: "task-1", runId: "run-1" },
      workflowStatesByRun: {
        "task-1:run-1": { taskId: "task-1", runId: "run-1" },
        "task-1:run-2": { taskId: "task-1", runId: "run-2" },
        "task-2:run-1": { taskId: "task-2", runId: "run-1" },
      },
      selectedPhaseByRun: {},
      phaseMessagesByRun: {},
      phaseOutputArtifactsByRun: {},
      phaseInteractionsByRun: {},
      isStreamingByRun: {},
      streamingPhaseByRun: {},
      connectionStateByRun: {},
      debugEventsByRun: {},
      lastEventAtByRun: {},
      lastErrorByRun: {},
    }, "task-1");

    expect(nextState.workflowStatesByRun).toEqual({
      "task-2:run-1": { taskId: "task-2", runId: "run-1" },
    });
  });
});
