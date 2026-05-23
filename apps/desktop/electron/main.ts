import { spawn } from "child_process";
import { app, BrowserWindow, ipcMain } from "electron";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { killAllChildren } from "../../../packages/core-lib/claude";
import { getDefaultDesktopUserDataDir, setRuntimeBaseDir, setRuntimeStorageDir } from "../../../packages/core-models/config";
import { startTerminalBridge } from "./terminal-bridge";
import {
  pickFolder,
  getWorkflowConfig,
  setMobileAccessEnabled,
  setAiBackendOverride,
  listAiApiProfiles,
  saveAiApi,
  deleteAiApi,
  listWorkflows,
  getWorkflowByFilename,
  setWorkflowVisible,
  createWorkflow,
  createWorkflowDraft,
  updateWorkflow,
  updateWorkflowDraft,
  generateSkill,
  listSkills,
  saveSkill,
  deleteSkill,
  importSkills,
  removeWorkflow,
  activateWorkflow,
  listWorkFolders,
  addWorkFolder,
  removeWorkFolder,
  getTaskState,
  getTaskOutputPath,
  removeTask,
  removeTaskWorktreeOnly,
  saveTaskUploads,
} from "./api";
import {
  startWorkflowSession,
  approveWorkflow,
  rejectWorkflow,
  sendWorkflowMessage,
  interruptWorkflowPhase,
  resumeWorkflowPhase,
  retryWorkflowPhase,
  pauseWorkflowPhase,
  detachWorkflowSender,
  setWorkflowTerminalBridge,
} from "./workflow-runtime";

let mainWindow: BrowserWindow | null = null;
let terminalBridge: {
  appendToSession: (sessionId: string, cwd: string, chunk: string) => void;
  close: () => Promise<void>;
  closeSession: (sessionId: string, exitCode?: number | null) => void;
  clearSession: (sessionId: string, cwd?: string) => void;
  getUrl: () => string;
} | null = null;
const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererDevServerUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = Boolean(rendererDevServerUrl);
const userDataDir = getDefaultDesktopUserDataDir();

mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

function spawnDetached(command, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const child = spawn(command, args, {
      detached: true,
      env,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

const EDITOR_OPENERS = {
  code: {
    command: "code",
    args: (targetPath) => [targetPath],
    darwinApp: "Visual Studio Code",
    label: "VS Code",
  },
  sublime: {
    command: "subl",
    args: (targetPath) => [targetPath],
    darwinApp: "Sublime Text",
    label: "Sublime Text",
  },
  zed: {
    command: "zed",
    args: (targetPath) => [targetPath],
    darwinApp: "Zed",
    label: "Zed",
  },
};

async function openInEditor(targetPath, editor = "code") {
  if (!targetPath) throw new Error("path required");
  const opener = EDITOR_OPENERS[editor] || EDITOR_OPENERS.code;
  console.log(`[openInEditor] Attempting to open ${targetPath} with ${editor}`);
  try {
    await spawnDetached(opener.command, opener.args(targetPath));
    console.log(`[openInEditor] Successfully opened with command: ${opener.command}`);
    return { ok: true };
  } catch (error) {
    console.log(`[openInEditor] Command failed, trying macOS open:`, error?.message);
    if (process.platform === "darwin") {
      try {
        await spawnDetached("open", ["-a", opener.darwinApp, targetPath]);
        console.log(`[openInEditor] Successfully opened with macOS open -a ${opener.darwinApp}`);
        return { ok: true };
      } catch (openError) {
        console.error(`[openInEditor] macOS open also failed:`, openError?.message);
        throw new Error(openError?.message || `failed to open ${opener.label}`);
      }
    }
    throw new Error(error?.message || `failed to open ${opener.label}`);
  }
}

async function waitForRenderer(url, attempts = 40, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Renderer dev server not ready: ${url}`);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 8 },
    backgroundColor: "#f5f5f7",
    webPreferences: {
      preload: join(__dirname, "..", "electron-dist", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    const key = String(input.key || "");
    const isReloadShortcut =
      input.type === "keyDown" &&
      (
        key === "F5" ||
        (
          key.toLowerCase() === "r" &&
          (input.meta || input.control)
        )
      );

    if (isReloadShortcut) {
      event.preventDefault();
    }
  });

  if (isDev) {
    await waitForRenderer(rendererDevServerUrl);
    await mainWindow.loadURL(rendererDevServerUrl);
  } else {
    await mainWindow.loadFile(join(__dirname, "..", "renderer", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle("app:pick-folder", (event) => pickFolder(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle("app:get-workflow-config", () => getWorkflowConfig());
  ipcMain.handle("app:set-mobile-access-enabled", (_event, enabled) => setMobileAccessEnabled(enabled));
  ipcMain.handle("app:set-ai-backend-override", (_event, backend) => setAiBackendOverride(backend));
  ipcMain.handle("app:list-ai-api-profiles", () => listAiApiProfiles());
  ipcMain.handle("app:save-ai-api-profile", (_event, profile) => saveAiApi(profile));
  ipcMain.handle("app:delete-ai-api-profile", (_event, id) => deleteAiApi(id));
  ipcMain.handle("app:list-workflows", () => listWorkflows());
  ipcMain.handle("app:get-workflow", (_event, filename) => getWorkflowByFilename(filename));
  ipcMain.handle("app:set-workflow-visible", (_event, filename, visible) => setWorkflowVisible(filename, visible));
  ipcMain.handle("app:create-workflow", (_event, workflow) => createWorkflow(workflow));
  ipcMain.handle("app:create-workflow-draft", (_event, workflow) => createWorkflowDraft(workflow));
  ipcMain.handle("app:update-workflow", (_event, filename, workflow) => updateWorkflow(filename, workflow));
  ipcMain.handle("app:update-workflow-draft", (_event, filename, workflow) => updateWorkflowDraft(filename, workflow));
  ipcMain.handle("app:generate-skill", (_event, payload) => generateSkill(payload));
  ipcMain.handle("app:list-skills", () => listSkills());
  ipcMain.handle("app:save-skill", (_event, skill) => saveSkill(skill));
  ipcMain.handle("app:delete-skill", (_event, slug) => deleteSkill(slug));
  ipcMain.handle("app:import-skills", (event) => importSkills(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle("app:remove-workflow", (_event, filename) => removeWorkflow(filename));
  ipcMain.handle("app:activate-workflow", (_event, filename) => activateWorkflow(filename));
  ipcMain.handle("app:list-workfolders", () => listWorkFolders());
  ipcMain.handle("app:add-workfolder", (_event, path) => addWorkFolder(path));
  ipcMain.handle("app:remove-workfolder", (_event, path) => removeWorkFolder(path));
  ipcMain.handle("app:get-task-state", (_event, taskId, runId) => getTaskState(taskId, runId));
  ipcMain.handle("app:open-in-code", (_event, targetPath, editor) => openInEditor(targetPath, editor));
  ipcMain.handle("app:open-task-output-in-code", async (_event, taskId, runId, phaseId, outputKey) =>
    openInEditor(await getTaskOutputPath(taskId, runId, phaseId, outputKey))
  );
  ipcMain.handle("app:remove-task", (_event, taskId, runId, options) => removeTask(taskId, runId, options));
  ipcMain.handle("app:remove-task-worktree", (_event, taskId, runId) => removeTaskWorktreeOnly(taskId, runId));
  ipcMain.handle("app:save-task-uploads", (_event, taskId, filePaths) => saveTaskUploads(taskId, filePaths));
  ipcMain.handle("app:get-terminal-bridge-url", () => terminalBridge?.getUrl() || "");
  ipcMain.handle("app:start-workflow", (event, payload) =>
    startWorkflowSession(
      payload.taskId,
      payload.workFolder,
      payload.taskInputs,
      payload.images,
      payload.runId,
      (message) => event.sender.send("workflow:event", message),
      { worktreeName: payload.worktreeName, workflowFilename: payload.workflowFilename },
    )
  );
  ipcMain.handle("app:approve-workflow", (event, taskId, runId) =>
    approveWorkflow(taskId, (message) => event.sender.send("workflow:event", message), runId)
  );
  ipcMain.handle("app:reject-workflow", (event, taskId, rejectTo, reason, runId) =>
    rejectWorkflow(taskId, rejectTo, reason, (message) => event.sender.send("workflow:event", message), runId)
  );
  ipcMain.handle("app:send-workflow-message", (event, taskId, text, images, runId) =>
    sendWorkflowMessage(taskId, text, images, (message) => event.sender.send("workflow:event", message), runId)
  );
  ipcMain.handle("app:interrupt-workflow-phase", (event, taskId, phase, runId) =>
    interruptWorkflowPhase(taskId, phase, (message) => event.sender.send("workflow:event", message), runId)
  );
  ipcMain.handle("app:resume-workflow-phase", (event, taskId, phase, runId) =>
    resumeWorkflowPhase(taskId, phase, (message) => event.sender.send("workflow:event", message), runId)
  );
  ipcMain.handle("app:retry-workflow-phase", (event, taskId, phase, runId) =>
    retryWorkflowPhase(taskId, phase, (message) => event.sender.send("workflow:event", message), runId)
  );
  ipcMain.handle("app:pause-workflow-phase", (event, taskId, phase, runId) =>
    pauseWorkflowPhase(taskId, phase, (message) => event.sender.send("workflow:event", message), runId)
  );
  ipcMain.on("workflow:detach", (_event, taskId, runId) => {
    detachWorkflowSender(taskId, runId);
  });
}

if (gotSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const userDataDir = app.getPath("userData");
    setRuntimeStorageDir(userDataDir);
    setRuntimeBaseDir(join(userDataDir, "tasks"));
    terminalBridge = await startTerminalBridge().catch((error) => {
      console.error(error);
      return null;
    });
    setWorkflowTerminalBridge(terminalBridge);
    registerIpcHandlers();
    try {
      await createWindow();
    } catch (err) {
      console.error(err);
      app.quit();
    }
  });

  app.on("before-quit", () => {
    void terminalBridge?.close().catch(() => {});
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  killAllChildren();
});
