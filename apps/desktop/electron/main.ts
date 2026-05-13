import { spawn } from "child_process";
import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { killAllChildren } from "../../../packages/core-lib/claude";
import { setRuntimeBaseDir, setRuntimeStorageDir } from "../../../packages/core-models/config";
import {
  pickFolder,
  getWorkflowConfig,
  setMobileAccessEnabled,
  setAiBackendOverride,
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
  restartWorkflowPhase,
  pauseWorkflowPhase,
  detachWorkflowSender,
} from "./workflow-runtime";

let mainWindow;
const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererDevServerUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = Boolean(rendererDevServerUrl);

function spawnDetached(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function openInCode(targetPath) {
  if (!targetPath) throw new Error("path required");
  try {
    await spawnDetached("code", [targetPath]);
    return { ok: true };
  } catch (error) {
    if (process.platform === "darwin") {
      await spawnDetached("open", ["-a", "Visual Studio Code", targetPath]);
      return { ok: true };
    }
    throw new Error(error?.message || "failed to open VS Code");
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
}

function registerIpcHandlers() {
  ipcMain.handle("app:pick-folder", (event) => pickFolder(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle("app:get-workflow-config", () => getWorkflowConfig());
  ipcMain.handle("app:set-mobile-access-enabled", (_event, enabled) => setMobileAccessEnabled(enabled));
  ipcMain.handle("app:set-ai-backend-override", (_event, backend) => setAiBackendOverride(backend));
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
  ipcMain.handle("app:open-in-code", (_event, targetPath) => openInCode(targetPath));
  ipcMain.handle("app:open-task-output-in-code", async (_event, taskId, runId, phaseId, outputKey) =>
    openInCode(await getTaskOutputPath(taskId, runId, phaseId, outputKey))
  );
  ipcMain.handle("app:remove-task", (_event, taskId, runId, options) => removeTask(taskId, runId, options));
  ipcMain.handle("app:remove-task-worktree", (_event, taskId, runId) => removeTaskWorktreeOnly(taskId, runId));
  ipcMain.handle("app:save-task-uploads", (_event, taskId, filePaths) => saveTaskUploads(taskId, filePaths));
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
  ipcMain.handle("app:restart-workflow-phase", (event, taskId, phase, runId) =>
    restartWorkflowPhase(taskId, phase, (message) => event.sender.send("workflow:event", message), runId)
  );
  ipcMain.handle("app:pause-workflow-phase", (event, taskId, phase, runId) =>
    pauseWorkflowPhase(taskId, phase, (message) => event.sender.send("workflow:event", message), runId)
  );
  ipcMain.on("workflow:detach", (_event, taskId, runId) => {
    detachWorkflowSender(taskId, runId);
  });
}

app.whenReady().then(async () => {
  setRuntimeStorageDir(app.getPath("userData"));
  setRuntimeBaseDir(join(app.getPath("userData"), "tasks"));
  registerIpcHandlers();
  try {
    await createWindow();
  } catch (err) {
    console.error(err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  killAllChildren();
});
