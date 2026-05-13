import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  desktopApi: {},
}));

vi.mock("./lib/api-client", () => ({
  getAppApi: () => mocks.desktopApi,
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    Background: () => null,
    BaseEdge: () => null,
    Controls: () => null,
    Handle: () => null,
    MarkerType: { ArrowClosed: "arrowclosed" },
    MiniMap: () => null,
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    ReactFlow: ({ children }) => <div data-testid="workflow-canvas">{children}</div>,
    useNodesState: (initialNodes) => {
      const [nodes, setNodes] = React.useState(initialNodes);
      return [nodes, setNodes, vi.fn()];
    },
  };
});

import WorkflowEditor from "./WorkflowEditor";
import { I18nProvider } from "./components/i18n-provider";
import { useWorkflowEditorStore } from "./stores/workflowEditorStore";

const workflow = {
  id: "default-codex",
  name: "Default Codex",
  visible: true,
  version: 1,
  runtime: {
    engine: "langgraph",
    backend: "codex",
    model: "",
    workspaceAccess: "write",
    options: {},
  },
  ui: {
    layout: "vertical",
    nodePositions: {},
  },
  worktree: {
    enabled: false,
    files: [],
    customFiles: [],
    removeOnComplete: false,
  },
  steps: [
    {
      id: "implement",
      type: "agent",
      label: "Implement",
      prompt: "Implement the requested task.",
      next: "",
      inputs: [],
      outputs: [{ key: "result", kind: "markdown", filename: "result.md" }],
    },
  ],
};

function setupDesktopApi() {
  Object.assign(mocks.desktopApi, {
    getWorkflow: vi.fn().mockResolvedValue(workflow),
    createWorkflow: vi.fn(),
    createWorkflowDraft: vi.fn(),
    updateWorkflow: vi.fn(),
    updateWorkflowDraft: vi.fn(),
  });
}

function renderWorkflowEditor(filename = "default-codex.json") {
  return render(
    <I18nProvider>
      <WorkflowEditor filename={filename} onClose={vi.fn()} onSaved={vi.fn()} />
    </I18nProvider>
  );
}

describe("WorkflowEditor", () => {
  beforeEach(() => {
    sessionStorage.clear();
    for (const key of Object.keys(mocks.desktopApi)) {
      delete mocks.desktopApi[key];
    }
    useWorkflowEditorStore.getState().resetEditor();
    setupDesktopApi();
  });

  test("renders while an existing workflow is loading and then hydrates the draft", async () => {
    renderWorkflowEditor();

    expect(screen.getByPlaceholderText("Workflow name")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.desktopApi.getWorkflow).toHaveBeenCalledWith("default-codex.json");
      expect(useWorkflowEditorStore.getState().currentFilename).toBe("default-codex.json");
    });
    expect(screen.getByDisplayValue("Default Codex")).toBeInTheDocument();
  });
});
