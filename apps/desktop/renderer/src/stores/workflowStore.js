import { create } from "zustand";
import { useConfigStore } from "./configStore";
import { getAppApi } from "../lib/api-client";

const desktopApi = getAppApi();
const MAX_DEBUG_EVENTS = 200;

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.stop(ctx.currentTime + 0.5);
  } catch {}
}

let prevStatusRef = {};
let unsubscribeWorkflowEvents = null;

function createDebugEvent(payload, source = "workflow") {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    source,
    payload,
  };
}

function appendDebugEvent(set, payload, source = "workflow") {
  const event = createDebugEvent(payload, source);
  set((state) => {
    const debugEvents = [...state.debugEvents, event];
    const nextState = {
      debugEvents: debugEvents.slice(-MAX_DEBUG_EVENTS),
      lastEventAt: event.at,
      connectionState: source === "workflow" ? "connected" : state.connectionState,
    };

    if (payload?.type === "error" || payload?.type === "phase_failed") {
      nextState.lastError = {
        at: event.at,
        phase: payload.phase || null,
        message: payload.message || "Unknown error",
        payload,
      };
      nextState.isStreaming = false;
      nextState.streamingPhase = null;
    }

    return nextState;
  });
}

function appendPhaseInteraction(set, phase, interaction) {
  if (!phase || !interaction) return;
  set((state) => ({
    phaseInteractions: {
      ...state.phaseInteractions,
      [phase]: [...(state.phaseInteractions[phase] || []), interaction],
    },
  }));
}

function markPhaseRunning(set, phaseId) {
  if (!phaseId) return;
  set((state) => {
    if (!state.workflowState) return {};
    return {
      selectedPhase: phaseId,
      workflowState: {
        ...state.workflowState,
        currentPhase: phaseId,
        overallStatus: "in_progress",
        phases: (state.workflowState.phases || []).map((phase) => ({
          ...phase,
          status: phase.id === phaseId
            ? "in_progress"
            : phase.status === "in_progress"
              ? "completed"
              : phase.status,
        })),
      },
    };
  });
}

function applyDisconnectedState(set, get) {
  const state = get().workflowState;
  if (state) {
    const updated = {
      ...state,
      overallStatus: state.overallStatus === "in_progress" ? "awaiting_input" : state.overallStatus,
      phases: state.phases.map((phase) =>
        phase.status === "in_progress" ? { ...phase, status: "awaiting_input" } : phase
      ),
    };
    set({ workflowState: updated, isStreaming: false, streamingPhase: null, connectionState: "disconnected" });
  } else {
    set({ isStreaming: false, streamingPhase: null, connectionState: "disconnected" });
  }
}

function attachWorkflowEvents(set, get, taskId, runId = "") {
  if (unsubscribeWorkflowEvents) unsubscribeWorkflowEvents();
  unsubscribeWorkflowEvents = desktopApi.onWorkflowEvent((msg) => {
    if (!msg) return;
    appendDebugEvent(set, msg);

    if (msg.type === "phase_artifact") {
      if (!msg.outputKey) return;
      set((state) => ({
        phaseOutputArtifacts: {
          ...state.phaseOutputArtifacts,
          [msg.phase]: {
            ...(state.phaseOutputArtifacts[msg.phase] || {}),
            [msg.outputKey]: msg.content,
          },
        },
      }));
    } else if (msg.type === "backend_selected") {
      markPhaseRunning(set, msg.phase);
    } else if (msg.type === "text_delta") {
      markPhaseRunning(set, msg.phase);
      set((state) => ({
        phaseMessages: { ...state.phaseMessages, [msg.phase]: (state.phaseMessages[msg.phase] || "") + msg.text },
        phaseInteractions: {
          ...state.phaseInteractions,
          [msg.phase]: [
            ...(state.phaseInteractions[msg.phase] || []),
            {
              role: "assistant",
              type: "assistant_delta",
              text: msg.text,
              backend: msg.backend,
            },
          ],
        },
        isStreaming: true,
        streamingPhase: msg.phase,
      }));
    } else if (msg.type === "state") {
      const state = msg.state;
      set({ workflowState: state });

      const prevPhase = prevStatusRef._currentPhase;

      if (state.currentPhase && state.currentPhase !== prevPhase) {
        if (state.currentPhase !== "completed") set({ selectedPhase: state.currentPhase });
        if (prevPhase) playNotificationSound();
      }

      let streaming = false;
      for (const phase of state.phases) {
        const prevStatus = prevStatusRef[phase.id];
        if (phase.status === "awaiting_input" && prevStatus !== "awaiting_input") {
          playNotificationSound();
          set({ selectedPhase: phase.id });
        }
        if (phase.status === "in_progress") streaming = true;
      }
      if (!streaming) {
        set({ isStreaming: false, streamingPhase: null });
      }

      const statusMap = {};
      for (const phase of state.phases) statusMap[phase.id] = phase.status;
      statusMap._currentPhase = state.currentPhase;
      prevStatusRef = statusMap;

      if (state.overallStatus === "completed") {
        useConfigStore.getState().loadWorkFolders();
      }
    } else if (msg.type === "phase_done") {
      set({ isStreaming: false, streamingPhase: null });
    } else if (msg.type === "phase_paused") {
      set({ isStreaming: false, streamingPhase: null });
    } else if (msg.type === "phase_content") {
      set((state) => ({ phaseMessages: { ...state.phaseMessages, [msg.phase]: msg.content } }));
    } else if (msg.type === "phase_interaction") {
      appendPhaseInteraction(set, msg.phase, msg.interaction);
    } else if (msg.type === "user_message") {
      set((state) => ({
        phaseMessages: {
          ...state.phaseMessages,
          [msg.phase]: (state.phaseMessages[msg.phase] || "") + `\n\n---\n\n**You:** ${msg.text}\n\n`,
        },
      }));
    } else if (msg.type === "tool_use") {
      markPhaseRunning(set, msg.phase);
      set((state) => ({
        phaseMessages: {
          ...state.phaseMessages,
          [msg.phase]: (state.phaseMessages[msg.phase] || "") + `\n\n*${msg.log || msg.name}*\n\n`,
        },
        phaseInteractions: {
          ...state.phaseInteractions,
          [msg.phase]: [
            ...(state.phaseInteractions[msg.phase] || []),
            {
              role: "tool",
              type: "tool_use",
              text: msg.log || msg.name || "",
              backend: msg.name,
            },
          ],
        },
      }));
    } else if (msg.type === "session_attached" && msg.phase && msg.sessionId) {
      set((state) => ({
        workflowState: state.workflowState
          ? {
              ...state.workflowState,
              phases: state.workflowState.phases.map((phase) =>
                phase.id === msg.phase ? { ...phase, sessionId: msg.sessionId } : phase
              ),
            }
          : state.workflowState,
      }));
    }
  });

  return () => {
    appendDebugEvent(set, { type: "client_detach", taskId }, "client");
    if (taskId) desktopApi.detachWorkflow(taskId, runId);
    if (unsubscribeWorkflowEvents) {
      unsubscribeWorkflowEvents();
      unsubscribeWorkflowEvents = null;
    }
    applyDisconnectedState(set, get);
  };
}

export const useWorkflowStore = create((set, get) => ({
  activeTicket: null,
  workflowState: null,
  selectedPhase: null,
  phaseMessages: {},
  phaseOutputArtifacts: {},
  phaseInteractions: {},
  isStreaming: false,
  streamingPhase: null,
  connectionState: "disconnected",
  debugEvents: [],
  lastEventAt: null,
  lastError: null,
  toast: null,

  setSelectedPhase(phase) {
    set({ selectedPhase: phase });
  },

  showToast(message, duration = 3000) {
    set({ toast: message });
    setTimeout(() => set({ toast: null }), duration);
  },

  async loadTicket(taskId, runId) {
    try {
      const { state, messages, outputArtifacts, interactions } = await desktopApi.getTaskState(taskId, runId);
      const selectedPhase = state.currentPhase && state.currentPhase !== "completed"
        ? state.currentPhase
        : state.phases?.[0]?.id || null;
      set({
        activeTicket: taskId,
        workflowState: state,
        phaseMessages: messages || {},
        phaseOutputArtifacts: outputArtifacts || {},
        phaseInteractions: interactions || {},
        selectedPhase,
        isStreaming: false,
        streamingPhase: null,
        connectionState: state.overallStatus === "completed" ? "disconnected" : "connecting",
        debugEvents: [],
        lastEventAt: null,
        lastError: null,
      });

      if (state.workFolder && state.overallStatus !== "completed") {
        get().connectWorkflow(taskId, state.workFolder, undefined, undefined, state.runId || runId || "", "", state.workflowFilename || "");
      }
    } catch {}
  },

  async connectWorkflow(taskId, workFolder, contextValues, images, runId, worktreeName, workflowFilename) {
    appendDebugEvent(set, { type: "client_connect", taskId, workFolder }, "client");
    set({ connectionState: "connecting" });
    const detach = attachWorkflowEvents(set, get, taskId, runId);
    try {
      await desktopApi.startWorkflow({ taskId, workFolder, contextValues, images, runId, worktreeName, workflowFilename });
    } catch (err) {
      appendDebugEvent(set, { type: "error", message: err?.message || "Failed to start workflow" }, "client");
      detach();
      applyDisconnectedState(set, get);
    }
  },

  startWorkflow(id, folder, contextValues, images, runId, worktreeName, workflowFilename) {
    const selectedFolder = folder || useConfigStore.getState().selectedFolder;
    if (!id || !selectedFolder) return;

    const configState = useConfigStore.getState();
    const workflowConfig = configState.workflowConfig;
    const selectedWorkflow = configState.workflows.find((workflow) => workflow.filename === workflowFilename);
    const runWorkflowConfig = selectedWorkflow?.workflowConfig || workflowConfig;
    const phaseOrder = runWorkflowConfig?.phaseOrder || [];
    const firstPhase = phaseOrder[0] || null;

    set({
      activeTicket: id,
      selectedPhase: firstPhase,
      phaseMessages: {},
      phaseOutputArtifacts: {},
      phaseInteractions: {},
      workflowState: {
        taskId: id,
        runId: runId || id,
        currentPhase: null,
        overallStatus: "loading",
        workflowFilename: workflowFilename || runWorkflowConfig?.activeWorkflow || "",
        workflowConfig: runWorkflowConfig,
        phases: phaseOrder.map((pid) => ({
          id: pid,
          name: pid,
          status: "pending",
          updated: null,
        })),
      },
      connectionState: "connecting",
      debugEvents: [],
      lastEventAt: null,
      lastError: null,
    });
    prevStatusRef = {};

    get().connectWorkflow(id, selectedFolder, contextValues, images, runId, worktreeName, workflowFilename);
  },

  async approve() {
    const { activeTicket, workflowState } = get();
    if (!activeTicket) return;
    try {
      await desktopApi.approveWorkflow(activeTicket, workflowState?.runId || "");
    } catch (err) {
      appendDebugEvent(set, { type: "error", message: err?.message || "Approve failed" }, "client");
    }
  },

  async reject(rejectTo, reason) {
    const { activeTicket, workflowState } = get();
    if (!activeTicket) return;
    try {
      await desktopApi.rejectWorkflow(activeTicket, rejectTo, reason, workflowState?.runId || "");
    } catch (err) {
      appendDebugEvent(set, { type: "error", message: err?.message || "Reject failed", rejectTo }, "client");
    }
  },

  async sendMessage(text, images) {
    const { activeTicket, workflowState } = get();
    if (!activeTicket) return;
    try {
      await desktopApi.sendWorkflowMessage(activeTicket, text, images, workflowState?.runId || "");
    } catch (err) {
      appendDebugEvent(set, { type: "error", message: err?.message || "Send message failed" }, "client");
    }
  },

  async restartPhase(phase) {
    const { activeTicket, workflowState } = get();
    if (!activeTicket || !phase) return;
    appendDebugEvent(set, { type: "phase_restart_requested", phase }, "client");
    set((state) => ({
      isStreaming: true,
      streamingPhase: phase,
      lastError: null,
      workflowState: state.workflowState
        ? {
            ...state.workflowState,
            overallStatus: "in_progress",
            currentPhase: phase,
            phases: state.workflowState.phases.map((item) =>
              item.id === phase ? { ...item, status: "in_progress" } : item
            ),
          }
        : state.workflowState,
    }));
    try {
      await desktopApi.restartWorkflowPhase(activeTicket, phase, workflowState?.runId || "");
    } catch (err) {
      set({ isStreaming: false, streamingPhase: null });
      appendDebugEvent(set, { type: "error", message: err?.message || "Restart failed", phase }, "client");
    }
  },

  async pausePhase(phase) {
    const { activeTicket, workflowState } = get();
    if (!activeTicket || !phase) return;
    appendDebugEvent(set, { type: "phase_pause_requested", phase }, "client");
    set((state) => ({
      isStreaming: false,
      streamingPhase: null,
      workflowState: state.workflowState
        ? {
            ...state.workflowState,
            overallStatus: "awaiting_input",
            phases: state.workflowState.phases.map((item) =>
              item.id === phase ? { ...item, status: "awaiting_input" } : item
            ),
          }
        : state.workflowState,
    }));
    try {
      await desktopApi.pauseWorkflowPhase(activeTicket, phase, workflowState?.runId || "");
    } catch (err) {
      appendDebugEvent(set, { type: "error", message: err?.message || "Pause failed", phase }, "client");
    }
  },

  async deleteTask(taskId, runId, options = {}) {
    const { activeTicket, workflowState } = get();
    const targetTaskId = taskId || activeTicket;
    const targetRunId = runId || workflowState?.runId || "";
    if (!targetTaskId) return false;
    try {
      if (unsubscribeWorkflowEvents) {
        unsubscribeWorkflowEvents();
        unsubscribeWorkflowEvents = null;
      }
      desktopApi.detachWorkflow(targetTaskId, targetRunId);
      await desktopApi.removeTask(targetTaskId, targetRunId, options);
      set({
        activeTicket: null,
        workflowState: null,
        phaseMessages: {},
        phaseOutputArtifacts: {},
        phaseInteractions: {},
        isStreaming: false,
        streamingPhase: null,
        connectionState: "disconnected",
        debugEvents: [],
        lastEventAt: null,
        lastError: null,
      });
      await useConfigStore.getState().loadWorkFolders();
      return true;
    } catch (err) {
      appendDebugEvent(set, { type: "error", message: err?.message || "Delete task failed" }, "client");
      return false;
    }
  },
}));
