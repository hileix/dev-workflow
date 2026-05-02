const { contextBridge, ipcRenderer } = require("electron");

function subscribeWorkflowEvents(callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on("workflow:event", handler);
  return () => ipcRenderer.removeListener("workflow:event", handler);
}

contextBridge.exposeInMainWorld("desktopApi", {
  pickFolder: () => ipcRenderer.invoke("app:pick-folder"),
  getWorkflowConfig: () => ipcRenderer.invoke("app:get-workflow-config"),
  listWorkflows: () => ipcRenderer.invoke("app:list-workflows"),
  getWorkflow: (filename) => ipcRenderer.invoke("app:get-workflow", filename),
  createWorkflow: (workflow) => ipcRenderer.invoke("app:create-workflow", workflow),
  updateWorkflow: (filename, workflow) => ipcRenderer.invoke("app:update-workflow", filename, workflow),
  generateSkill: (payload) => ipcRenderer.invoke("app:generate-skill", payload),
  removeWorkflow: (filename) => ipcRenderer.invoke("app:remove-workflow", filename),
  activateWorkflow: (filename) => ipcRenderer.invoke("app:activate-workflow", filename),
  listWorkFolders: () => ipcRenderer.invoke("app:list-workfolders"),
  addWorkFolder: (path) => ipcRenderer.invoke("app:add-workfolder", path),
  removeWorkFolder: (path) => ipcRenderer.invoke("app:remove-workfolder", path),
  getTaskState: (ticketId) => ipcRenderer.invoke("app:get-task-state", ticketId),
  removeTask: (ticketId) => ipcRenderer.invoke("app:remove-task", ticketId),
  saveTaskUploads: (ticketId, filePaths) => ipcRenderer.invoke("app:save-task-uploads", ticketId, filePaths),
  startWorkflow: (payload) => ipcRenderer.invoke("app:start-workflow", payload),
  approveWorkflow: (ticketId) => ipcRenderer.invoke("app:approve-workflow", ticketId),
  rejectWorkflow: (ticketId, rejectTo) => ipcRenderer.invoke("app:reject-workflow", ticketId, rejectTo),
  sendWorkflowMessage: (ticketId, text, images) => ipcRenderer.invoke("app:send-workflow-message", ticketId, text, images),
  onWorkflowEvent: subscribeWorkflowEvents,
  detachWorkflow: (ticketId) => ipcRenderer.send("workflow:detach", ticketId),
});
