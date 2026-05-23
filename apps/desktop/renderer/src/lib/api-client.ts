function jsonHeaders(headers = {}) {
  return {
    "content-type": "application/json",
    ...headers,
  };
}

function normalizeBaseUrl() {
  const base = window.__DEV_WORKFLOW_API_BASE__ || "";
  return String(base).replace(/\/$/, "");
}

function createWebApi() {
  const baseUrl = normalizeBaseUrl();
  let workflowSocket = null;
  let workflowHandler = null;
  let activeTaskId = null;
  let activeRunId = "";
  let activeWorkFolder = "";

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
    const target = new URL(`${baseUrl}/ws`, window.location.origin);
    target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    workflowSocket = new WebSocket(target);
    workflowSocket.addEventListener("message", (event) => {
      if (!workflowHandler) return;
      try {
        workflowHandler(JSON.parse(event.data));
      } catch {}
    });
    return workflowSocket;
  }

  function sendSocket(payload) {
    const socket = ensureSocket();
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      return;
    }
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify(payload));
    }, { once: true });
  }

  return {
    pickFolder: async () => request("/api/pick-folder", { method: "POST" }),
    getWorkflowConfig: async () => request("/api/workflow"),
    setMobileAccessEnabled: async (enabled) => request("/api/settings/mobile-access", { method: "PUT", body: JSON.stringify({ enabled }) }),
    setAiBackendOverride: async (backend) => request("/api/settings/ai-backend", { method: "PUT", body: JSON.stringify({ backend }) }),
    listAiApiProfiles: async () => request("/api/settings/ai-api-profiles"),
    saveAiApiProfile: async (profile) => request("/api/settings/ai-api-profiles", { method: "POST", body: JSON.stringify(profile) }),
    deleteAiApiProfile: async (id) => request(`/api/settings/ai-api-profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listWorkflows: async () => request("/api/workflows"),
    getWorkflow: async (filename) => request(`/api/workflows/${filename}`),
    setWorkflowVisible: async (filename, visible) => request(`/api/workflows/${filename}/visibility`, { method: "PUT", body: JSON.stringify({ visible }) }),
    createWorkflow: async (workflow) => request("/api/workflows", { method: "POST", body: JSON.stringify(workflow) }),
    createWorkflowDraft: async (workflow) => request("/api/workflows?draft=1", { method: "POST", body: JSON.stringify(workflow) }),
    updateWorkflow: async (filename, workflow) => request(`/api/workflows/${filename}`, { method: "PUT", body: JSON.stringify(workflow) }),
    updateWorkflowDraft: async (filename, workflow) => request(`/api/workflows/${filename}?draft=1`, { method: "PUT", body: JSON.stringify(workflow) }),
    generateSkill: async (payload) => request("/api/generate-skill", { method: "POST", body: JSON.stringify(payload) }),
    listSkills: async () => request("/api/skills"),
    saveSkill: async (skill) => request("/api/skills", { method: "POST", body: JSON.stringify(skill) }),
    deleteSkill: async (slug) => request(`/api/skills/${slug}`, { method: "DELETE" }),
    importSkills: async () => request("/api/skills/import", { method: "POST", body: JSON.stringify({ paths: [] }) }).catch(() => ({
      cancelled: true,
      skills: [],
    })),
    removeWorkflow: async (filename) => request(`/api/workflows/${filename}`, { method: "DELETE" }),
    activateWorkflow: async (filename) => request(`/api/workflows/${filename}/activate`, { method: "PUT" }),
    listWorkFolders: async () => request("/api/workfolders"),
    addWorkFolder: async (path) => request("/api/workfolders", { method: "POST", body: JSON.stringify({ path }) }),
    removeWorkFolder: async (path) => request("/api/workfolders", { method: "DELETE", body: JSON.stringify({ path }) }),
    getTaskState: async (taskId, runId) => {
      const query = runId ? `?runId=${encodeURIComponent(runId)}` : "";
      return request(`/api/tasks/${encodeURIComponent(taskId)}/state${query}`);
    },
    openInCode: async () => {
      throw new Error("Open in VS Code is only available in the desktop app");
    },
    openTaskOutputInCode: async () => {
      throw new Error("Open in VS Code is only available in the desktop app");
    },
    removeTask: async (taskId, runId, options = {}) => {
      const params = new URLSearchParams();
      if (runId) params.set("runId", runId);
      if (options?.removeWorktree) params.set("removeWorktree", "1");
      const query = params.toString() ? `?${params.toString()}` : "";
      return request(`/api/tasks/${encodeURIComponent(taskId)}${query}`, { method: "DELETE" });
    },
    removeTaskWorktree: async () => {
      throw new Error("Removing a Git worktree is only available in the desktop app");
    },
    saveTaskUploads: async (taskId, filePaths) => {
      if (!Array.isArray(filePaths) || filePaths.length === 0) return { paths: [] };
      const form = new FormData();
      for (const entry of filePaths) {
        if (!entry || typeof entry !== "object" || !entry.name || !entry.data) continue;
        form.append("images", new File([new Uint8Array(entry.data)], entry.name));
      }
      const response = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskId)}/upload`, {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "upload failed");
      return data;
    },
    getTerminalBridgeUrl: async () => "",
    startWorkflow: async (payload) => {
      activeTaskId = payload.taskId;
      activeRunId = payload.runId || "";
      activeWorkFolder = payload.workFolder;
      sendSocket({
        type: "start",
        taskId: payload.taskId,
        workFolder: payload.workFolder,
        taskInputs: payload.taskInputs,
        images: payload.images,
        runId: payload.runId,
        worktreeName: payload.worktreeName,
        workflowFilename: payload.workflowFilename,
      });
    },
    approveWorkflow: async (taskId, runId) => {
      sendSocket({ type: "approve", taskId, runId });
    },
    rejectWorkflow: async (taskId, rejectTo, reason, runId) => {
      sendSocket({ type: "reject", taskId, rejectTo, reason, runId });
    },
    sendWorkflowMessage: async (taskId, text, images, runId) => {
      sendSocket({ type: "message", taskId, text, images, runId });
    },
    interruptWorkflowPhase: async (taskId, phase, runId) => {
      sendSocket({ type: "interrupt_phase", taskId, phase, runId });
    },
    resumeWorkflowPhase: async (taskId, phase, runId) => {
      sendSocket({ type: "resume_phase", taskId, phase, runId });
    },
    retryWorkflowPhase: async (taskId, phase, runId) => {
      sendSocket({ type: "retry_phase", taskId, phase, runId });
    },
    pauseWorkflowPhase: async (taskId, phase, runId) => {
      sendSocket({ type: "pause_phase", taskId, phase, runId });
    },
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
        activeWorkFolder = "";
      }
    },
  };
}

function requireDesktopApi() {
  if (!window.desktopApi) {
    return createWebApi();
  }
  return window.desktopApi;
}

export function getAppApi() {
  return requireDesktopApi();
}
