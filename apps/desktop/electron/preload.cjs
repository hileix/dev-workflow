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
  listWorkflows: () => ipcRenderer.invoke("app:list-workflows"),
  getWorkflow: (filename) => ipcRenderer.invoke("app:get-workflow", filename),
  createWorkflow: (workflow) => ipcRenderer.invoke("app:create-workflow", workflow),
  updateWorkflow: (filename, workflow) => ipcRenderer.invoke("app:update-workflow", filename, workflow),
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
  getTaskState: (taskId) => ipcRenderer.invoke("app:get-task-state", taskId),
  removeTask: (taskId) => ipcRenderer.invoke("app:remove-task", taskId),
  saveTaskUploads: (taskId, filePaths) => ipcRenderer.invoke("app:save-task-uploads", taskId, filePaths),
  startWorkflow: (payload) => ipcRenderer.invoke("app:start-workflow", payload),
  approveWorkflow: (taskId) => ipcRenderer.invoke("app:approve-workflow", taskId),
  rejectWorkflow: (taskId, rejectTo) => ipcRenderer.invoke("app:reject-workflow", taskId, rejectTo),
  sendWorkflowMessage: (taskId, text, images) => ipcRenderer.invoke("app:send-workflow-message", taskId, text, images),
  onWorkflowEvent: subscribeWorkflowEvents,
  detachWorkflow: (taskId) => ipcRenderer.send("workflow:detach", taskId),
});
