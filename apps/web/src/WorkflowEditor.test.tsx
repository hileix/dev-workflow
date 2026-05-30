import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appApi: {},
}));

vi.mock("./lib/api-client", () => ({
  getAppApi: () => mocks.appApi,
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
    enabled: true,
    files: [".env"],
    customFiles: [],
    removeOnComplete: false,
    useCustomSetupScript: false,
    setupScript: "",
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

function setupAppApi() {
  Object.assign(mocks.appApi, {
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
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    sessionStorage.clear();
    for (const key of Object.keys(mocks.appApi)) {
      delete mocks.appApi[key];
    }
    useWorkflowEditorStore.getState().resetEditor();
    setupAppApi();
  });

  test("renders while an existing workflow is loading and then hydrates the draft", async () => {
    renderWorkflowEditor();

    expect(screen.getByPlaceholderText("Workflow name")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.appApi.getWorkflow).toHaveBeenCalledWith("default-codex.json");
      expect(useWorkflowEditorStore.getState().currentFilename).toBe("default-codex.json");
    });
    expect(screen.getByDisplayValue("Default Codex")).toBeInTheDocument();
  });

  test("uses the built-in worktree setup until custom setup is enabled", async () => {
    const user = userEvent.setup();
    renderWorkflowEditor();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Default Codex")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Workflow Setup" }));

    expect(screen.getByText(".env")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("pnpm install")).not.toBeInTheDocument();

    const customSetup = screen.getByText("Use custom setup script").closest("label");
    expect(customSetup).not.toBeNull();
    await user.click(within(customSetup).getByRole("checkbox"));

    expect(screen.queryByText(".env")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("pnpm install")).toBeInTheDocument();
  });

  test("requires a setup script before saving when custom setup is enabled", async () => {
    const user = userEvent.setup();
    renderWorkflowEditor();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Default Codex")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Workflow Setup" }));
    const customSetup = screen.getByText("Use custom setup script").closest("label");
    expect(customSetup).not.toBeNull();
    await user.click(within(customSetup).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Setup script is required when custom setup is enabled.")).toBeInTheDocument();
    expect(mocks.appApi.updateWorkflow).not.toHaveBeenCalled();
  });
});
