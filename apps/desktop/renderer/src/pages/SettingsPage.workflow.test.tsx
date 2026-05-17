import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  desktopApi: {},
}));

vi.mock("../lib/api-client", () => ({
  getAppApi: () => mocks.desktopApi,
}));

vi.mock("../WorkflowEditor", () => ({
  default: ({ filename, onClose }) => (
    <section aria-label="Workflow Editor">
      <span data-testid="workflow-editor-filename">{filename || "new"}</span>
      <button type="button" onClick={onClose}>Back</button>
    </section>
  ),
}));

import SettingsPage from "./SettingsPage";
import { I18nProvider } from "../components/i18n-provider";
import { useConfigStore } from "../stores/configStore";
import { useWorkflowEditorStore } from "../stores/workflowEditorStore";

function setupDesktopApi() {
  Object.assign(mocks.desktopApi, {
    getWorkflowConfig: vi.fn().mockResolvedValue({ mobileAccessEnabled: false, aiBackendOverride: "codex" }),
    listWorkflows: vi.fn().mockResolvedValue({
      activeWorkflow: "default-codex.json",
      workflows: [{ filename: "default-codex.json", name: "Default Codex", phaseCount: 1, visible: true }],
    }),
    listSkills: vi.fn().mockResolvedValue({ skills: [] }),
    listWorkFolders: vi.fn().mockResolvedValue([]),
    getWorkflow: vi.fn(),
    setMobileAccessEnabled: vi.fn(),
    setAiBackendOverride: vi.fn(),
    setWorkflowVisible: vi.fn().mockResolvedValue({}),
    removeWorkflow: vi.fn(),
    pickFolder: vi.fn(),
    addWorkFolder: vi.fn(),
    removeWorkFolder: vi.fn(),
    saveSkill: vi.fn(),
    deleteSkill: vi.fn(),
    importSkills: vi.fn(),
    createWorkflow: vi.fn(),
    createWorkflowDraft: vi.fn(),
    updateWorkflow: vi.fn(),
    updateWorkflowDraft: vi.fn(),
  });
}

function renderSettings(initialEntry = "/settings") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <I18nProvider>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/workflows/new" element={<SettingsPage />} />
          <Route path="/settings/workflows/:filename/edit" element={<SettingsPage />} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>
  );
}

describe("SettingsPage workflow editor routes", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    sessionStorage.clear();
    for (const key of Object.keys(mocks.desktopApi)) {
      delete mocks.desktopApi[key];
    }
    useWorkflowEditorStore.getState().resetEditor();
    useConfigStore.setState({
      workflowConfig: null,
      workflows: [],
      skills: [],
      aiApiProfiles: [],
      activeWorkflowFile: "",
      workFolders: [],
      selectedFolder: "",
    });
    setupDesktopApi();
  });

  test("opens a new workflow editor from the route", () => {
    renderSettings("/settings/workflows/new");

    expect(screen.getByRole("region", { name: "Workflow Editor" })).toBeInTheDocument();
    expect(screen.getByTestId("workflow-editor-filename")).toHaveTextContent("new");
  });

  test("opens an existing workflow editor from the route", () => {
    renderSettings("/settings/workflows/default-codex.json/edit");

    expect(screen.getByRole("region", { name: "Workflow Editor" })).toBeInTheDocument();
    expect(screen.getByTestId("workflow-editor-filename")).toHaveTextContent("default-codex.json");
  });

  test("navigates to the workflow editor when Edit is clicked", async () => {
    const user = userEvent.setup();
    renderSettings("/settings");

    await user.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.getByRole("region", { name: "Workflow Editor" })).toBeInTheDocument();
    expect(screen.getByTestId("workflow-editor-filename")).toHaveTextContent("default-codex.json");
  });
});
