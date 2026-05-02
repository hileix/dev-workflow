import { create } from "zustand";
import { useConfigStore } from "./configStore";
import { getDesktopApi } from "../lib/desktop-api";

const desktopApi = getDesktopApi();

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

function findGroupForPhase(phaseId, groups) {
  for (const g of groups) {
    if (g.phases.includes(phaseId)) return g.key;
  }
  return null;
}

let prevStatusRef = {};
let unsubscribeWorkflowEvents = null;

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
    set({ workflowState: updated, isStreaming: false, streamingPhase: null });
  } else {
    set({ isStreaming: false, streamingPhase: null });
  }
}

function attachWorkflowEvents(set, get, ticketId) {
  if (unsubscribeWorkflowEvents) unsubscribeWorkflowEvents();
  unsubscribeWorkflowEvents = desktopApi.onWorkflowEvent((msg) => {
    if (!msg) return;

    if (msg.type === "phase_artifact") {
      set((state) => ({ phaseArtifacts: { ...state.phaseArtifacts, [msg.phase]: msg.content } }));
    } else if (msg.type === "text_delta") {
      set((state) => ({
        phaseMessages: { ...state.phaseMessages, [msg.phase]: (state.phaseMessages[msg.phase] || "") + msg.text },
        isStreaming: true,
        streamingPhase: msg.phase,
      }));
    } else if (msg.type === "state") {
      const state = msg.state;
      set({ workflowState: state });

      const prevPhase = prevStatusRef._currentPhase;
      const groups = useConfigStore.getState().workflowConfig?.groups || [];

      if (state.currentPhase && state.currentPhase !== prevPhase) {
        const group = findGroupForPhase(state.currentPhase, groups);
        if (group) set({ selectedGroup: group });
        if (prevPhase) playNotificationSound();
      }

      let streaming = false;
      for (const phase of state.phases) {
        const prevStatus = prevStatusRef[phase.id];
        if (phase.status === "awaiting_input" && prevStatus !== "awaiting_input") {
          playNotificationSound();
          const group = findGroupForPhase(phase.id, groups);
          if (group) set({ selectedGroup: group });
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
    } else if (msg.type === "phase_content") {
      set((state) => ({ phaseMessages: { ...state.phaseMessages, [msg.phase]: msg.content } }));
    } else if (msg.type === "user_message") {
      set((state) => ({
        phaseMessages: {
          ...state.phaseMessages,
          [msg.phase]: (state.phaseMessages[msg.phase] || "") + `\n\n---\n\n**You:** ${msg.text}\n\n`,
        },
      }));
    } else if (msg.type === "tool_use") {
      set((state) => ({
        phaseMessages: {
          ...state.phaseMessages,
          [msg.phase]: (state.phaseMessages[msg.phase] || "") + `\n\n*${msg.log || msg.name}*\n\n`,
        },
      }));
    }
  });

  return () => {
    if (ticketId) desktopApi.detachWorkflow(ticketId);
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
  selectedGroup: null,
  phaseMessages: {},
  phaseArtifacts: {},
  isStreaming: false,
  streamingPhase: null,
  toast: null,

  setSelectedGroup(group) {
    set({ selectedGroup: group });
  },

  showToast(message, duration = 3000) {
    set({ toast: message });
    setTimeout(() => set({ toast: null }), duration);
  },

  async loadTicket(ticketId) {
    try {
      const { state, messages, artifacts } = await desktopApi.getTaskState(ticketId);
      const groups = useConfigStore.getState().workflowConfig?.groups || [];
      let group = null;
      if (state.currentPhase) group = findGroupForPhase(state.currentPhase, groups);
      set({
        activeTicket: ticketId,
        workflowState: state,
        phaseMessages: messages || {},
        phaseArtifacts: artifacts || {},
        selectedGroup: group,
        isStreaming: false,
        streamingPhase: null,
      });

      if (state.workFolder && state.overallStatus !== "completed") {
        get().connectWorkflow(ticketId, state.workFolder);
      }
    } catch {}
  },

  async connectWorkflow(ticketId, workFolder, promptValues, images) {
    const detach = attachWorkflowEvents(set, get, ticketId);
    try {
      await desktopApi.startWorkflow({ ticketId, workFolder, promptValues, images });
    } catch {
      detach();
      applyDisconnectedState(set, get);
    }
  },

  startWorkflow(id, folder, promptValues, images) {
    const selectedFolder = folder || useConfigStore.getState().selectedFolder;
    if (!id || !selectedFolder) return;

    const workflowConfig = useConfigStore.getState().workflowConfig;

    set({
      activeTicket: id,
      selectedGroup: null,
      phaseMessages: {},
      phaseArtifacts: {},
      workflowState: {
        ticketId: id,
        currentPhase: null,
        overallStatus: "loading",
        phases: (workflowConfig?.phaseOrder || []).map((pid) => ({
          id: pid,
          name: pid,
          status: "pending",
          updated: null,
        })),
      },
    });
    prevStatusRef = {};

    get().connectWorkflow(id, selectedFolder, promptValues, images);
  },

  async approve() {
    const { activeTicket } = get();
    if (!activeTicket) return;
    try {
      await desktopApi.approveWorkflow(activeTicket);
    } catch {}
  },

  async reject(rejectTo) {
    const { activeTicket } = get();
    if (!activeTicket) return;
    try {
      await desktopApi.rejectWorkflow(activeTicket, rejectTo);
    } catch {}
  },

  async sendMessage(text, images) {
    const { activeTicket } = get();
    if (!activeTicket) return;
    try {
      await desktopApi.sendWorkflowMessage(activeTicket, text, images);
    } catch {}
  },

  async deleteTask() {
    const { activeTicket } = get();
    if (!activeTicket) return;
    try {
      if (unsubscribeWorkflowEvents) {
        unsubscribeWorkflowEvents();
        unsubscribeWorkflowEvents = null;
      }
      desktopApi.detachWorkflow(activeTicket);
      await desktopApi.removeTask(activeTicket);
      set({
        activeTicket: null,
        workflowState: null,
        phaseMessages: {},
        phaseArtifacts: {},
        isStreaming: false,
        streamingPhase: null,
      });
      useConfigStore.getState().loadWorkFolders();
    } catch {}
  },
}));
