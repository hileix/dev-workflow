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
  let activeTicketId = null;
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
    listWorkflows: async () => request("/api/workflows"),
    getWorkflow: async (filename) => request(`/api/workflows/${filename}`),
    createWorkflow: async (workflow) => request("/api/workflows", { method: "POST", body: JSON.stringify(workflow) }),
    updateWorkflow: async (filename, workflow) => request(`/api/workflows/${filename}`, { method: "PUT", body: JSON.stringify(workflow) }),
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
    getTaskState: async (ticketId) => request(`/api/tasks/${ticketId}/state`),
    removeTask: async (ticketId) => request(`/api/tasks/${ticketId}`, { method: "DELETE" }),
    saveTaskUploads: async (ticketId, filePaths) => {
      if (!Array.isArray(filePaths) || filePaths.length === 0) return { paths: [] };
      const form = new FormData();
      for (const entry of filePaths) {
        if (!entry || typeof entry !== "object" || !entry.name || !entry.data) continue;
        form.append("images", new File([new Uint8Array(entry.data)], entry.name));
      }
      const response = await fetch(`${baseUrl}/api/tasks/${ticketId}/upload`, {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "upload failed");
      return data;
    },
    startWorkflow: async (payload) => {
      activeTicketId = payload.ticketId;
      activeWorkFolder = payload.workFolder;
      sendSocket({
        type: "start",
        ticketId: payload.ticketId,
        workFolder: payload.workFolder,
        promptValues: payload.promptValues,
        images: payload.images,
      });
    },
    approveWorkflow: async (ticketId) => {
      sendSocket({ type: "approve", ticketId });
    },
    rejectWorkflow: async (ticketId, rejectTo) => {
      sendSocket({ type: "reject", ticketId, rejectTo });
    },
    sendWorkflowMessage: async (ticketId, text, images) => {
      sendSocket({ type: "message", ticketId, text, images });
    },
    onWorkflowEvent(callback) {
      workflowHandler = callback;
      ensureSocket();
      return () => {
        workflowHandler = null;
      };
    },
    detachWorkflow(ticketId) {
      if (activeTicketId === ticketId) {
        activeTicketId = null;
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
