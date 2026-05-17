import { create } from "zustand";
import { useConfigStore } from "./configStore";
import { getAppApi } from "../lib/api-client";
import { buildClientDebugPayload, DEBUG_EVENT_TRIGGERS, DEBUG_EVENT_TYPES } from "../lib/debug-events";

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

function getWorkflowStateKey(taskId, runId = "") {
  const id = taskId || "";
  const run = runId || taskId || "";
  return `${id}:${run}`;
}

function getCurrentPhaseFromTask(task) {
  if (task.status === "completed") return "completed";
  const activePhase = (task.phases || []).find((phase) =>
    phase.status === "in_progress" || phase.status === "paused" || phase.status === "awaiting_input" || phase.status === "failed"
  );
  return activePhase?.id || activePhase?.name || task.phases?.[0]?.id || null;
}

function getWorkflowStateFromTask(task) {
  const taskId = task.taskId || "";
  if (!taskId) return null;
  const runId = task.runId || taskId;
  return {
    taskId,
    runId,
    workFolder: task.workFolderPath || "",
    currentPhase: getCurrentPhaseFromTask(task),
    overallStatus: task.status || "pending",
    workflowConfig: task.workflowConfig || null,
    phases: task.phases || [],
  };
}

function mergeWorkflowStates(baseState, overrideState) {
  if (!baseState) return overrideState;
  if (!overrideState) return baseState;
  return {
    ...baseState,
    ...overrideState,
    workFolder: overrideState.workFolder || baseState.workFolder,
    workflowFilename: overrideState.workflowFilename || baseState.workflowFilename,
    workflowConfig: overrideState.workflowConfig || baseState.workflowConfig,
    workflowDefinition: overrideState.workflowDefinition || baseState.workflowDefinition,
    taskInputs: overrideState.taskInputs || baseState.taskInputs,
    worktree: overrideState.worktree || baseState.worktree,
    phases: overrideState.phases?.length > 0 ? overrideState.phases : baseState.phases || [],
  };
}

function getWorkflowStateTimestamp(state) {
  const stateTime = Date.parse(state?.updated || "");
  if (Number.isFinite(stateTime)) return stateTime;
  return Math.max(
    0,
    ...(state?.phases || []).map((phase) => {
      const phaseTime = Date.parse(phase.updated || "");
      return Number.isFinite(phaseTime) ? phaseTime : 0;
    })
  );
}

function getLatestWorkflowState(fetchedState, cachedState) {
  if (!cachedState) return fetchedState;
  if (!fetchedState?.worktree && cachedState?.worktree?.cleaned) {
    return mergeWorkflowStates(fetchedState, cachedState);
  }
  const fetchedTime = getWorkflowStateTimestamp(fetchedState);
  const cachedTime = getWorkflowStateTimestamp(cachedState);
  if (cachedTime > fetchedTime) return mergeWorkflowStates(fetchedState, cachedState);
  return fetchedState;
}

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

    if (payload?.type === DEBUG_EVENT_TYPES.ERROR || payload?.type === DEBUG_EVENT_TYPES.PHASE_FAILED) {
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

export function pushClientDebugEvent(payload) {
  useWorkflowStore.setState((state) => {
    const event = createDebugEvent(payload, "client");
    return {
      debugEvents: [...state.debugEvents, event].slice(-MAX_DEBUG_EVENTS),
      lastEventAt: event.at,
    };
  });
}

export function pushClientErrorEvent(payload) {
  useWorkflowStore.setState((state) => {
    const event = createDebugEvent(payload, "client");
    return {
      debugEvents: [...state.debugEvents, event].slice(-MAX_DEBUG_EVENTS),
      lastEventAt: event.at,
      lastError: {
        at: event.at,
        phase: payload.phase || null,
        message: payload.message || "Unknown error",
        payload,
      },
      isStreaming: false,
      streamingPhase: null,
    };
  });
}

function matchesWorkflowEvent(msg, taskId, runId = "") {
  const eventTaskId = msg?.taskId || msg?.state?.taskId || "";
  const eventRunId = msg?.runId || msg?.state?.runId || "";
  if (eventTaskId !== taskId) return false;
  if (runId && eventRunId !== runId) return false;
  return true;
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
    const workflowState = {
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
    };
    const stateKey = getWorkflowStateKey(workflowState.taskId, workflowState.runId);
    return {
      selectedPhase: phaseId,
      workflowState,
      workflowStatesByRun: {
        ...state.workflowStatesByRun,
        [stateKey]: workflowState,
      },
    };
  });
}

function applyDisconnectedState(set, get) {
  const state = get().workflowState;
  if (state) {
    const updated = {
      ...state,
      overallStatus: state.overallStatus,
      phases: state.phases.map((phase) => ({ ...phase })),
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
    if (!matchesWorkflowEvent(msg, taskId, runId)) return;
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
      const stateKey = getWorkflowStateKey(state.taskId, state.runId);
      set((current) => ({
        workflowState: state,
        workflowStatesByRun: {
          ...current.workflowStatesByRun,
          [stateKey]: state,
        },
      }));

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
        if (phase.status === "paused" && prevStatus !== "paused") {
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
    } else if (msg.type === DEBUG_EVENT_TYPES.PHASE_PAUSED) {
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
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.CLIENT_DETACH, { taskId, runId }));
    if (taskId) desktopApi.detachWorkflow(taskId, runId);
    if (unsubscribeWorkflowEvents) {
      unsubscribeWorkflowEvents();
      unsubscribeWorkflowEvents = null;
    }
    applyDisconnectedState(set, get);
  };
}

export const useWorkflowStore = create((set, get) => ({
  activeTask: null,
  workflowState: null,
  workflowStatesByRun: {},
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

  syncTaskSummaries(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) return;
    set((state) => {
      const workflowStatesByRun = { ...state.workflowStatesByRun };
      let changed = false;

      for (const task of tasks) {
        const summaryState = getWorkflowStateFromTask(task);
        if (!summaryState) continue;
        const stateKey = getWorkflowStateKey(summaryState.taskId, summaryState.runId);
        const existingState = workflowStatesByRun[stateKey];
        if (existingState?.overallStatus === "completed") continue;
        workflowStatesByRun[stateKey] = mergeWorkflowStates(existingState, summaryState);
        changed = true;
      }

      if (!changed) return {};
      const activeState = state.workflowState;
      const activeKey = getWorkflowStateKey(activeState?.taskId, activeState?.runId);
      return {
        workflowStatesByRun,
        workflowState: workflowStatesByRun[activeKey] || activeState,
      };
    });
  },

  async loadTask(taskId, runId) {
    try {
      const stateKey = getWorkflowStateKey(taskId, runId);
      const cachedState = get().workflowStatesByRun[stateKey];
      if (cachedState) {
        const selectedPhase = cachedState.currentPhase && cachedState.currentPhase !== "completed"
          ? cachedState.currentPhase
          : cachedState.phases?.[0]?.id || null;
        set({
          activeTask: taskId,
          workflowState: cachedState,
          selectedPhase,
          connectionState: cachedState.overallStatus === "completed" ? "disconnected" : get().connectionState,
        });
      }

      const { state, messages, outputArtifacts, interactions } = await desktopApi.getTaskState(taskId, runId);
      const currentState = get().workflowStatesByRun[stateKey];
      const displayState = getLatestWorkflowState(state, currentState);
      const selectedPhase = displayState.currentPhase && displayState.currentPhase !== "completed"
        ? displayState.currentPhase
        : displayState.phases?.[0]?.id || null;
      set({
        activeTask: taskId,
        workflowState: displayState,
        phaseMessages: messages || {},
        phaseOutputArtifacts: outputArtifacts || {},
        phaseInteractions: interactions || {},
        selectedPhase,
        isStreaming: false,
        streamingPhase: null,
        connectionState: displayState.overallStatus === "completed" ? "disconnected" : "connecting",
        debugEvents: [],
        lastEventAt: null,
        lastError: null,
        workflowStatesByRun: {
          ...get().workflowStatesByRun,
          [stateKey]: displayState,
        },
      });

      if (displayState.workFolder && displayState.overallStatus !== "completed") {
        get().connectWorkflow(taskId, displayState.workFolder, undefined, undefined, displayState.runId || runId || "", "", displayState.workflowFilename || "");
      }
    } catch {}
  },

  async connectWorkflow(taskId, workFolder, taskInputs, images, runId, worktreeName, workflowFilename) {
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.CLIENT_CONNECT, { taskId, workFolder }));
    set({ connectionState: "connecting" });
    const detach = attachWorkflowEvents(set, get, taskId, runId);
    try {
      await desktopApi.startWorkflow({ taskId, workFolder, taskInputs, images, runId, worktreeName, workflowFilename });
    } catch (err) {
      pushClientErrorEvent({ type: DEBUG_EVENT_TYPES.ERROR, message: err?.message || "Failed to start workflow" });
      detach();
      applyDisconnectedState(set, get);
    }
  },

  startWorkflow(id, folder, taskInputs, images, runId, worktreeName, workflowFilename) {
    const selectedFolder = folder || useConfigStore.getState().selectedFolder;
    if (!id || !selectedFolder) return;

    const configState = useConfigStore.getState();
    const workflowConfig = configState.workflowConfig;
    const selectedWorkflow = configState.workflows.find((workflow) => workflow.filename === workflowFilename);
    const runWorkflowConfig = selectedWorkflow?.workflowConfig || workflowConfig;
    const phaseOrder = runWorkflowConfig?.phaseOrder || [];
    const firstPhase = phaseOrder[0] || null;

    const workflowState = {
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
    };
    const stateKey = getWorkflowStateKey(id, workflowState.runId);

    set({
      activeTask: id,
      selectedPhase: firstPhase,
      phaseMessages: {},
      phaseOutputArtifacts: {},
      phaseInteractions: {},
      workflowState,
      workflowStatesByRun: {
        ...get().workflowStatesByRun,
        [stateKey]: workflowState,
      },
      connectionState: "connecting",
      debugEvents: [],
      lastEventAt: null,
      lastError: null,
    });
    prevStatusRef = {};

    get().connectWorkflow(id, selectedFolder, taskInputs, images, runId, worktreeName, workflowFilename);
  },

  async approve() {
    const { activeTask, workflowState } = get();
    if (!activeTask) return;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.PHASE_APPROVE_REQUESTED, {
      phase: workflowState?.currentPhase || null,
      trigger: DEBUG_EVENT_TRIGGERS.CHECKPOINT,
    }));
    try {
      await desktopApi.approveWorkflow(activeTask, workflowState?.runId || "");
    } catch (err) {
      pushClientErrorEvent({ type: DEBUG_EVENT_TYPES.ERROR, message: err?.message || "Approve failed" });
    }
  },

  async reject(rejectTo, reason) {
    const { activeTask, workflowState } = get();
    if (!activeTask) return;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.PHASE_REJECT_REQUESTED, {
      phase: workflowState?.currentPhase || null,
      rejectTo,
      message: reason,
      trigger: DEBUG_EVENT_TRIGGERS.CHECKPOINT,
    }));
    try {
      await desktopApi.rejectWorkflow(activeTask, rejectTo, reason, workflowState?.runId || "");
    } catch (err) {
      pushClientErrorEvent({ type: DEBUG_EVENT_TYPES.ERROR, message: err?.message || "Reject failed", rejectTo });
    }
  },

  async sendMessage(text, images) {
    const { activeTask, workflowState } = get();
    if (!activeTask) return;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.PHASE_MESSAGE_REQUESTED, {
      phase: workflowState?.currentPhase || null,
      text,
      imageCount: Array.isArray(images) ? images.length : 0,
      trigger: DEBUG_EVENT_TRIGGERS.CHAT,
    }));
    try {
      await desktopApi.sendWorkflowMessage(activeTask, text, images, workflowState?.runId || "");
    } catch (err) {
      pushClientErrorEvent({ type: DEBUG_EVENT_TYPES.ERROR, message: err?.message || "Send message failed" });
    }
  },

  async resumePhase(phase) {
    const { activeTask, workflowState } = get();
    if (!activeTask || !phase) return;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.PHASE_RESUME_REQUESTED, { phase, trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR }));
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
      const nextState = get().workflowState;
    if (nextState) {
      set((state) => ({
        workflowStatesByRun: {
          ...state.workflowStatesByRun,
          [getWorkflowStateKey(nextState.taskId, nextState.runId)]: nextState,
        },
      }));
    }
    try {
      await desktopApi.resumeWorkflowPhase(activeTask, phase, workflowState?.runId || "");
    } catch (err) {
      const currentState = get().workflowState;
      if (currentState) {
        const reverted = {
          ...currentState,
          overallStatus: "paused",
          phases: currentState.phases.map((item) =>
            item.id === phase ? { ...item, status: "paused" } : item
          ),
        };
        set((state) => ({
          workflowState: reverted,
          workflowStatesByRun: {
            ...state.workflowStatesByRun,
            [getWorkflowStateKey(reverted.taskId, reverted.runId)]: reverted,
          },
          isStreaming: false,
          streamingPhase: null,
        }));
      } else {
        set({ isStreaming: false, streamingPhase: null });
      }
      pushClientErrorEvent({ type: DEBUG_EVENT_TYPES.ERROR, message: err?.message || "Resume failed", phase });
    }
  },

  async retryPhase(phase) {
    const { activeTask, workflowState } = get();
    if (!activeTask || !phase) return;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.PHASE_RETRY_REQUESTED, { phase, trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR }));
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
    const nextState = get().workflowState;
    if (nextState) {
      set((state) => ({
        workflowStatesByRun: {
          ...state.workflowStatesByRun,
          [getWorkflowStateKey(nextState.taskId, nextState.runId)]: nextState,
        },
      }));
    }
    try {
      await desktopApi.retryWorkflowPhase(activeTask, phase, workflowState?.runId || "");
    } catch (err) {
      const currentState = get().workflowState;
      if (currentState) {
        const reverted = {
          ...currentState,
          overallStatus: "failed",
          phases: currentState.phases.map((item) =>
            item.id === phase ? { ...item, status: "failed" } : item
          ),
        };
        set((state) => ({
          workflowState: reverted,
          workflowStatesByRun: {
            ...state.workflowStatesByRun,
            [getWorkflowStateKey(reverted.taskId, reverted.runId)]: reverted,
          },
          isStreaming: false,
          streamingPhase: null,
        }));
      } else {
        set({ isStreaming: false, streamingPhase: null });
      }
      pushClientErrorEvent({ type: DEBUG_EVENT_TYPES.ERROR, message: err?.message || "Retry failed", phase });
    }
  },

  async pausePhase(phase) {
    const { activeTask, workflowState } = get();
    if (!activeTask || !phase) return;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.PHASE_PAUSE_REQUESTED, { phase, trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR }));
    set((state) => ({
      isStreaming: false,
      streamingPhase: null,
      workflowState: state.workflowState
        ? {
            ...state.workflowState,
            overallStatus: "paused",
            phases: state.workflowState.phases.map((item) =>
              item.id === phase ? { ...item, status: "paused" } : item
            ),
          }
        : state.workflowState,
    }));
    const nextState = get().workflowState;
    if (nextState) {
      set((state) => ({
        workflowStatesByRun: {
          ...state.workflowStatesByRun,
          [getWorkflowStateKey(nextState.taskId, nextState.runId)]: nextState,
        },
      }));
    }
    try {
      await desktopApi.pauseWorkflowPhase(activeTask, phase, workflowState?.runId || "");
    } catch (err) {
      const currentState = get().workflowState;
      if (currentState) {
        const reverted = {
          ...currentState,
          overallStatus: "in_progress",
          phases: currentState.phases.map((item) =>
            item.id === phase ? { ...item, status: "in_progress" } : item
          ),
        };
        set((state) => ({
          workflowState: reverted,
          workflowStatesByRun: {
            ...state.workflowStatesByRun,
            [getWorkflowStateKey(reverted.taskId, reverted.runId)]: reverted,
          },
        }));
      }
      pushClientErrorEvent({ type: DEBUG_EVENT_TYPES.ERROR, message: err?.message || "Pause failed", phase });
    }
  },

  async deleteTask(taskId, runId, options = {}) {
    const { activeTask, workflowState } = get();
    const targetTaskId = taskId || activeTask;
    const targetRunId = runId || workflowState?.runId || "";
    if (!targetTaskId) return false;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.TASK_DELETE_REQUESTED, {
      taskId: targetTaskId,
      runId: targetRunId,
      removeWorktree: Boolean(options?.removeWorktree),
      trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR,
    }));
    try {
      if (unsubscribeWorkflowEvents) {
        unsubscribeWorkflowEvents();
        unsubscribeWorkflowEvents = null;
      }
      desktopApi.detachWorkflow(targetTaskId, targetRunId);
      await desktopApi.removeTask(targetTaskId, targetRunId, options);
      pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.TASK_DELETED, {
        taskId: targetTaskId,
        runId: targetRunId,
        removeWorktree: Boolean(options?.removeWorktree),
        trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR,
      }));
      const stateKey = getWorkflowStateKey(targetTaskId, targetRunId);
      const { [stateKey]: _removed, ...workflowStatesByRun } = get().workflowStatesByRun;
      set({
        activeTask: null,
        workflowState: null,
        workflowStatesByRun,
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
      pushClientErrorEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.TASK_DELETE_FAILED, {
        taskId: targetTaskId,
        runId: targetRunId,
        message: err?.message || "Delete task failed",
        trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR,
      }));
      return false;
    }
  },

  async removeTaskWorktree(taskId, runId) {
    const { activeTask, workflowState } = get();
    const targetTaskId = taskId || activeTask;
    const targetRunId = runId || workflowState?.runId || "";
    if (!targetTaskId) return false;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.WORKTREE_REMOVE_REQUESTED, {
      taskId: targetTaskId,
      runId: targetRunId,
      trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR,
    }));
    try {
      const result = await desktopApi.removeTaskWorktree(targetTaskId, targetRunId);
      pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.WORKTREE_REMOVED, {
        taskId: targetTaskId,
        runId: targetRunId,
        trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR,
      }));
      const nextState = result?.state || (workflowState ? {
        ...workflowState,
        worktree: {
          ...(workflowState.worktree || {}),
          enabled: false,
          cleaned: true,
        },
      } : null);
      const stateKey = getWorkflowStateKey(targetTaskId, targetRunId || nextState?.runId);
      set((state) => ({
        workflowState: state.workflowState?.taskId === targetTaskId ? nextState : state.workflowState,
        workflowStatesByRun: nextState
          ? {
              ...state.workflowStatesByRun,
              [stateKey]: nextState,
            }
          : state.workflowStatesByRun,
      }));
      await useConfigStore.getState().loadWorkFolders();
      return true;
    } catch (err) {
      pushClientErrorEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.WORKTREE_REMOVE_FAILED, {
        taskId: targetTaskId,
        runId: targetRunId,
        message: err?.message || "Remove worktree failed",
        trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR,
      }));
      return false;
    }
  },
}));
