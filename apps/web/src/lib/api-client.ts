import {
  COMMAND_TYPE,
  RELAY_API_ROUTES,
  RELAY_UI_EVENT_TYPES,
  RELAY_WS_PATHS,
  formatRelayApiRoute,
} from "@dev-workflow/protocol";

function jsonHeaders(headers = {}) {
  return {
    "content-type": "application/json",
    ...headers,
  };
}

function normalizeBaseUrl() {
  const configured = window.__DEV_WORKFLOW_API_BASE__ || import.meta.env.VITE_DEV_WORKFLOW_API_BASE || "";
  const base = configured || "http://127.0.0.1:8787";
  return String(base).replace(/\/$/, "");
}

function createServerApi() {
  const baseUrl = normalizeBaseUrl();
  let workflowSocket = null;
  let workflowHandler = null;
  let activeTaskId = null;
  let activeRunId = "";

  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: jsonHeaders(options.headers),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `request failed: ${response.status}`);
    }
    return data;
  }

  function ensureSocket() {
    if (workflowSocket && workflowSocket.readyState <= 1) return workflowSocket;
    const target = new URL(`${baseUrl}${RELAY_WS_PATHS.ui}`, window.location.origin);
    target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    workflowSocket = new WebSocket(target);
    workflowSocket.addEventListener("message", (event) => {
      if (!workflowHandler) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === RELAY_UI_EVENT_TYPES.taskEvent && message.event) {
          workflowHandler(message.event);
          return;
        }
        workflowHandler(message);
      } catch {}
    });
    return workflowSocket;
  }

  async function sendCommand(taskId, type, payload = {}) {
    return request(formatRelayApiRoute(RELAY_API_ROUTES.taskCommands, { taskId }), {
      method: "POST",
      body: JSON.stringify({ type, payload }),
    });
  }

  function promptForLocalPath(message) {
    const value = window.prompt(message);
    const path = String(value || "").trim();
    return path ? { cancelled: false, path } : { cancelled: true };
  }

  function promptForLocalPaths(message) {
    const value = window.prompt(message);
    return String(value || "")
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return {
    pickFolder: async () => promptForLocalPath("Enter a local folder path for the daemon"),
    getWorkflowConfig: async () => request(RELAY_API_ROUTES.workflow),
    listAiApiProfiles: async () => request(RELAY_API_ROUTES.aiApiProfiles),
    saveAiApiProfile: async (profile) => request(RELAY_API_ROUTES.aiApiProfiles, { method: "POST", body: JSON.stringify(profile) }),
    deleteAiApiProfile: async (id) => request(formatRelayApiRoute(RELAY_API_ROUTES.aiApiProfile, { id }), { method: "DELETE" }),
    listWorkflows: async () => request(RELAY_API_ROUTES.workflows),
    getWorkflow: async (filename) => request(formatRelayApiRoute(RELAY_API_ROUTES.workflowByFilename, { filename })),
    setWorkflowVisible: async (filename, visible) => request(formatRelayApiRoute(RELAY_API_ROUTES.workflowVisibility, { filename }), { method: "PUT", body: JSON.stringify({ visible }) }),
    createWorkflow: async (workflow) => request(RELAY_API_ROUTES.workflows, { method: "POST", body: JSON.stringify(workflow) }),
    createWorkflowDraft: async (workflow) => request(`${RELAY_API_ROUTES.workflows}?draft=1`, { method: "POST", body: JSON.stringify(workflow) }),
    updateWorkflow: async (filename, workflow) => request(formatRelayApiRoute(RELAY_API_ROUTES.workflowByFilename, { filename }), { method: "PUT", body: JSON.stringify(workflow) }),
    updateWorkflowDraft: async (filename, workflow) => request(`${formatRelayApiRoute(RELAY_API_ROUTES.workflowByFilename, { filename })}?draft=1`, { method: "PUT", body: JSON.stringify(workflow) }),
    generateSkill: async (payload) => request(RELAY_API_ROUTES.generateSkill, { method: "POST", body: JSON.stringify(payload) }),
    listSkills: async () => request(RELAY_API_ROUTES.skills),
    saveSkill: async (skill) => request(RELAY_API_ROUTES.skills, { method: "POST", body: JSON.stringify(skill) }),
    deleteSkill: async (slug) => request(formatRelayApiRoute(RELAY_API_ROUTES.skillBySlug, { slug }), { method: "DELETE" }),
    importSkills: async () => {
      const paths = promptForLocalPaths("Enter local skill file or folder paths, separated by commas or new lines");
      if (paths.length === 0) return { cancelled: true, skills: [] };
      const data = await request(RELAY_API_ROUTES.skillsImport, {
        method: "POST",
        body: JSON.stringify({ paths }),
      });
      return { cancelled: false, skills: data.skills || [] };
    },
    removeWorkflow: async (filename) => request(formatRelayApiRoute(RELAY_API_ROUTES.workflowByFilename, { filename }), { method: "DELETE" }),
    activateWorkflow: async (filename) => request(formatRelayApiRoute(RELAY_API_ROUTES.workflowActivate, { filename }), { method: "PUT" }),
    listWorkFolders: async () => request(RELAY_API_ROUTES.workfolders),
    addWorkFolder: async (path) => request(RELAY_API_ROUTES.workfolders, { method: "POST", body: JSON.stringify({ path }) }),
    removeWorkFolder: async (path) => request(RELAY_API_ROUTES.workfolders, { method: "DELETE", body: JSON.stringify({ path }) }),
    getTaskState: async (taskId, runId) => {
      const query = runId ? `?runId=${encodeURIComponent(runId)}` : "";
      return request(`${formatRelayApiRoute(RELAY_API_ROUTES.taskState, { taskId })}${query}`);
    },
    openInCode: async (targetPath, editor) => request(RELAY_API_ROUTES.openPath, {
      method: "POST",
      body: JSON.stringify({ path: targetPath, editor }),
    }),
    openTaskOutputInCode: async (taskId, runId, phaseId, outputKey) => request(formatRelayApiRoute(RELAY_API_ROUTES.taskOpenOutput, { taskId }), {
      method: "POST",
      body: JSON.stringify({ runId, phaseId, outputKey }),
    }),
    removeTask: async (taskId, runId, options = {}) => {
      const params = new URLSearchParams();
      if (runId) params.set("runId", runId);
      if (options?.removeWorktree) params.set("removeWorktree", "1");
      const query = params.toString() ? `?${params.toString()}` : "";
      return request(`${formatRelayApiRoute(RELAY_API_ROUTES.taskById, { taskId })}${query}`, { method: "DELETE" });
    },
    removeTaskWorktree: async (taskId, runId) => {
      const query = runId ? `?runId=${encodeURIComponent(runId)}` : "";
      return request(`${formatRelayApiRoute(RELAY_API_ROUTES.taskWorktree, { taskId })}${query}`, { method: "DELETE" });
    },
    saveTaskUploads: async (runId, files) => {
      if (!Array.isArray(files) || files.length === 0) return { paths: [] };
      return request(formatRelayApiRoute(RELAY_API_ROUTES.taskUpload, { runId }), {
        method: "POST",
        body: JSON.stringify({ files }),
      });
    },
    startWorkflow: async (payload) => {
      activeTaskId = payload.taskId;
      activeRunId = payload.runId || "";
      return sendCommand(payload.taskId, COMMAND_TYPE.startWorkflow, {
        workFolder: payload.workFolder,
        taskInputs: payload.taskInputs || {},
        images: payload.images || [],
        runId: payload.runId || "",
        worktreeName: payload.worktreeName || "",
        workflowFilename: payload.workflowFilename || "",
      });
    },
    approveWorkflow: async (taskId, runId) => sendCommand(taskId, COMMAND_TYPE.approve, { runId }),
    rejectWorkflow: async (taskId, rejectTo, reason, runId) => sendCommand(taskId, COMMAND_TYPE.reject, { rejectTo, reason, runId }),
    sendWorkflowMessage: async (taskId, text, images, runId) => sendCommand(taskId, COMMAND_TYPE.message, { text, images: images || [], runId }),
    resumeWorkflowPhase: async (taskId, phase, runId) => sendCommand(taskId, COMMAND_TYPE.resumePhase, { phase, runId }),
    retryWorkflowPhase: async (taskId, phase, runId) => sendCommand(taskId, COMMAND_TYPE.retryPhase, { phase, runId }),
    pauseWorkflowPhase: async (taskId, phase, runId) => sendCommand(taskId, COMMAND_TYPE.pausePhase, { phase, runId }),
    onWorkflowEvent(callback) {
      workflowHandler = callback;
      ensureSocket();
      return () => {
        workflowHandler = null;
      };
    },
    detachWorkflow(taskId, runId) {
      if (activeTaskId === taskId && (!runId || activeRunId === runId)) {
        activeTaskId = null;
        activeRunId = "";
      }
    },
  };
}

export function getAppApi() {
  return createServerApi();
}
