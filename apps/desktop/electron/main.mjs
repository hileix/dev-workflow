import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { killAllChildren } from "../../../packages/core-lib/claude.mjs";
import { setRuntimeBaseDir, setRuntimeStorageDir } from "../../../packages/core-models/config.mjs";
import {
  pickFolder,
  getWorkflowConfig,
  setMobileAccessEnabled,
  listWorkflows,
  getWorkflowByFilename,
  createWorkflow,
  updateWorkflow,
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
  removeTask,
  saveTaskUploads,
} from "./api.mjs";
import {
  startWorkflowSession,
  approveWorkflow,
  rejectWorkflow,
  sendWorkflowMessage,
  detachWorkflowSender,
} from "./workflow-runtime.mjs";

let mainWindow;
const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererDevServerUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = Boolean(rendererDevServerUrl);

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
      preload: join(__dirname, "preload.cjs"),
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
  ipcMain.handle("app:list-workflows", () => listWorkflows());
  ipcMain.handle("app:get-workflow", (_event, filename) => getWorkflowByFilename(filename));
  ipcMain.handle("app:create-workflow", (_event, workflow) => createWorkflow(workflow));
  ipcMain.handle("app:update-workflow", (_event, filename, workflow) => updateWorkflow(filename, workflow));
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
  ipcMain.handle("app:get-task-state", (_event, taskId) => getTaskState(taskId));
  ipcMain.handle("app:remove-task", (_event, taskId) => removeTask(taskId));
  ipcMain.handle("app:save-task-uploads", (_event, taskId, filePaths) => saveTaskUploads(taskId, filePaths));
  ipcMain.handle("app:start-workflow", (event, payload) =>
    startWorkflowSession(
      payload.taskId,
      payload.workFolder,
      payload.contextValues,
      payload.images,
      payload.runId,
      (message) => event.sender.send("workflow:event", message),
    )
  );
  ipcMain.handle("app:approve-workflow", (event, taskId) =>
    approveWorkflow(taskId, (message) => event.sender.send("workflow:event", message))
  );
  ipcMain.handle("app:reject-workflow", (event, taskId, rejectTo) =>
    rejectWorkflow(taskId, rejectTo, (message) => event.sender.send("workflow:event", message))
  );
  ipcMain.handle("app:send-workflow-message", (event, taskId, text, images) =>
    sendWorkflowMessage(taskId, text, images, (message) => event.sender.send("workflow:event", message))
  );
  ipcMain.on("workflow:detach", (_event, taskId) => {
    detachWorkflowSender(taskId);
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
