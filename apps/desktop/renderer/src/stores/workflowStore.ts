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
const ACTIVE_PHASE_STATUSES = new Set(["in_progress", "awaiting_input", "paused"]);

export function getWorkflowStateKey(taskId, runId = "") {
  const id = taskId || "";
  const run = runId || taskId || "";
  return `${id}:${run}`;
}

function getEventStateKey(msg) {
  const taskId = msg?.taskId || msg?.state?.taskId || "";
  const runId = msg?.runId || msg?.state?.runId || taskId;
  if (!taskId) return "";
  return getWorkflowStateKey(taskId, runId);
}

function getCurrentPhaseFromTask(task) {
  if (task.status === "completed") return "completed";
  const activePhase = (task.phases || []).find((phase) =>
    phase.status === "in_progress" || phase.status === "paused" || phase.status === "awaiting_input" || phase.status === "failed"
  );
  return activePhase?.id || activePhase?.name || task.phases?.[0]?.id || null;
}

export function getSelectedPhaseFromWorkflowState(state) {
  const phases = state?.phases || [];
  const activePhase = phases.find((phase) =>
    phase.status === "in_progress" || phase.status === "paused" || phase.status === "awaiting_input" || phase.status === "failed"
  );
  if (activePhase) return activePhase.id || activePhase.name || null;

  if (state?.currentPhase && state.currentPhase !== "completed") {
    const currentPhase = phases.find((phase) => (phase.id || phase.name) === state.currentPhase);
    if (currentPhase) return currentPhase.id || currentPhase.name || null;
  }

  const latestStartedPhase = phases.findLast?.((phase) => phase.status && phase.status !== "pending")
    || [...phases].reverse().find((phase) => phase.status && phase.status !== "pending");
  return latestStartedPhase?.id || latestStartedPhase?.name || phases[0]?.id || phases[0]?.name || null;
}

function getRunningPhaseFromWorkflowState(state) {
  const runningPhase = (state?.phases || []).find((phase) => phase.status === "in_progress");
  return runningPhase?.id || runningPhase?.name || null;
}

export function getPhasesWithRunningPhase(phases = [], phaseId, now = new Date().toISOString()) {
  const phaseIndex = phases.findIndex((phase) => (phase.id || phase.name) === phaseId);
  return phases.map((phase, index) => {
    const id = phase.id || phase.name;
    let status = phase.status;
    if (id === phaseId) {
      status = "in_progress";
    } else if (phaseIndex >= 0 && index > phaseIndex) {
      status = "pending";
    } else if (ACTIVE_PHASE_STATUSES.has(phase.status)) {
      status = "completed";
    }
    return {
      ...phase,
      status,
      updated: id === phaseId || status !== phase.status ? now : phase.updated,
    };
  });
}

function getWorkflowStateFromTask(task) {
  const taskId = task.taskId || "";
  if (!taskId) return null;
  if (!Array.isArray(task.phases) || task.phases.length === 0) return null;
  const runId = task.runId || taskId;
  return {
    taskId,
    runId,
    workFolder: task.workFolderPath || "",
    currentPhase: getCurrentPhaseFromTask(task),
    overallStatus: task.status || "pending",
    updated: task.updated || task.updatedAt || "",
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

function appendDebugEvent(set, get, payload, source = "workflow") {
  const event = createDebugEvent(payload, source);
  set((state) => {
    const stateKey = getEventStateKey(payload) || getWorkflowStateKey(state.workflowState?.taskId, state.workflowState?.runId);
    const debugEvents = stateKey ? [...(state.debugEventsByRun[stateKey] || []), event] : [];
    const nextState = {
      debugEventsByRun: stateKey
        ? {
            ...state.debugEventsByRun,
            [stateKey]: debugEvents.slice(-MAX_DEBUG_EVENTS),
          }
        : state.debugEventsByRun,
      lastEventAtByRun: stateKey
        ? {
            ...state.lastEventAtByRun,
            [stateKey]: event.at,
          }
        : state.lastEventAtByRun,
      connectionStateByRun: stateKey && source === "workflow"
        ? {
            ...state.connectionStateByRun,
            [stateKey]: "connected",
          }
        : state.connectionStateByRun,
    };

    if (stateKey && (payload?.type === DEBUG_EVENT_TYPES.ERROR || payload?.type === DEBUG_EVENT_TYPES.PHASE_FAILED)) {
      nextState.lastErrorByRun = {
        ...state.lastErrorByRun,
        [stateKey]: {
          at: event.at,
          phase: payload.phase || null,
          message: payload.message || "Unknown error",
          payload,
        },
      };
      nextState.isStreamingByRun = {
        ...state.isStreamingByRun,
        [stateKey]: false,
      };
      nextState.streamingPhaseByRun = {
        ...state.streamingPhaseByRun,
        [stateKey]: null,
      };
    }

    return nextState;
  });
}

async function toUploadPayload(image) {
  if (image?.name && Array.isArray(image.data)) return image;
  if (typeof File !== "undefined" && image instanceof File) {
    return {
      name: image.name || `image-${Date.now()}.png`,
      data: Array.from(new Uint8Array(await image.arrayBuffer())),
      type: image.type || "application/octet-stream",
    };
  }
  if (image?.file && typeof image.file.arrayBuffer === "function") {
    const file = image.file;
    return {
      name: file.name || `image-${Date.now()}.png`,
      data: Array.from(new Uint8Array(await file.arrayBuffer())),
      type: file.type || "application/octet-stream",
    };
  }
  return null;
}

async function normalizeMessageImages(images, runId) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const paths = [];
  const uploads = [];

  for (const image of images) {
    if (typeof image === "string" && image.trim()) {
      paths.push(image.trim());
      continue;
    }
    const payload = await toUploadPayload(image);
    if (payload) uploads.push(payload);
  }

  if (uploads.length === 0) return paths;
  if (!runId) return false;

  const data = await desktopApi.saveTaskUploads(runId, uploads);
  return [...paths, ...((data?.paths || []).filter(Boolean))];
}

export function pushClientDebugEvent(payload) {
  useWorkflowStore.setState((state) => {
    const event = createDebugEvent(payload, "client");
    const stateKey = getEventStateKey(payload) || getWorkflowStateKey(state.workflowState?.taskId, state.workflowState?.runId);
    if (!stateKey) return {};
    return {
      debugEventsByRun: {
        ...state.debugEventsByRun,
        [stateKey]: [...(state.debugEventsByRun[stateKey] || []), event].slice(-MAX_DEBUG_EVENTS),
      },
      lastEventAtByRun: {
        ...state.lastEventAtByRun,
        [stateKey]: event.at,
      },
    };
  });
}

export function pushClientErrorEvent(payload) {
  useWorkflowStore.setState((state) => {
    const event = createDebugEvent(payload, "client");
    const stateKey = getEventStateKey(payload) || getWorkflowStateKey(state.workflowState?.taskId, state.workflowState?.runId);
    if (!stateKey) return {};
    return {
      debugEventsByRun: {
        ...state.debugEventsByRun,
        [stateKey]: [...(state.debugEventsByRun[stateKey] || []), event].slice(-MAX_DEBUG_EVENTS),
      },
      lastEventAtByRun: {
        ...state.lastEventAtByRun,
        [stateKey]: event.at,
      },
      lastErrorByRun: {
        ...state.lastErrorByRun,
        [stateKey]: {
          at: event.at,
          phase: payload.phase || null,
          message: payload.message || "Unknown error",
          payload,
        },
      },
      isStreamingByRun: {
        ...state.isStreamingByRun,
        [stateKey]: false,
      },
      streamingPhaseByRun: {
        ...state.streamingPhaseByRun,
        [stateKey]: null,
      },
    };
  });
}

function markPhaseRunning(set, msg, phaseId) {
  if (!phaseId) return;
  set((state) => {
    const stateKey = getEventStateKey(msg);
    if (!stateKey) return {};
    const existingState = state.workflowStatesByRun[stateKey] || (
      getWorkflowStateKey(state.workflowState?.taskId, state.workflowState?.runId) === stateKey
        ? state.workflowState
        : null
    );
    if (!existingState) return {};

    const now = new Date().toISOString();
    const workflowState = {
      ...existingState,
      currentPhase: phaseId,
      overallStatus: "in_progress",
      updated: now,
      phases: getPhasesWithRunningPhase(existingState.phases || [], phaseId, now),
    };
    const activeStateKey = getWorkflowStateKey(state.workflowState?.taskId, state.workflowState?.runId);
    const isActiveState = activeStateKey === stateKey;
    return {
      workflowState: isActiveState ? workflowState : state.workflowState,
      workflowStatesByRun: {
        ...state.workflowStatesByRun,
        [stateKey]: workflowState,
      },
      selectedPhaseByRun: {
        ...state.selectedPhaseByRun,
        [stateKey]: phaseId,
      },
      isStreamingByRun: {
        ...state.isStreamingByRun,
        [stateKey]: true,
      },
      streamingPhaseByRun: {
        ...state.streamingPhaseByRun,
        [stateKey]: phaseId,
      },
      connectionStateByRun: {
        ...state.connectionStateByRun,
        [stateKey]: "connected",
      },
    };
  });
}

function applyDisconnectedState(set, get) {
  const state = get().workflowState;
  const stateKey = getWorkflowStateKey(state?.taskId, state?.runId);
  if (state) {
    const updated = {
      ...state,
      overallStatus: state.overallStatus,
      phases: state.phases.map((phase) => ({ ...phase })),
    };
    set((current) => ({
      workflowState: updated,
      isStreamingByRun: {
        ...current.isStreamingByRun,
        [stateKey]: false,
      },
      streamingPhaseByRun: {
        ...current.streamingPhaseByRun,
        [stateKey]: null,
      },
      connectionStateByRun: {
        ...current.connectionStateByRun,
        [stateKey]: "disconnected",
      },
    }));
  } else {
    set({});
  }
}

function isActiveWorkflowEvent(state, msg) {
  const eventKey = getEventStateKey(msg);
  if (!eventKey) return false;
  return getWorkflowStateKey(state.workflowState?.taskId, state.workflowState?.runId) === eventKey;
}

function attachWorkflowEvents(set, get) {
  if (unsubscribeWorkflowEvents) return () => applyDisconnectedState(set, get);
  unsubscribeWorkflowEvents = desktopApi.onWorkflowEvent((msg) => {
    if (!msg) return;
    appendDebugEvent(set, get, msg);

    if (msg.type === "phase_artifact") {
      if (!msg.outputKey) return;
      set((state) => ({
        phaseOutputArtifactsByRun: {
          ...state.phaseOutputArtifactsByRun,
          [getEventStateKey(msg)]: {
            ...(state.phaseOutputArtifactsByRun[getEventStateKey(msg)] || {}),
            [msg.phase]: {
              ...(state.phaseOutputArtifactsByRun[getEventStateKey(msg)]?.[msg.phase] || {}),
              [msg.outputKey]: msg.content,
            },
          },
        },
      }));
    } else if (msg.type === "backend_selected") {
      markPhaseRunning(set, msg, msg.phase);
      set((state) => {
        const stateKey = getEventStateKey(msg);
        if (!stateKey || !msg.phase) return {};
        const existingInteractions = state.phaseInteractionsByRun[stateKey]?.[msg.phase] || [];
        const lastInteraction = existingInteractions[existingInteractions.length - 1];
        if (lastInteraction?.type === "phase_start" && lastInteraction.backend === msg.backend) return {};
        const startIndexes = existingInteractions
          .filter((item) => item?.type === "phase_start")
          .map((item) => Number(item.runIndex) || 0);
        const lastRunIndex = Math.max(0, ...startIndexes);
        const hasEarlierConversation = existingInteractions.some((item) => item?.type !== "phase_start");
        const runIndex = lastRunIndex > 0 ? lastRunIndex + 1 : hasEarlierConversation ? 2 : 1;
        return {
          phaseInteractionsByRun: {
            ...state.phaseInteractionsByRun,
            [stateKey]: {
              ...(state.phaseInteractionsByRun[stateKey] || {}),
              [msg.phase]: [
                ...existingInteractions,
                {
                  id: `phase-start-${Date.now()}`,
                  at: new Date().toISOString(),
                  phase: msg.phase,
                  role: "system",
                  type: "phase_start",
                  text: "",
                  backend: msg.backend,
                  runIndex,
                },
              ],
            },
          },
        };
      });
    } else if (msg.type === "text_delta") {
      markPhaseRunning(set, msg, msg.phase);
      set((state) => ({
        phaseMessagesByRun: {
          ...state.phaseMessagesByRun,
          [getEventStateKey(msg)]: {
            ...(state.phaseMessagesByRun[getEventStateKey(msg)] || {}),
            [msg.phase]: (state.phaseMessagesByRun[getEventStateKey(msg)]?.[msg.phase] || "") + msg.text,
          },
        },
        phaseInteractionsByRun: {
          ...state.phaseInteractionsByRun,
          [getEventStateKey(msg)]: {
            ...(state.phaseInteractionsByRun[getEventStateKey(msg)] || {}),
            [msg.phase]: [
              ...(state.phaseInteractionsByRun[getEventStateKey(msg)]?.[msg.phase] || []),
              {
                role: "assistant",
                type: "assistant_delta",
                text: msg.text,
                backend: msg.backend,
              },
            ],
          },
        },
      }));
    } else if (msg.type === "state") {
      const state = msg.state;
      const stateKey = getWorkflowStateKey(state.taskId, state.runId);
      const cachedState = get().workflowStatesByRun[stateKey];
      const displayState = getLatestWorkflowState(state, cachedState);
      let isActiveState = false;
      set((current) => {
        const activeStateKey = getWorkflowStateKey(current.workflowState?.taskId, current.workflowState?.runId);
        isActiveState = activeStateKey === stateKey || (!current.workflowState && current.activeTask === displayState.taskId);
        return {
          workflowState: isActiveState ? displayState : current.workflowState,
          workflowStatesByRun: {
            ...current.workflowStatesByRun,
            [stateKey]: displayState,
          },
          selectedPhaseByRun: {
            ...current.selectedPhaseByRun,
            [stateKey]: getSelectedPhaseFromWorkflowState(displayState),
          },
        };
      });

      const prevStatus = prevStatusRef[stateKey] || {};
      const prevPhase = prevStatus._currentPhase;
      const selectedPhase = getSelectedPhaseFromWorkflowState(displayState);

      if (isActiveState && displayState.currentPhase && displayState.currentPhase !== prevPhase) {
        if (selectedPhase) {
          set((state) => ({
            selectedPhaseByRun: {
              ...state.selectedPhaseByRun,
              [stateKey]: selectedPhase,
            },
          }));
        }
        if (prevPhase) playNotificationSound();
      }

      let streaming = false;
      for (const phase of displayState.phases) {
        const prevPhaseStatus = prevStatus[phase.id];
        if (isActiveState && phase.status === "awaiting_input" && prevPhaseStatus !== "awaiting_input") {
          playNotificationSound();
          set((state) => ({
            selectedPhaseByRun: {
              ...state.selectedPhaseByRun,
              [stateKey]: phase.id,
            },
          }));
        }
        if (isActiveState && phase.status === "paused" && prevPhaseStatus !== "paused") {
          set((state) => ({
            selectedPhaseByRun: {
              ...state.selectedPhaseByRun,
              [stateKey]: phase.id,
            },
          }));
        }
        if (phase.status === "in_progress") streaming = true;
      }
      if (isActiveState && !streaming) {
        set((state) => ({
          isStreamingByRun: {
            ...state.isStreamingByRun,
            [stateKey]: false,
          },
          streamingPhaseByRun: {
            ...state.streamingPhaseByRun,
            [stateKey]: null,
          },
        }));
      }

      const statusMap = {};
      for (const phase of displayState.phases) statusMap[phase.id] = phase.status;
      statusMap._currentPhase = displayState.currentPhase;
      prevStatusRef = {
        ...prevStatusRef,
        [stateKey]: statusMap,
      };

      if (displayState.overallStatus === "completed") {
        useConfigStore.getState().loadWorkFolders();
      }
    } else if (msg.type === "phase_done") {
      set((state) => {
        const stateKey = getEventStateKey(msg);
        if (!stateKey) return {};
        return {
          isStreamingByRun: {
            ...state.isStreamingByRun,
            [stateKey]: false,
          },
          streamingPhaseByRun: {
            ...state.streamingPhaseByRun,
            [stateKey]: null,
          },
        };
      });
    } else if (msg.type === DEBUG_EVENT_TYPES.PHASE_PAUSED) {
      set((state) => {
        const stateKey = getEventStateKey(msg);
        if (!stateKey) return {};
        return {
          isStreamingByRun: {
            ...state.isStreamingByRun,
            [stateKey]: false,
          },
          streamingPhaseByRun: {
            ...state.streamingPhaseByRun,
            [stateKey]: null,
          },
        };
      });
    } else if (msg.type === "phase_content") {
      set((state) => ({
        phaseMessagesByRun: {
          ...state.phaseMessagesByRun,
          [getEventStateKey(msg)]: {
            ...(state.phaseMessagesByRun[getEventStateKey(msg)] || {}),
            [msg.phase]: msg.content,
          },
        },
      }));
    } else if (msg.type === "phase_interaction") {
      set((state) => {
        if (!msg.phase || !msg.interaction) return {};
        const nextByRun = {
          ...state.phaseInteractionsByRun,
          [getEventStateKey(msg)]: {
            ...(state.phaseInteractionsByRun[getEventStateKey(msg)] || {}),
            [msg.phase]: [...(state.phaseInteractionsByRun[getEventStateKey(msg)]?.[msg.phase] || []), msg.interaction],
          },
        };
        return { phaseInteractionsByRun: nextByRun };
      });
    } else if (msg.type === "user_message") {
      set((state) => ({
        phaseMessagesByRun: {
          ...state.phaseMessagesByRun,
          [getEventStateKey(msg)]: {
            ...(state.phaseMessagesByRun[getEventStateKey(msg)] || {}),
            [msg.phase]: (state.phaseMessagesByRun[getEventStateKey(msg)]?.[msg.phase] || "") + `\n\n---\n\n**You:** ${msg.text}\n\n`,
          },
        },
      }));
    } else if (msg.type === "tool_use") {
      markPhaseRunning(set, msg, msg.phase);
      set((state) => ({
        phaseMessagesByRun: {
          ...state.phaseMessagesByRun,
          [getEventStateKey(msg)]: {
            ...(state.phaseMessagesByRun[getEventStateKey(msg)] || {}),
            [msg.phase]: (state.phaseMessagesByRun[getEventStateKey(msg)]?.[msg.phase] || "") + `\n\n*${msg.log || msg.name}*\n\n`,
          },
        },
        phaseInteractionsByRun: {
          ...state.phaseInteractionsByRun,
          [getEventStateKey(msg)]: {
            ...(state.phaseInteractionsByRun[getEventStateKey(msg)] || {}),
            [msg.phase]: [
              ...(state.phaseInteractionsByRun[getEventStateKey(msg)]?.[msg.phase] || []),
              {
                role: "tool",
                type: "tool_use",
                text: msg.log || msg.name || "",
                backend: msg.name,
              },
            ],
          },
        },
      }));
    } else if (msg.type === "session_attached" && msg.phase && msg.sessionId) {
      set((state) => {
        const stateKey = getEventStateKey(msg);
        const existingState = state.workflowStatesByRun[stateKey] || (
          isActiveWorkflowEvent(state, msg) ? state.workflowState : null
        );
        if (!existingState) return {};
        const nextWorkflowState = {
          ...existingState,
          phases: existingState.phases.map((phase) =>
            phase.id === msg.phase ? { ...phase, sessionId: msg.sessionId } : phase
          ),
        };
        return {
          workflowState: isActiveWorkflowEvent(state, msg) ? nextWorkflowState : state.workflowState,
          workflowStatesByRun: {
            ...state.workflowStatesByRun,
            [stateKey]: nextWorkflowState,
          },
        };
      });
    }
  });

  return () => {
    applyDisconnectedState(set, get);
  };
}

export const useWorkflowStore = create((set, get) => ({
  activeTask: null,
  workflowState: null,
  workflowStatesByRun: {},
  selectedPhaseByRun: {},
  phaseMessagesByRun: {},
  phaseOutputArtifactsByRun: {},
  phaseInteractionsByRun: {},
  isStreamingByRun: {},
  streamingPhaseByRun: {},
  connectionStateByRun: {},
  debugEventsByRun: {},
  lastEventAtByRun: {},
  lastErrorByRun: {},
  toast: null,

  setSelectedPhase(phase, stateKey = "") {
    const key = stateKey || getWorkflowStateKey(get().workflowState?.taskId, get().workflowState?.runId);
    if (!key) return;
    set((state) => ({
      selectedPhaseByRun: {
        ...state.selectedPhaseByRun,
        [key]: phase,
      },
    }));
  },

  showToast(message, duration = 3000) {
    set({ toast: message });
    setTimeout(() => set({ toast: null }), duration);
  },

  ensureWorkflowEvents() {
    attachWorkflowEvents(set, get);
  },

  syncTaskSummaries(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) return;
    set((state) => {
      const workflowStatesByRun = { ...state.workflowStatesByRun };
      const selectedPhaseByRun = { ...state.selectedPhaseByRun };
      const isStreamingByRun = { ...state.isStreamingByRun };
      const streamingPhaseByRun = { ...state.streamingPhaseByRun };
      const connectionStateByRun = { ...state.connectionStateByRun };
      let changed = false;

      for (const task of tasks) {
        const summaryState = getWorkflowStateFromTask(task);
        if (!summaryState) continue;
        const stateKey = getWorkflowStateKey(summaryState.taskId, summaryState.runId);
        const existingState = workflowStatesByRun[stateKey];
        const nextState = getLatestWorkflowState(summaryState, existingState);
        if (nextState !== existingState) {
          workflowStatesByRun[stateKey] = nextState;
          selectedPhaseByRun[stateKey] = getSelectedPhaseFromWorkflowState(nextState);
          const runningPhase = getRunningPhaseFromWorkflowState(nextState);
          isStreamingByRun[stateKey] = Boolean(runningPhase);
          streamingPhaseByRun[stateKey] = runningPhase;
          connectionStateByRun[stateKey] = nextState.overallStatus === "completed"
            ? "disconnected"
            : connectionStateByRun[stateKey] || (runningPhase ? "connected" : "connecting");
          changed = true;
        }
      }

      if (!changed) return {};
      const activeState = state.workflowState;
      const activeKey = getWorkflowStateKey(activeState?.taskId, activeState?.runId);
      return {
        workflowStatesByRun,
        selectedPhaseByRun,
        isStreamingByRun,
        streamingPhaseByRun,
        connectionStateByRun,
        workflowState: workflowStatesByRun[activeKey] || activeState,
      };
    });
  },

  async loadTask(taskId, runId) {
    try {
      const stateKey = getWorkflowStateKey(taskId, runId);
      const cachedState = get().workflowStatesByRun[stateKey];
      if (cachedState) {
        const selectedPhase = getSelectedPhaseFromWorkflowState(cachedState);
        const runningPhase = getRunningPhaseFromWorkflowState(cachedState);
        set({
          activeTask: taskId,
          workflowState: cachedState,
          selectedPhaseByRun: {
            ...get().selectedPhaseByRun,
            [stateKey]: selectedPhase,
          },
          isStreamingByRun: {
            ...get().isStreamingByRun,
            [stateKey]: Boolean(runningPhase),
          },
          streamingPhaseByRun: {
            ...get().streamingPhaseByRun,
            [stateKey]: runningPhase,
          },
          connectionStateByRun: {
            ...get().connectionStateByRun,
            [stateKey]: cachedState.overallStatus === "completed"
              ? "disconnected"
              : get().connectionStateByRun[stateKey] || (runningPhase ? "connected" : "connecting"),
          },
        });
      }

      const { state, messages, outputArtifacts, interactions } = await desktopApi.getTaskState(taskId, runId);
      const currentState = get().workflowStatesByRun[stateKey];
      const displayState = getLatestWorkflowState(state, currentState);
      const displayStateKey = getWorkflowStateKey(displayState.taskId, displayState.runId || runId);
      const selectedPhase = getSelectedPhaseFromWorkflowState(displayState);
      const runningPhase = getRunningPhaseFromWorkflowState(displayState);
      const existingMessages = get().phaseMessagesByRun[displayStateKey] || {};
      const existingOutputArtifacts = get().phaseOutputArtifactsByRun[displayStateKey] || {};
      const existingInteractions = get().phaseInteractionsByRun[displayStateKey] || {};
      set({
        activeTask: taskId,
        workflowState: displayState,
        selectedPhaseByRun: {
          ...get().selectedPhaseByRun,
          [displayStateKey]: selectedPhase,
        },
        isStreamingByRun: {
          ...get().isStreamingByRun,
          [displayStateKey]: Boolean(runningPhase),
        },
        streamingPhaseByRun: {
          ...get().streamingPhaseByRun,
          [displayStateKey]: runningPhase,
        },
        connectionStateByRun: {
          ...get().connectionStateByRun,
          [displayStateKey]: displayState.overallStatus === "completed"
            ? "disconnected"
            : get().connectionStateByRun[displayStateKey] || (runningPhase ? "connected" : "connecting"),
        },
        workflowStatesByRun: {
          ...get().workflowStatesByRun,
          [displayStateKey]: displayState,
        },
        phaseMessagesByRun: {
          ...get().phaseMessagesByRun,
          [displayStateKey]: Object.keys(existingMessages).length ? existingMessages : messages || {},
        },
        phaseOutputArtifactsByRun: {
          ...get().phaseOutputArtifactsByRun,
          [displayStateKey]: Object.keys(existingOutputArtifacts).length ? existingOutputArtifacts : outputArtifacts || {},
        },
        phaseInteractionsByRun: {
          ...get().phaseInteractionsByRun,
          [displayStateKey]: Object.keys(existingInteractions).length ? existingInteractions : interactions || {},
        },
      });

      if (displayState.workFolder && displayState.overallStatus !== "completed") {
        get().connectWorkflow(taskId, displayState.workFolder, undefined, undefined, displayState.runId || runId || "", "", displayState.workflowFilename || "");
      }
    } catch {}
  },

  async connectWorkflow(taskId, workFolder, taskInputs, images, runId, worktreeName, workflowFilename) {
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.CLIENT_CONNECT, { taskId, runId, workFolder }));
    const stateKey = getWorkflowStateKey(taskId, runId || taskId);
    set((state) => ({
      connectionStateByRun: {
        ...state.connectionStateByRun,
        [stateKey]: "connecting",
      },
    }));
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
      workflowState,
      workflowStatesByRun: {
        ...get().workflowStatesByRun,
        [stateKey]: workflowState,
      },
      selectedPhaseByRun: {
        ...get().selectedPhaseByRun,
        [stateKey]: firstPhase,
      },
      phaseMessagesByRun: {
        ...get().phaseMessagesByRun,
        [stateKey]: {},
      },
      phaseOutputArtifactsByRun: {
        ...get().phaseOutputArtifactsByRun,
        [stateKey]: {},
      },
      phaseInteractionsByRun: {
        ...get().phaseInteractionsByRun,
        [stateKey]: {},
      },
      isStreamingByRun: {
        ...get().isStreamingByRun,
        [stateKey]: false,
      },
      streamingPhaseByRun: {
        ...get().streamingPhaseByRun,
        [stateKey]: null,
      },
      connectionStateByRun: {
        ...get().connectionStateByRun,
        [stateKey]: "connecting",
      },
      debugEventsByRun: {
        ...get().debugEventsByRun,
        [stateKey]: [],
      },
      lastEventAtByRun: {
        ...get().lastEventAtByRun,
        [stateKey]: null,
      },
      lastErrorByRun: {
        ...get().lastErrorByRun,
        [stateKey]: null,
      },
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

  async sendMessage(text, images, options = {}) {
    const { activeTask, workflowState } = get();
    if (!activeTask) return false;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.PHASE_MESSAGE_REQUESTED, {
      phase: workflowState?.currentPhase || null,
      text,
      imageCount: Array.isArray(images) ? images.length : 0,
      trigger: options.trigger || DEBUG_EVENT_TRIGGERS.CHAT,
    }));
    try {
      await desktopApi.sendWorkflowMessage(activeTask, text, images, workflowState?.runId || "");
      return true;
    } catch (err) {
      pushClientErrorEvent({ type: DEBUG_EVENT_TYPES.ERROR, message: err?.message || "Send message failed" });
      return false;
    }
  },

  async sendTerminalMessage(text, images) {
    const { activeTask, workflowState, streamingPhaseByRun } = get();
    if (!activeTask || !workflowState?.currentPhase) return false;

    const phase = workflowState.currentPhase;
    const stateKey = getWorkflowStateKey(workflowState.taskId, workflowState.runId);
    const phaseState = (workflowState.phases || []).find((item) => (item.id || item.name) === phase);
    const phaseStatus = phaseState?.status || "";
    const isPaused = phaseStatus === "paused" || workflowState.overallStatus === "paused";
    const isRunning = !isPaused && (phaseStatus === "in_progress" || streamingPhaseByRun[stateKey] === phase);

    if (!isRunning && !isPaused) return false;
    if (isRunning) {
      const paused = await get().pausePhase(phase, { trigger: DEBUG_EVENT_TRIGGERS.TERMINAL });
      if (!paused) return false;
    }

    const imagePaths = await normalizeMessageImages(images, workflowState?.runId || "");
    if (imagePaths === false) return false;
    const sent = await get().sendMessage(text, imagePaths, { trigger: DEBUG_EVENT_TRIGGERS.TERMINAL });
    if (!sent) return false;
    return await get().resumePhase(phase, { trigger: DEBUG_EVENT_TRIGGERS.TERMINAL });
  },

  async resumePhase(phase, options = {}) {
    const { activeTask, workflowState } = get();
    if (!activeTask || !phase) return false;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.PHASE_RESUME_REQUESTED, { phase, trigger: options.trigger || DEBUG_EVENT_TRIGGERS.TOOLBAR }));
    const stateKey = getWorkflowStateKey(workflowState?.taskId, workflowState?.runId);
    set((state) => ({
      isStreamingByRun: {
        ...state.isStreamingByRun,
        [stateKey]: true,
      },
      streamingPhaseByRun: {
        ...state.streamingPhaseByRun,
        [stateKey]: phase,
      },
      lastErrorByRun: {
        ...state.lastErrorByRun,
        [stateKey]: null,
      },
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
      return true;
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
          isStreamingByRun: {
            ...state.isStreamingByRun,
            [getWorkflowStateKey(reverted.taskId, reverted.runId)]: false,
          },
          streamingPhaseByRun: {
            ...state.streamingPhaseByRun,
            [getWorkflowStateKey(reverted.taskId, reverted.runId)]: null,
          },
        }));
      } else {
        set((state) => ({
          isStreamingByRun: {
            ...state.isStreamingByRun,
            [stateKey]: false,
          },
          streamingPhaseByRun: {
            ...state.streamingPhaseByRun,
            [stateKey]: null,
          },
        }));
      }
      pushClientErrorEvent({ type: DEBUG_EVENT_TYPES.ERROR, message: err?.message || "Resume failed", phase });
      return false;
    }
  },

  async retryPhase(phase) {
    const { activeTask, workflowState } = get();
    if (!activeTask || !phase) return;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.PHASE_RETRY_REQUESTED, { phase, trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR }));
    const stateKey = getWorkflowStateKey(workflowState?.taskId, workflowState?.runId);
    set((state) => ({
      isStreamingByRun: {
        ...state.isStreamingByRun,
        [stateKey]: true,
      },
      streamingPhaseByRun: {
        ...state.streamingPhaseByRun,
        [stateKey]: phase,
      },
      lastErrorByRun: {
        ...state.lastErrorByRun,
        [stateKey]: null,
      },
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
          isStreamingByRun: {
            ...state.isStreamingByRun,
            [getWorkflowStateKey(reverted.taskId, reverted.runId)]: false,
          },
          streamingPhaseByRun: {
            ...state.streamingPhaseByRun,
            [getWorkflowStateKey(reverted.taskId, reverted.runId)]: null,
          },
        }));
      } else {
        set((state) => ({
          isStreamingByRun: {
            ...state.isStreamingByRun,
            [stateKey]: false,
          },
          streamingPhaseByRun: {
            ...state.streamingPhaseByRun,
            [stateKey]: null,
          },
        }));
      }
      pushClientErrorEvent({ type: DEBUG_EVENT_TYPES.ERROR, message: err?.message || "Retry failed", phase });
    }
  },

  async pausePhase(phase, options = {}) {
    const { activeTask, workflowState } = get();
    if (!activeTask || !phase) return false;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.PHASE_PAUSE_REQUESTED, { phase, trigger: options.trigger || DEBUG_EVENT_TRIGGERS.TOOLBAR }));
    const stateKey = getWorkflowStateKey(workflowState?.taskId, workflowState?.runId);
    set((state) => ({
      isStreamingByRun: {
        ...state.isStreamingByRun,
        [stateKey]: false,
      },
      streamingPhaseByRun: {
        ...state.streamingPhaseByRun,
        [stateKey]: null,
      },
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
      return true;
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
      return false;
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
      const { [stateKey]: _removedSelectedPhase, ...selectedPhaseByRun } = get().selectedPhaseByRun;
      const { [stateKey]: _removedMessages, ...phaseMessagesByRun } = get().phaseMessagesByRun;
      const { [stateKey]: _removedArtifacts, ...phaseOutputArtifactsByRun } = get().phaseOutputArtifactsByRun;
      const { [stateKey]: _removedInteractions, ...phaseInteractionsByRun } = get().phaseInteractionsByRun;
      const { [stateKey]: _removedStreaming, ...isStreamingByRun } = get().isStreamingByRun;
      const { [stateKey]: _removedStreamingPhase, ...streamingPhaseByRun } = get().streamingPhaseByRun;
      const { [stateKey]: _removedConnection, ...connectionStateByRun } = get().connectionStateByRun;
      const { [stateKey]: _removedDebugEvents, ...debugEventsByRun } = get().debugEventsByRun;
      const { [stateKey]: _removedLastEventAt, ...lastEventAtByRun } = get().lastEventAtByRun;
      const { [stateKey]: _removedLastError, ...lastErrorByRun } = get().lastErrorByRun;
      set({
        activeTask: null,
        workflowState: null,
        workflowStatesByRun,
        selectedPhaseByRun,
        phaseMessagesByRun,
        phaseOutputArtifactsByRun,
        phaseInteractionsByRun,
        isStreamingByRun,
        streamingPhaseByRun,
        connectionStateByRun,
        debugEventsByRun,
        lastEventAtByRun,
        lastErrorByRun,
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
