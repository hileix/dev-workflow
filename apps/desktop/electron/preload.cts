const { contextBridge, ipcRenderer } = require("electron");

function subscribeWorkflowEvents(callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on("workflow:event", handler);
  return () => ipcRenderer.removeListener("workflow:event", handler);
}

contextBridge.exposeInMainWorld("desktopApi", {
  pickFolder: () => ipcRenderer.invoke("app:pick-folder"),
  getWorkflowConfig: () => ipcRenderer.invoke("app:get-workflow-config"),
  setMobileAccessEnabled: (enabled) => ipcRenderer.invoke("app:set-mobile-access-enabled", enabled),
  setAiBackendOverride: (backend) => ipcRenderer.invoke("app:set-ai-backend-override", backend),
  listWorkflows: () => ipcRenderer.invoke("app:list-workflows"),
  getWorkflow: (filename) => ipcRenderer.invoke("app:get-workflow", filename),
  setWorkflowVisible: (filename, visible) => ipcRenderer.invoke("app:set-workflow-visible", filename, visible),
  createWorkflow: (workflow) => ipcRenderer.invoke("app:create-workflow", workflow),
  createWorkflowDraft: (workflow) => ipcRenderer.invoke("app:create-workflow-draft", workflow),
  updateWorkflow: (filename, workflow) => ipcRenderer.invoke("app:update-workflow", filename, workflow),
  updateWorkflowDraft: (filename, workflow) => ipcRenderer.invoke("app:update-workflow-draft", filename, workflow),
  generateSkill: (payload) => ipcRenderer.invoke("app:generate-skill", payload),
  listSkills: () => ipcRenderer.invoke("app:list-skills"),
  saveSkill: (skill) => ipcRenderer.invoke("app:save-skill", skill),
  deleteSkill: (slug) => ipcRenderer.invoke("app:delete-skill", slug),
  importSkills: () => ipcRenderer.invoke("app:import-skills"),
  removeWorkflow: (filename) => ipcRenderer.invoke("app:remove-workflow", filename),
  activateWorkflow: (filename) => ipcRenderer.invoke("app:activate-workflow", filename),
  listWorkFolders: () => ipcRenderer.invoke("app:list-workfolders"),
  addWorkFolder: (path) => ipcRenderer.invoke("app:add-workfolder", path),
  removeWorkFolder: (path) => ipcRenderer.invoke("app:remove-workfolder", path),
  getTaskState: (taskId, runId) => ipcRenderer.invoke("app:get-task-state", taskId, runId),
  openInCode: (targetPath) => ipcRenderer.invoke("app:open-in-code", targetPath),
  openTaskOutputInCode: (taskId, runId, phaseId, outputKey) => ipcRenderer.invoke("app:open-task-output-in-code", taskId, runId, phaseId, outputKey),
  removeTask: (taskId, runId, options) => ipcRenderer.invoke("app:remove-task", taskId, runId, options),
  removeTaskWorktree: (taskId, runId) => ipcRenderer.invoke("app:remove-task-worktree", taskId, runId),
  saveTaskUploads: (taskId, filePaths) => ipcRenderer.invoke("app:save-task-uploads", taskId, filePaths),
  startWorkflow: (payload) => ipcRenderer.invoke("app:start-workflow", payload),
  approveWorkflow: (taskId, runId) => ipcRenderer.invoke("app:approve-workflow", taskId, runId),
  rejectWorkflow: (taskId, rejectTo, reason, runId) => ipcRenderer.invoke("app:reject-workflow", taskId, rejectTo, reason, runId),
  sendWorkflowMessage: (taskId, text, images, runId) => ipcRenderer.invoke("app:send-workflow-message", taskId, text, images, runId),
  restartWorkflowPhase: (taskId, phase, runId) => ipcRenderer.invoke("app:restart-workflow-phase", taskId, phase, runId),
  pauseWorkflowPhase: (taskId, phase, runId) => ipcRenderer.invoke("app:pause-workflow-phase", taskId, phase, runId),
  onWorkflowEvent: subscribeWorkflowEvents,
  detachWorkflow: (taskId, runId) => ipcRenderer.send("workflow:detach", taskId, runId),
});
