import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { killAllChildren } from "../lib/claude.mjs";
import {
  getConfig,
  updateTaskStoragePath,
  pickFolder,
  getWorkflowConfig,
  listWorkflows,
  getWorkflowByFilename,
  createWorkflow,
  updateWorkflow,
  generateSkill,
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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadFile(join(__dirname, "..", "renderer", "dist", "index.html"));
}

function registerIpcHandlers() {
  ipcMain.handle("app:get-config", () => getConfig());
  ipcMain.handle("app:update-task-storage-path", (_event, path) => updateTaskStoragePath(path));
  ipcMain.handle("app:pick-folder", (event) => pickFolder(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle("app:get-workflow-config", () => getWorkflowConfig());
  ipcMain.handle("app:list-workflows", () => listWorkflows());
  ipcMain.handle("app:get-workflow", (_event, filename) => getWorkflowByFilename(filename));
  ipcMain.handle("app:create-workflow", (_event, workflow) => createWorkflow(workflow));
  ipcMain.handle("app:update-workflow", (_event, filename, workflow) => updateWorkflow(filename, workflow));
  ipcMain.handle("app:generate-skill", (_event, payload) => generateSkill(payload));
  ipcMain.handle("app:remove-workflow", (_event, filename) => removeWorkflow(filename));
  ipcMain.handle("app:activate-workflow", (_event, filename) => activateWorkflow(filename));
  ipcMain.handle("app:list-workfolders", () => listWorkFolders());
  ipcMain.handle("app:add-workfolder", (_event, path) => addWorkFolder(path));
  ipcMain.handle("app:remove-workfolder", (_event, path) => removeWorkFolder(path));
  ipcMain.handle("app:get-task-state", (_event, ticketId) => getTaskState(ticketId));
  ipcMain.handle("app:remove-task", (_event, ticketId) => removeTask(ticketId));
  ipcMain.handle("app:save-task-uploads", (_event, ticketId, filePaths) => saveTaskUploads(ticketId, filePaths));
  ipcMain.handle("app:start-workflow", (event, payload) =>
    startWorkflowSession(
      payload.ticketId,
      payload.workFolder,
      payload.promptValues,
      payload.images,
      (message) => event.sender.send("workflow:event", message),
    )
  );
  ipcMain.handle("app:approve-workflow", (event, ticketId) =>
    approveWorkflow(ticketId, (message) => event.sender.send("workflow:event", message))
  );
  ipcMain.handle("app:reject-workflow", (event, ticketId, rejectTo) =>
    rejectWorkflow(ticketId, rejectTo, (message) => event.sender.send("workflow:event", message))
  );
  ipcMain.handle("app:send-workflow-message", (event, ticketId, text, images) =>
    sendWorkflowMessage(ticketId, text, images, (message) => event.sender.send("workflow:event", message))
  );
  ipcMain.on("workflow:detach", (_event, ticketId) => {
    detachWorkflowSender(ticketId);
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  return createWindow();
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
