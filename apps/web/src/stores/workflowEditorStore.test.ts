import { beforeEach, describe, expect, test } from "vitest";
import { getWorkflowEditorKey, useWorkflowEditorStore } from "./workflowEditorStore";

function resetStore() {
  sessionStorage.clear();
  useWorkflowEditorStore.getState().resetEditor();
}

describe("workflowEditorStore", () => {
  beforeEach(() => {
    resetStore();
  });

  test("uses a stable key for new and existing workflows", () => {
    expect(getWorkflowEditorKey(null)).toBe("__new__");
    expect(getWorkflowEditorKey("default-codex.json")).toBe("default-codex.json");
  });

  test("initializes workflow editor draft state", () => {
    const workflow = { id: "workflow", name: "Default", steps: [{ id: "implement" }] };

    useWorkflowEditorStore.getState().initializeEditor({
      filename: "default-codex.json",
      workflow,
      selectedIdx: 0,
    });

    const state = useWorkflowEditorStore.getState();
    expect(state.editorKey).toBe("default-codex.json");
    expect(state.currentFilename).toBe("default-codex.json");
    expect(state.selectedIdx).toBe(0);
    expect(state.dirty).toBe(false);
    expect(state.saving).toBe(false);
    expect(state.error).toBe("");
    expect(state.workflow).toEqual(workflow);
  });

  test("supports function updates for workflow and selected node", () => {
    useWorkflowEditorStore.getState().initializeEditor({
      filename: null,
      workflow: { id: "workflow", steps: [] },
      selectedIdx: 0,
    });

    useWorkflowEditorStore.getState().setWorkflow((workflow) => ({
      ...workflow,
      steps: [...workflow.steps, { id: "review" }],
    }));
    useWorkflowEditorStore.getState().setSelectedIdx((selectedIdx) => selectedIdx + 1);
    useWorkflowEditorStore.getState().setDirty(true);

    const state = useWorkflowEditorStore.getState();
    expect(state.workflow.steps).toEqual([{ id: "review" }]);
    expect(state.selectedIdx).toBe(1);
    expect(state.dirty).toBe(true);
  });

  test("resetEditor clears the active draft state", () => {
    useWorkflowEditorStore.getState().initializeEditor({
      filename: "default-codex.json",
      workflow: { id: "workflow", steps: [] },
      selectedIdx: 0,
    });
    useWorkflowEditorStore.getState().setDirty(true);
    useWorkflowEditorStore.getState().setSaving(true);
    useWorkflowEditorStore.getState().setError("Failed");

    useWorkflowEditorStore.getState().resetEditor();

    const state = useWorkflowEditorStore.getState();
    expect(state.editorKey).toBe("");
    expect(state.workflow).toBe(null);
    expect(state.currentFilename).toBe(null);
    expect(state.selectedIdx).toBe(null);
    expect(state.dirty).toBe(false);
    expect(state.saving).toBe(false);
    expect(state.error).toBe("");
  });
});
