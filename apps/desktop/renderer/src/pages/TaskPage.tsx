import { useState, useEffect, useRef } from "react";
import { CheckCircle2, ChevronDown, Circle, Loader2, RotateCcw, Square, Trash2 } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import StepDetail from "../StepDetail";
import { BackButton } from "../components/back-button";
import { useI18n } from "../components/i18n-provider";
import { ThemeToggle } from "../components/theme-toggle";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { WindowChrome } from "../components/window-chrome";
import WorkflowDebugPanel from "../components/WorkflowDebugPanel";
import { getAppApi } from "../lib/api-client";
import { buildClientDebugPayload, DEBUG_EVENT_TRIGGERS, DEBUG_EVENT_TYPES } from "../lib/debug-events";
import { cn } from "../lib/utils";
import { getWorkflowStateKey, pushClientDebugEvent, useWorkflowStore } from "../stores/workflowStore";
import { useConfigStore } from "../stores/configStore";

const appApi = getAppApi();

const WORKTREE_EDITORS = [
  { key: "code", label: "VS Code" },
  { key: "sublime", label: "Sublime Text" },
  { key: "zed", label: "Zed" },
];

function getStatusTone(status) {
  if (status === "completed") return "success";
  if (status === "paused") return "warning";
  if (status === "awaiting_input") return "warning";
  if (status === "in_progress") return "info";
  if (status === "failed") return "destructive";
  return "muted";
}

function getStatusLabel(status) {
  if (status === "completed") return "done";
  if (status === "paused") return "paused";
  if (status === "awaiting_input") return "waiting";
  if (status === "in_progress") return "running";
  if (status === "failed") return "failed";
  return "pending";
}

function getPhaseControls({ isAutoPhase, activePhase, currentPhase, activeStatus, isStreaming, lastError }) {
  const isCurrentAutoPhase = Boolean(isAutoPhase && activePhase && activePhase === currentPhase);
  return {
    canPausePhase: Boolean(isCurrentAutoPhase && activeStatus === "in_progress" && !lastError),
    canResumePhase: Boolean(isCurrentAutoPhase && !isStreaming && activeStatus === "paused" && !lastError),
    canRetryPhase: Boolean(isCurrentAutoPhase && !isStreaming && activeStatus === "failed"),
  };
}

function getWorktreeDisplayName(worktree) {
  if (!worktree || (!worktree.enabled && !worktree.cleaned)) return "";
  if (worktree.branchName) return worktree.branchName;
  if (worktree.rootPath) {
    const parts = String(worktree.rootPath).split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || "";
  }
  return "";
}

function getPhaseOutputDocument(phaseId, workflowConfig, phaseOutputArtifacts) {
  const output = (workflowConfig?.phaseOutputs?.[phaseId] || [])[0];
  if (!output?.key) return "";
  return phaseOutputArtifacts?.[phaseId]?.[output.key] || "";
}

function getPhaseOutputTarget(phaseId, workflowConfig, phaseOutputArtifacts) {
  const output = (workflowConfig?.phaseOutputs?.[phaseId] || [])[0];
  if (!output?.key) return null;
  const content = phaseOutputArtifacts?.[phaseId]?.[output.key];
  if (!String(content || "").trim()) return null;
  return { phaseId, outputKey: output.key };
}

function formatNodeUpdated(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getPhaseOutputSummary(phaseId, workflowConfig) {
  const outputs = workflowConfig?.phaseOutputs?.[phaseId] || [];
  if (outputs.length === 0) return "none";
  return outputs.map((output) => output.key || output.filename).filter(Boolean).join(", ") || "none";
}

function getPhaseRouteLabels(phaseId, workflowConfig) {
  const phaseType = workflowConfig?.phaseTypes?.[phaseId] || "auto";
  const labels = [];

  if (phaseType === "condition") {
    const conditionRoutes = workflowConfig?.conditionRoutes?.[phaseId] || {};
    if (conditionRoutes.passTo) labels.push(`pass -> ${conditionRoutes.passTo}`);
    if (conditionRoutes.failTo) labels.push(`fail -> ${conditionRoutes.failTo}`);
  }

  if (phaseType === "checkpoint") {
    labels.push("approve -> next");
  }

  const rejectTargets = workflowConfig?.rejectTargets?.[phaseId] || [];
  rejectTargets.forEach((targetId) => {
    labels.push(`reject -> ${targetId}`);
  });

  return labels;
}

function RunStepList({ phases, workflowConfig, selectedPhase, onSelect }) {
  if (!phases.length) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground">
        No workflow steps yet.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {phases.map((phase, index) => {
        const phaseId = phase.id || phase.name;
        const tone = getStatusTone(phase.status);
        const phaseType = workflowConfig?.phaseTypes?.[phaseId] || "auto";
        const routes = getPhaseRouteLabels(phaseId, workflowConfig);
        const selected = phaseId === selectedPhase;

        return (
          <button
            key={phaseId}
            type="button"
            className={cn(
              "group w-full rounded-lg border bg-card px-3.5 py-3 text-left shadow-sm transition-colors",
              selected ? "border-ring ring-2 ring-ring/20" : "border-border hover:border-ring/60 hover:bg-accent/45",
              tone === "success" && "border-success/60",
              tone === "warning" && "border-warning/70",
              tone === "info" && "border-info/70",
              tone === "destructive" && "border-destructive/70"
            )}
            onClick={() => onSelect(phaseId)}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                selected ? "border-ring bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"
              )}>
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {workflowConfig?.phaseLabels?.[phaseId] || phaseId}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                      {phaseId}
                    </span>
                  </span>
                  <Badge
                    variant={
                      tone === "success" ? "success" :
                        tone === "warning" ? "warning" :
                          tone === "info" ? "info" :
                            tone === "destructive" ? "destructive" : "outline"
                    }
                    className={cn("shrink-0 text-[10px]", tone === "info" && "animate-pulse-subtle")}
                  >
                    {getStatusLabel(phase.status)}
                  </Badge>
                </span>
                <span className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="rounded-md bg-muted px-1.5 py-0.5">{phaseType === "condition" ? "conditional gate" : phaseType}</span>
                  {workflowConfig?.phaseBackends?.[phaseId] && (
                    <span className="rounded-md bg-muted px-1.5 py-0.5">{workflowConfig.phaseBackends[phaseId]}</span>
                  )}
                  {phase.updated && (
                    <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono">{formatNodeUpdated(phase.updated)}</span>
                  )}
                </span>
                <span className="mt-2 block truncate text-[11px] text-muted-foreground">
                  outputs: {getPhaseOutputSummary(phaseId, workflowConfig)}
                </span>
                {routes.length > 0 && (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {routes.map((route) => (
                      <span key={route} className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {route}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function getCheckpointInputDocument(phaseId, workflowConfig, phaseOutputArtifacts, taskInputs) {
  const inputs = workflowConfig?.phaseInputs?.[phaseId] || [];
  const documents = [];

  for (const input of inputs) {
    if (!input) continue;
    let label = input.inputLabel || input.name || input.outputKey || input.phaseId || "Input";
    let content = "";

    if (input.sourceType === "task_input") {
      content = taskInputs?.[input.name] || "";
    } else if (input.sourceType === "phase_output" && input.phaseId) {
      label = input.name || workflowConfig?.phaseLabels?.[input.phaseId] || input.phaseId;
      content = input.outputKey ? phaseOutputArtifacts?.[input.phaseId]?.[input.outputKey] || "" : "";
    }

    const normalizedContent = String(content || "");
    if (normalizedContent.trim()) {
      documents.push({ label, content: normalizedContent });
    }
  }

  if (documents.length === 0) return "";
  if (documents.length === 1) return documents[0].content;
  return documents.map((item) => `## ${item.label}\n\n${item.content}`).join("\n\n---\n\n");
}

function getCheckpointDocumentTarget(phaseId, workflowConfig, phaseOutputArtifacts) {
  const inputs = workflowConfig?.phaseInputs?.[phaseId] || [];
  const targets = [];

  for (const input of inputs) {
    if (input?.sourceType !== "phase_output" || !input.phaseId || !input.outputKey) continue;
    const content = phaseOutputArtifacts?.[input.phaseId]?.[input.outputKey];
    if (String(content || "").trim()) {
      targets.push({ phaseId: input.phaseId, outputKey: input.outputKey });
    }
  }

  return targets.length === 1 ? targets[0] : null;
}

function getDocumentContentForInput(input, phaseOutputArtifacts, taskInputs) {
  if (input.sourceType === "task_input") return taskInputs?.[input.name] || "";
  if (input.sourceType !== "phase_output" || !input.phaseId) return "";
  return input.outputKey ? phaseOutputArtifacts?.[input.phaseId]?.[input.outputKey] || "" : "";
}

function getMissingDocumentMessage({ t, phaseId, workflowConfig, phaseOutputArtifacts, taskInputs, activeStatus, isCheckpointPhase }) {
  if (!phaseId || activeStatus === "pending") return "";

  if (isCheckpointPhase) {
    const inputs = workflowConfig?.phaseInputs?.[phaseId] || [];
    const missingInput = inputs.find((input) =>
      input.required !== false && !String(getDocumentContentForInput(input, phaseOutputArtifacts, taskInputs) || "").trim()
    );
    if (!missingInput) return "";
    if (missingInput.sourceType === "phase_output") {
      return t("stepDetail.missingInputDocument", {
        phase: workflowConfig?.phaseLabels?.[missingInput.phaseId] || missingInput.phaseId || "",
        output: missingInput.outputKey || missingInput.name || "",
      });
    }
    return t("stepDetail.missingContextDocument", { input: missingInput.name || "" });
  }

  if (activeStatus !== "completed" && activeStatus !== "failed") return "";
  const output = (workflowConfig?.phaseOutputs?.[phaseId] || [])[0];
  if (!output?.key) return "";
  const content = phaseOutputArtifacts?.[phaseId]?.[output.key];
  if (String(content || "").trim()) return "";
  return t("stepDetail.missingOutputDocument", { output: output.key });
}

function hasEvent(debugEvents, type, phase = "") {
  return (debugEvents || []).some((event) => {
    const payload = event?.payload || {};
    if (payload.type !== type) return false;
    return !phase || payload.phase === phase;
  });
}

function stepStatus(done, running) {
  if (done) return "completed";
  if (running) return "running";
  return "pending";
}

function buildStartupSteps({ t, debugEvents, workflowState, workflowConfig, connectionState }) {
  if (workflowState?.overallStatus !== "loading") return [];

  const receivedState = hasEvent(debugEvents, DEBUG_EVENT_TYPES.STATE) || workflowState?.overallStatus !== "loading";
  const worktreeEnabled = Boolean(workflowConfig?.worktree?.enabled || workflowState?.worktree?.enabled);
  const worktreeNamingStarted = hasEvent(debugEvents, DEBUG_EVENT_TYPES.WORKTREE_NAMING_STARTED);
  const worktreeNamingDone = hasEvent(debugEvents, DEBUG_EVENT_TYPES.WORKTREE_NAMING_COMPLETED);
  const worktreePreparing = hasEvent(debugEvents, DEBUG_EVENT_TYPES.WORKTREE_PREPARING);
  const worktreeReady = hasEvent(debugEvents, DEBUG_EVENT_TYPES.WORKTREE_READY) || Boolean(workflowState?.worktree?.enabled);

  const steps = [
    {
      key: "connect",
      label: t("stepDetail.startupConnect"),
      status: stepStatus(receivedState || hasEvent(debugEvents, DEBUG_EVENT_TYPES.WORKFLOW_STARTING), connectionState === "connecting"),
    },
  ];

  if (worktreeEnabled) {
    steps.push(
      {
        key: "name-worktree",
        label: t("stepDetail.startupNameWorktree"),
        status: stepStatus(worktreeNamingDone || worktreePreparing || worktreeReady, worktreeNamingStarted),
      },
      {
        key: "prepare-worktree",
        label: t("stepDetail.startupPrepareWorktree"),
        status: stepStatus(worktreeReady, worktreePreparing),
      },
    );
  }

  steps.push(
    {
      key: "state",
      label: t("stepDetail.startupState"),
      status: stepStatus(receivedState, worktreeEnabled ? worktreeReady : hasEvent(debugEvents, DEBUG_EVENT_TYPES.WORKFLOW_STARTING)),
    }
  );

  return steps;
}

function StartupProgressModal({ steps, t }) {
  if (steps.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/55 px-6 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-lg border border-border bg-card px-6 py-5 shadow-xl">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-foreground">{t("stepDetail.startupTitle")}</h2>
        </div>
        <div className="space-y-3">
          {steps.map((step) => {
            const Icon = step.status === "completed" ? CheckCircle2 : step.status === "running" ? Loader2 : Circle;
            return (
              <div key={step.key} className="flex items-center gap-3 text-sm">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    step.status === "completed"
                      ? "text-success"
                      : step.status === "running"
                        ? "animate-spin text-info"
                        : "text-muted-foreground/50"
                  }`}
                />
                <span className={step.status === "pending" ? "text-muted-foreground" : "text-foreground"}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function TaskPage() {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteWorktree, setDeleteWorktree] = useState(false);
  const [showWorktreeOpenMenu, setShowWorktreeOpenMenu] = useState(false);
  const worktreeOpenMenuRef = useRef(null);
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [showRemoveWorktreeConfirm, setShowRemoveWorktreeConfirm] = useState(false);
  const [isRemovingWorktree, setIsRemovingWorktree] = useState(false);
  const navigate = useNavigate();
  const { id: urlTaskId } = useParams();
  const [searchParams] = useSearchParams();
  const urlRunId = searchParams.get("runId") || "";
  const { t } = useI18n();

  const activeTask = useWorkflowStore((s) => s.activeTask);
  const loadTask = useWorkflowStore((s) => s.loadTask);
  const showToast = useWorkflowStore((s) => s.showToast);
  const workflowStatesByRun = useWorkflowStore((s) => s.workflowStatesByRun);
  const taskId = urlTaskId || activeTask;
  const routeStateKey = getWorkflowStateKey(taskId, urlRunId || taskId);
  const workflowState = workflowStatesByRun[routeStateKey] || null;

  useEffect(() => {
    if (urlTaskId && (urlTaskId !== activeTask || workflowState?.taskId !== urlTaskId || (urlRunId && workflowState?.runId !== urlRunId))) {
      loadTask(urlTaskId, urlRunId);
    }
  }, [urlTaskId, urlRunId, activeTask, workflowState?.taskId, workflowState?.runId]);
  const selectedPhaseByRun = useWorkflowStore((s) => s.selectedPhaseByRun);
  const setSelectedPhase = useWorkflowStore((s) => s.setSelectedPhase);
  const phaseMessagesByRun = useWorkflowStore((s) => s.phaseMessagesByRun);
  const phaseOutputArtifactsByRun = useWorkflowStore((s) => s.phaseOutputArtifactsByRun);
  const phaseInteractionsByRun = useWorkflowStore((s) => s.phaseInteractionsByRun);
  const isStreamingByRun = useWorkflowStore((s) => s.isStreamingByRun);
  const streamingPhaseByRun = useWorkflowStore((s) => s.streamingPhaseByRun);
  const debugEventsByRun = useWorkflowStore((s) => s.debugEventsByRun);
  const connectionStateByRun = useWorkflowStore((s) => s.connectionStateByRun);
  const lastEventAtByRun = useWorkflowStore((s) => s.lastEventAtByRun);
  const lastErrorByRun = useWorkflowStore((s) => s.lastErrorByRun);
  const approve = useWorkflowStore((s) => s.approve);
  const reject = useWorkflowStore((s) => s.reject);
  const sendMessage = useWorkflowStore((s) => s.sendMessage);
  const resumePhase = useWorkflowStore((s) => s.resumePhase);
  const retryPhase = useWorkflowStore((s) => s.retryPhase);
  const pausePhase = useWorkflowStore((s) => s.pausePhase);
  const deleteTask = useWorkflowStore((s) => s.deleteTask);
  const removeTaskWorktree = useWorkflowStore((s) => s.removeTaskWorktree);
  const workflowConfig = useConfigStore((s) => s.workflowConfig);
  const runWorkflowConfig = workflowState?.workflowConfig || workflowConfig;

  const [cleanedWorktree, setCleanedWorktree] = useState(null);
  const visibleWorktree = workflowState?.worktree || cleanedWorktree;
  const worktreeDisplayName = getWorktreeDisplayName(visibleWorktree);
  const hasWorktreeRecord = Boolean(visibleWorktree?.enabled || visibleWorktree?.cleaned);
  const isWorktreeCleaned = Boolean(visibleWorktree?.cleaned);
  const hasWorktree = Boolean(visibleWorktree?.enabled);
  const currentPhase = workflowState?.currentPhase;
  const currentStateKey = workflowState
    ? getWorkflowStateKey(workflowState.taskId, workflowState.runId)
    : routeStateKey;
  const selectedPhase = selectedPhaseByRun[currentStateKey] || null;
  const phaseMessages = phaseMessagesByRun[currentStateKey] || {};
  const phaseOutputArtifacts = phaseOutputArtifactsByRun[currentStateKey] || {};
  const phaseInteractions = phaseInteractionsByRun[currentStateKey] || {};
  const isStreaming = Boolean(isStreamingByRun[currentStateKey]);
  const streamingPhase = streamingPhaseByRun[currentStateKey] || null;
  const debugEvents = debugEventsByRun[currentStateKey] || [];
  const connectionState = connectionStateByRun[currentStateKey] || "disconnected";
  const lastEventAt = lastEventAtByRun[currentStateKey] || null;
  const lastError = lastErrorByRun[currentStateKey] || null;
  const phases = workflowState?.phases || [];
  const selectedRunPhase = selectedPhase;
  const activePhase = selectedRunPhase || currentPhase || phases[0]?.id || null;
  const activeStatus = phases.find((p) => (p.id || p.name) === activePhase)?.status;
  const isAutoPhase = runWorkflowConfig?.phaseTypes?.[activePhase] === "auto" || runWorkflowConfig?.phaseTypes?.[activePhase] === "condition";
  const { canPausePhase, canResumePhase, canRetryPhase } = getPhaseControls({
    isAutoPhase,
    activePhase,
    currentPhase,
    activeStatus,
    isStreaming,
    lastError,
  });

  const detailPhase = activePhase;
  const detailStatus = phases.find((p) => (p.id || p.name) === detailPhase)?.status;
  const isPhaseStreaming = isStreaming && detailPhase === streamingPhase;
  const isPhaseRunning = detailStatus === "in_progress";
  const isPhaseAwaiting = detailStatus === "awaiting_input";
  const isPhaseFailed = detailStatus === "failed";
  const isCheckpointPhase = runWorkflowConfig?.phaseTypes?.[detailPhase] === "checkpoint";
  const activePhaseContent = detailPhase ? phaseMessages[detailPhase] || "" : "";
  const activePhaseInputDocument = detailPhase
    ? getCheckpointInputDocument(detailPhase, runWorkflowConfig, phaseOutputArtifacts, workflowState?.taskInputs)
    : "";
  const activePhaseArtifact = detailPhase
    ? isCheckpointPhase
      ? activePhaseInputDocument
      : getPhaseOutputDocument(detailPhase, runWorkflowConfig, phaseOutputArtifacts)
    : "";
  const documentOpenTarget = detailPhase
    ? isCheckpointPhase
      ? getCheckpointDocumentTarget(detailPhase, runWorkflowConfig, phaseOutputArtifacts)
      : getPhaseOutputTarget(detailPhase, runWorkflowConfig, phaseOutputArtifacts)
    : null;
  const activePhaseInteractions = detailPhase ? phaseInteractions[detailPhase] || [] : [];
  const activePhaseBackend = activePhaseInteractions.findLast?.((interaction) => interaction.backend)?.backend
    || runWorkflowConfig?.phaseBackends?.[detailPhase];
  const emptyDocumentMessage = getMissingDocumentMessage({
    t,
    phaseId: detailPhase,
    workflowConfig: runWorkflowConfig,
    phaseOutputArtifacts,
    taskInputs: workflowState?.taskInputs,
    activeStatus: detailStatus,
    isCheckpointPhase,
  });
  const startupSteps = buildStartupSteps({
    t,
    debugEvents,
    workflowState,
    workflowConfig: runWorkflowConfig,
    connectionState,
  });

  useEffect(() => {
    if (workflowState?.worktree?.enabled) {
      setCleanedWorktree(null);
    }
  }, [workflowState?.worktree?.enabled]);

  useEffect(() => {
    if (!showWorktreeOpenMenu) return;

    function handlePointerDown(event) {
      if (worktreeOpenMenuRef.current?.contains(event.target)) return;
      setShowWorktreeOpenMenu(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showWorktreeOpenMenu]);

  async function handleDelete() {
    if (isDeletingTask) return;
    setIsDeletingTask(true);
    const deleted = await deleteTask(taskId, workflowState?.runId || urlRunId, {
      removeWorktree: hasWorktree && deleteWorktree,
    });
    if (deleted) {
      navigate("/");
      return;
    }
    setIsDeletingTask(false);
    showToast(t("task.deleteTaskFailed"));
  }

  async function handleCopyDebugInfo() {
    if (!taskId) return;
    const payload = {
      taskId,
      currentPhase,
      activePhase,
      activeStatus,
      lastEventAt,
      lastError,
      workflowState,
      debugEvents,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      showToast(t("debug.copySuccess"));
    } catch {
      showToast(t("debug.copyFailed"));
    }
  }

  async function handleOpenWorktree(editor = "code") {
    const targetPath = workflowState?.worktree?.rootPath || workflowState?.workFolder;
    if (!targetPath) return;
    setShowWorktreeOpenMenu(false);
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.WORKTREE_OPEN_REQUESTED, {
      taskId,
      runId: workflowState?.runId || urlRunId || "",
      editor,
      path: targetPath,
      trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR,
    }));
    try {
      await appApi.openInCode(targetPath, editor);
      pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.WORKTREE_OPENED, {
        taskId,
        runId: workflowState?.runId || urlRunId || "",
        editor,
        path: targetPath,
        trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR,
      }));
    } catch (error) {
      pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.WORKTREE_OPEN_FAILED, {
        taskId,
        runId: workflowState?.runId || urlRunId || "",
        editor,
        path: targetPath,
        message: error?.message || t("task.openInCodeFailed"),
        trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR,
      }));
      showToast(error?.message || t("task.openInCodeFailed"));
    }
  }

  async function handleRemoveWorktree() {
    if (!taskId || isRemovingWorktree) return;
    const previousWorktree = visibleWorktree;
    setIsRemovingWorktree(true);
    const removed = await removeTaskWorktree(taskId, workflowState?.runId || urlRunId);
    setIsRemovingWorktree(false);
    if (removed) {
      setCleanedWorktree({
        ...(previousWorktree || {}),
        enabled: false,
        cleaned: true,
      });
      setShowRemoveWorktreeConfirm(false);
    }
    if (!removed) showToast(t("task.removeWorktreeFailed"));
  }

  async function handleOpenDocument() {
    if (!taskId || !documentOpenTarget) return;
    pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.DOCUMENT_OPEN_REQUESTED, {
      taskId,
      runId: workflowState?.runId || urlRunId || "",
      phase: documentOpenTarget.phaseId,
      outputKey: documentOpenTarget.outputKey,
      trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR,
    }));
    try {
      await appApi.openTaskOutputInCode(
        taskId,
        workflowState?.runId || urlRunId || "",
        documentOpenTarget.phaseId,
        documentOpenTarget.outputKey,
      );
      pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.DOCUMENT_OPENED, {
        taskId,
        runId: workflowState?.runId || urlRunId || "",
        phase: documentOpenTarget.phaseId,
        outputKey: documentOpenTarget.outputKey,
        trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR,
      }));
    } catch (error) {
      pushClientDebugEvent(buildClientDebugPayload(DEBUG_EVENT_TYPES.DOCUMENT_OPEN_FAILED, {
        taskId,
        runId: workflowState?.runId || urlRunId || "",
        phase: documentOpenTarget.phaseId,
        outputKey: documentOpenTarget.outputKey,
        message: error?.message || t("task.openDocumentInCodeFailed"),
        trigger: DEBUG_EVENT_TRIGGERS.TOOLBAR,
      }));
      showToast(error?.message || t("task.openDocumentInCodeFailed"));
    }
  }

  function handleResumePhase() {
    if (!canResumePhase) return;
    resumePhase(activePhase);
  }

  function handlePausePhase() {
    if (!canPausePhase) return;
    pausePhase(activePhase);
  }

  function handleRetryPhase() {
    if (!canRetryPhase) return;
    retryPhase(activePhase);
  }

  return (
    <>
      <WindowChrome />
      <div className="flex-1 flex min-h-0 flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-border/70 bg-background/55 px-8 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <BackButton to="/" label={t("common.back")} className="-ml-6 shrink-0" />
            <h1 className="truncate text-[18px] font-semibold text-foreground">{taskId}</h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5">
            {hasWorktreeRecord && (
              <div className="flex items-center gap-1.5 rounded-full bg-secondary/70 p-0.5">
                <div className="relative" ref={worktreeOpenMenuRef}>
                  <Badge
                    as="button"
                    type="button"
                    variant="secondary"
                    className={cn(
                      "border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isWorktreeCleaned
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer hover:border-border/80"
                    )}
                    title={isWorktreeCleaned ? t("task.gitWorktreeCleaned") : visibleWorktree.rootPath || worktreeDisplayName}
                    onClick={() => setShowWorktreeOpenMenu((value) => !value)}
                    disabled={isWorktreeCleaned}
                  >
                    {worktreeDisplayName
                      ? t("task.gitWorktreeNamed", { name: worktreeDisplayName })
                      : t("task.gitWorktree")}
                    {!isWorktreeCleaned && <ChevronDown className="ml-1 h-3 w-3" />}
                  </Badge>
                  {showWorktreeOpenMenu && !isWorktreeCleaned && (
                    <div
                      className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-md border border-border bg-card p-1 text-sm shadow-lg"
                      style={{ backgroundColor: "var(--card)" }}
                    >
                      {WORKTREE_EDITORS.map((editor) => (
                        <button
                          key={editor.key}
                          type="button"
                          className="flex w-full items-center rounded px-3 py-2 text-left text-card-foreground hover:bg-accent hover:text-accent-foreground"
                          onClick={() => handleOpenWorktree(editor.key)}
                        >
                          {editor.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {!isWorktreeCleaned && (
                  <Button
                    type="button"
                    variant="ghost"
                  size="sm"
                  className="h-6 rounded-full px-2 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => setShowRemoveWorktreeConfirm(true)}
                  disabled={isRemovingWorktree}
                >
                    {isRemovingWorktree ? <Loader2 className="h-3 w-3 animate-spin" /> : t("task.removeWorktree")}
                  </Button>
                )}
              </div>
            )}
            {canPausePhase && (
              <Button type="button" variant="outline" size="sm" onClick={handlePausePhase}>
                <Square className="h-3.5 w-3.5" />
                {t("task.pausePhase")}
              </Button>
            )}
            {canResumePhase && (
              <Button type="button" variant="outline" size="sm" onClick={handleResumePhase}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t("task.resumePhase")}
              </Button>
            )}
            {canRetryPhase && (
              <Button type="button" variant="outline" size="sm" onClick={handleRetryPhase}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t("task.retryPhase")}
              </Button>
            )}
            <ThemeToggle />
            <WorkflowDebugPanel
              taskId={taskId}
              workflowState={workflowState}
              activePhase={activePhase}
              activeStatus={activeStatus}
              debugEvents={debugEvents}
              lastEventAt={lastEventAt}
              lastError={lastError}
              phaseLabels={runWorkflowConfig?.phaseLabels || {}}
              onCopy={handleCopyDebugInfo}
            />
          </div>
        </div>
        <div className="grid flex-1 min-h-0 grid-cols-[340px_minmax(0,1fr)] bg-background/55">
          <aside className="flex min-h-0 flex-col overflow-hidden border-r border-border bg-card/70">
            <div className="border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">Task Steps</h2>
                <p className="text-xs text-muted-foreground">Workflow execution order.</p>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <RunStepList
                phases={phases}
                workflowConfig={runWorkflowConfig}
                selectedPhase={detailPhase}
                onSelect={(phase) => setSelectedPhase(phase, currentStateKey)}
              />
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-card/95">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-foreground">Run details</h2>
                  <p className="truncate text-xs text-muted-foreground">Selected workflow step output and conversation.</p>
                </div>
                <Badge variant={workflowState?.overallStatus === "completed" ? "success" : workflowState?.overallStatus === "awaiting_input" || workflowState?.overallStatus === "paused" ? "warning" : "outline"}>
                  {workflowState?.overallStatus || "unknown"}
                </Badge>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    setDeleteWorktree(hasWorktree);
                    setShowDeleteConfirm(true);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("stepList.deleteTask")}
                </Button>
              </div>
            </div>
            <StepDetail
              phase={detailPhase}
              content={activePhaseContent}
              artifact={activePhaseArtifact}
              interactions={activePhaseInteractions}
              emptyDocumentMessage={emptyDocumentMessage}
              activeBackend={activePhaseBackend}
              isStreaming={isPhaseStreaming}
              isRunning={isPhaseRunning}
              isAwaiting={isPhaseAwaiting}
              isFailed={isPhaseFailed}
              onApprove={approve}
              onReject={reject}
              onSendMessage={sendMessage}
              onOpenDocument={documentOpenTarget ? handleOpenDocument : undefined}
              phaseLabels={runWorkflowConfig?.phaseLabels || {}}
              phaseTypes={runWorkflowConfig?.phaseTypes || {}}
              rejectTargets={runWorkflowConfig?.rejectTargets || {}}
            />
          </section>
        </div>
      </div>

      <StartupProgressModal steps={startupSteps} t={t} />

      {showRemoveWorktreeConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => {
            if (!isRemovingWorktree) setShowRemoveWorktreeConfirm(false);
          }}
        >
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">{t("task.removeWorktreeConfirmTitle")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("task.removeWorktreeConfirm", { name: worktreeDisplayName || taskId })}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRemoveWorktreeConfirm(false)}
                disabled={isRemovingWorktree}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="destructive" size="sm" onClick={handleRemoveWorktree} disabled={isRemovingWorktree}>
                {isRemovingWorktree ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("task.removeWorktree")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => {
            if (!isDeletingTask) setShowDeleteConfirm(false);
          }}
        >
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            {isDeletingTask ? (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-info" />
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{t("task.deletingTask")}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{t("task.deletingTaskHint")}</p>
                  </div>
                </div>
                <div className="space-y-2 rounded-md border border-border bg-secondary/35 p-3 text-sm">
                  <div className="flex items-center gap-2 text-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />
                    <span>{t("task.deletingTaskData")}</span>
                  </div>
                  {hasWorktree && deleteWorktree && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Circle className="h-3.5 w-3.5" />
                      <span>{t("task.deletingWorktree")}</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-foreground mb-2">{t("task.deleteTask")}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("task.deleteTaskConfirm", { name: taskId })}
                </p>
              </>
            )}
            {hasWorktree && !isDeletingTask && (
              <label className="mb-4 flex items-start gap-3 rounded-md border border-border bg-secondary/40 p-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={deleteWorktree}
                  onChange={(event) => setDeleteWorktree(event.target.checked)}
                />
                <span>
                  <span className="block font-medium">
                    {worktreeDisplayName
                      ? t("task.deleteWorktreeNamed", { name: worktreeDisplayName })
                      : t("task.deleteWorktreeWithTask")}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t("task.deleteWorktreeHint")}
                  </span>
                </span>
              </label>
            )}
            {!isDeletingTask && (
              <div className="flex justify-end gap-3">
                <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>{t("common.cancel")}</Button>
                <Button variant="destructive" size="sm" onClick={handleDelete}>
                  {hasWorktree && deleteWorktree ? t("task.deleteTaskAndWorktree") : t("common.delete")}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
