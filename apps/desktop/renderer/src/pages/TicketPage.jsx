import { useState, useEffect, useMemo } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CheckCircle2, Circle, Loader2, RotateCcw, Square, Trash2 } from "lucide-react";
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
import { cn } from "../lib/utils";
import { useWorkflowStore } from "../stores/workflowStore";
import { useConfigStore } from "../stores/configStore";

const appApi = getAppApi();
const NODE_X = 24;
const NODE_Y_GAP = 190;

function getStatusTone(status) {
  if (status === "completed") return "success";
  if (status === "awaiting_input") return "warning";
  if (status === "in_progress") return "info";
  if (status === "failed") return "destructive";
  return "muted";
}

function getStatusLabel(status) {
  if (status === "completed") return "done";
  if (status === "awaiting_input") return "waiting";
  if (status === "in_progress") return "running";
  if (status === "failed") return "failed";
  return "pending";
}

function RunStepNode({ data }) {
  const tone = getStatusTone(data.status);
  const isCheckpoint = data.type === "checkpoint";
  const isCondition = data.type === "condition";

  return (
    <button
      type="button"
      className={cn(
        "w-[270px] rounded-lg border bg-card px-4 py-3 text-left shadow-sm transition-colors",
        data.selected ? "border-ring ring-2 ring-ring/25" : "border-border hover:border-ring/60",
        tone === "success" && "border-success/60",
        tone === "warning" && "border-warning/70",
        tone === "info" && "border-info/70",
        tone === "destructive" && "border-destructive/70"
      )}
      onClick={(event) => {
        event.stopPropagation();
        data.onSelect();
      }}
    >
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !border-2 !border-card !bg-muted-foreground" />
      <Handle id="return" type="target" position={Position.Right} isConnectable={false} className="!top-1/2 !h-3 !w-3 !border-0 !bg-transparent" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{data.label}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{data.id}</div>
        </div>
        <Badge
          variant={
            tone === "success" ? "success" :
              tone === "warning" ? "warning" :
                tone === "info" ? "info" :
                  tone === "destructive" ? "destructive" : "outline"
          }
          className={cn("shrink-0 text-[10px]", tone === "info" && "animate-pulse-subtle")}
        >
          {getStatusLabel(data.status)}
        </Badge>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
        <span>{isCheckpoint ? "checkpoint" : isCondition ? "conditional gate" : data.backend || "agent"}</span>
        {data.updated && <span className="font-mono">{data.updated}</span>}
      </div>
      <div className="mt-1 truncate text-[10px] text-muted-foreground">outputs: {data.outputs}</div>
      {isCheckpoint ? (
        <>
          <Handle id="approve" type="source" position={Position.Bottom} className="!left-1/2 !h-3 !w-3 !-translate-x-1/2 !border-2 !border-card !bg-success" />
          <Handle id="reject" type="source" position={Position.Right} className="!top-1/2 !h-3 !w-3 !-translate-y-1/2 !border-2 !border-card !bg-warning" />
        </>
      ) : isCondition ? (
        <>
          <Handle id="pass" type="source" position={Position.Bottom} className="!left-1/2 !h-3 !w-3 !-translate-x-1/2 !border-2 !border-card !bg-success" />
          <Handle id="fail" type="source" position={Position.Right} className="!top-1/2 !h-3 !w-3 !-translate-y-1/2 !border-2 !border-card !bg-warning" />
        </>
      ) : (
        <Handle id="next" type="source" position={Position.Bottom} className="!h-3 !w-3 !border-2 !border-card !bg-primary" />
      )}
    </button>
  );
}

const runNodeTypes = {
  runStep: RunStepNode,
};

function RunRouteEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  label,
  labelStyle,
  labelBgPadding,
  labelBgBorderRadius,
  data,
}) {
  const isBackRoute = data?.sourceIndex >= data?.targetIndex;
  const isRejectRoute = data?.routeKind === "reject" || data?.routeKind === "fail";
  const isReturnRoute = isBackRoute || isRejectRoute;
  const routeSpan = Math.max(0, (data?.sourceIndex ?? 0) - (data?.targetIndex ?? 0));
  const sideGap = isRejectRoute ? 28 + routeSpan * 14 : 32;
  let path;
  let labelX;
  let labelY;

  if (isReturnRoute) {
    const laneX = Math.max(sourceX, targetX) + sideGap;
    path = `M ${sourceX},${sourceY} H ${laneX} V ${targetY} H ${targetX}`;
    labelX = laneX;
    labelY = sourceY + (targetY - sourceY) / 2;
  } else {
    const laneY = sourceY + (targetY - sourceY) / 2;
    path = `M ${sourceX},${sourceY} V ${laneY} H ${targetX} V ${targetY}`;
    labelX = sourceX + (targetX - sourceX) / 2;
    labelY = laneY;
  }

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={style}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelStyle={labelStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      interactionWidth={28}
    />
  );
}

const runEdgeTypes = {
  runRoute: RunRouteEdge,
};

function getWorktreeDisplayName(worktree) {
  if (!worktree?.enabled) return "";
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

function buildRunNodes({ phases, workflowConfig, selectedPhase, onSelect }) {
  const nodePositions = Object.fromEntries((workflowConfig?.graph?.nodes || []).map((node, index) => [
    node.id,
    node.position || { x: NODE_X, y: 80 + index * NODE_Y_GAP },
  ]));
  return (phases || []).map((phase, index) => {
    const phaseId = phase.id || phase.name;
    const position = nodePositions[phaseId] || { x: NODE_X, y: 80 + index * NODE_Y_GAP };
    return {
      id: phaseId,
      type: "runStep",
      position,
      data: {
        id: phaseId,
        label: workflowConfig?.phaseLabels?.[phaseId] || phaseId,
        type: workflowConfig?.phaseTypes?.[phaseId] || "auto",
        backend: workflowConfig?.phaseBackends?.[phaseId] || "",
        status: phase.status || "pending",
        updated: formatNodeUpdated(phase.updated),
        outputs: getPhaseOutputSummary(phaseId, workflowConfig),
        selected: phaseId === selectedPhase,
        onSelect: () => onSelect(phaseId),
      },
    };
  });
}

function buildRunEdges(phases, workflowConfig) {
  const ids = (phases || []).map((phase) => phase.id || phase.name).filter(Boolean);
  const knownIds = new Set(ids);
  const phaseIndexById = new Map(ids.map((id, index) => [id, index]));
  const edges = [];

  const getBaseEdge = (phaseId, targetId, sourceHandle, label, color, dashed = false, edgeId = "") => ({
    id: edgeId || `${phaseId}-${sourceHandle}-${targetId}`,
    source: phaseId,
    target: targetId,
    sourceHandle,
    targetHandle: sourceHandle === "reject" || sourceHandle === "fail" ? "return" : undefined,
    label,
    type: "runRoute",
    animated: dashed,
    markerEnd: { type: MarkerType.ArrowClosed, color },
    style: { stroke: color, strokeWidth: 1.8, ...(dashed ? { strokeDasharray: "5 4" } : {}) },
    labelStyle: { fill: color, fontSize: 11, fontWeight: 700 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
    data: {
      routeKind: sourceHandle,
      sourceIndex: phaseIndexById.get(phaseId) ?? 0,
      targetIndex: phaseIndexById.get(targetId) ?? 0,
    },
  });

  const graphEdges = workflowConfig?.graph?.edges || [];
  if (graphEdges.length > 0) {
    for (const edge of graphEdges) {
      if (!knownIds.has(edge.source) || !knownIds.has(edge.target)) continue;
      const routeKind = edge.routeKind || edge.sourceHandle || "next";
      const color = routeKind === "reject" || routeKind === "fail"
        ? "#d97706"
        : routeKind === "approve" || routeKind === "pass"
          ? "#16a34a"
          : "#2563eb";
      edges.push(getBaseEdge(
        edge.source,
        edge.target,
        edge.sourceHandle || routeKind,
        edge.label || "",
        color,
        routeKind === "reject" || routeKind === "fail",
        edge.id,
      ));
    }
    return edges;
  }

  ids.forEach((phaseId, index) => {
    const nextId = ids[index + 1];
    const phaseType = workflowConfig?.phaseTypes?.[phaseId] || "auto";
    const conditionRoutes = workflowConfig?.conditionRoutes?.[phaseId] || {};

    if (phaseType === "condition") {
      if (conditionRoutes.passTo && knownIds.has(conditionRoutes.passTo)) {
        edges.push(getBaseEdge(phaseId, conditionRoutes.passTo, "pass", "pass", "#16a34a"));
      }
      if (conditionRoutes.failTo && knownIds.has(conditionRoutes.failTo)) {
        edges.push(getBaseEdge(phaseId, conditionRoutes.failTo, "fail", "fail", "#d97706", true));
      }
      return;
    }

    if (nextId) {
      edges.push(getBaseEdge(phaseId, nextId, "next", "", "#2563eb"));
    }

    const rejectTargets = workflowConfig?.rejectTargets?.[phaseId] || [];
    rejectTargets.forEach((targetId) => {
      if (!knownIds.has(targetId)) return;
      edges.push(getBaseEdge(phaseId, targetId, "reject", "reject", "#d97706", true));
    });
  });

  return edges;
}

function getCheckpointInputDocument(phaseId, workflowConfig, phaseOutputArtifacts, contextValues) {
  const inputs = workflowConfig?.phaseInputs?.[phaseId] || [];
  const documents = [];

  for (const input of inputs) {
    if (!input) continue;
    let label = input.contextLabel || input.name || input.outputKey || input.phaseId || "Input";
    let content = "";

    if (input.sourceType === "workflow_context") {
      content = contextValues?.[input.name] || "";
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

function getDocumentContentForInput(input, phaseOutputArtifacts, contextValues) {
  if (input.sourceType === "workflow_context") return contextValues?.[input.name] || "";
  if (input.sourceType !== "phase_output" || !input.phaseId) return "";
  return input.outputKey ? phaseOutputArtifacts?.[input.phaseId]?.[input.outputKey] || "" : "";
}

function getMissingDocumentMessage({ t, phaseId, workflowConfig, phaseOutputArtifacts, contextValues, activeStatus, isCheckpointPhase }) {
  if (!phaseId || activeStatus === "pending") return "";

  if (isCheckpointPhase) {
    const inputs = workflowConfig?.phaseInputs?.[phaseId] || [];
    const missingInput = inputs.find((input) =>
      input.required !== false && !String(getDocumentContentForInput(input, phaseOutputArtifacts, contextValues) || "").trim()
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

  const receivedState = hasEvent(debugEvents, "state") || workflowState?.overallStatus !== "loading";
  const worktreeEnabled = Boolean(workflowConfig?.worktree?.enabled || workflowState?.worktree?.enabled);
  const worktreeNamingStarted = hasEvent(debugEvents, "worktree_naming_started");
  const worktreeNamingDone = hasEvent(debugEvents, "worktree_naming_completed");
  const worktreePreparing = hasEvent(debugEvents, "worktree_preparing");
  const worktreeReady = hasEvent(debugEvents, "worktree_ready") || Boolean(workflowState?.worktree?.enabled);

  const steps = [
    {
      key: "connect",
      label: t("stepDetail.startupConnect"),
      status: stepStatus(receivedState || hasEvent(debugEvents, "workflow_starting"), connectionState === "connecting"),
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
      status: stepStatus(receivedState, worktreeEnabled ? worktreeReady : hasEvent(debugEvents, "workflow_starting")),
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

export default function TicketPage() {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteWorktree, setDeleteWorktree] = useState(false);
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const navigate = useNavigate();
  const { id: urlTicketId } = useParams();
  const [searchParams] = useSearchParams();
  const urlRunId = searchParams.get("runId") || "";
  const { t } = useI18n();

  const activeTicket = useWorkflowStore((s) => s.activeTicket);
  const loadTicket = useWorkflowStore((s) => s.loadTicket);
  const showToast = useWorkflowStore((s) => s.showToast);
  const workflowState = useWorkflowStore((s) => s.workflowState);

  useEffect(() => {
    if (urlTicketId && (urlTicketId !== activeTicket || workflowState?.taskId !== urlTicketId || (urlRunId && workflowState?.runId !== urlRunId))) {
      loadTicket(urlTicketId, urlRunId);
    }
  }, [urlTicketId, urlRunId, activeTicket, workflowState?.taskId, workflowState?.runId]);
  const selectedPhase = useWorkflowStore((s) => s.selectedPhase);
  const setSelectedPhase = useWorkflowStore((s) => s.setSelectedPhase);
  const phaseMessages = useWorkflowStore((s) => s.phaseMessages);
  const phaseOutputArtifacts = useWorkflowStore((s) => s.phaseOutputArtifacts);
  const phaseInteractions = useWorkflowStore((s) => s.phaseInteractions);
  const isStreaming = useWorkflowStore((s) => s.isStreaming);
  const streamingPhase = useWorkflowStore((s) => s.streamingPhase);
  const debugEvents = useWorkflowStore((s) => s.debugEvents);
  const connectionState = useWorkflowStore((s) => s.connectionState);
  const lastEventAt = useWorkflowStore((s) => s.lastEventAt);
  const lastError = useWorkflowStore((s) => s.lastError);
  const approve = useWorkflowStore((s) => s.approve);
  const reject = useWorkflowStore((s) => s.reject);
  const sendMessage = useWorkflowStore((s) => s.sendMessage);
  const restartPhase = useWorkflowStore((s) => s.restartPhase);
  const pausePhase = useWorkflowStore((s) => s.pausePhase);
  const deleteTask = useWorkflowStore((s) => s.deleteTask);
  const workflowConfig = useConfigStore((s) => s.workflowConfig);
  const runWorkflowConfig = workflowState?.workflowConfig || workflowConfig;

  const taskId = urlTicketId || activeTicket;
  const worktreeDisplayName = getWorktreeDisplayName(workflowState?.worktree);
  const hasWorktree = Boolean(workflowState?.worktree?.enabled);
  const currentPhase = workflowState?.currentPhase;
  const phases = workflowState?.phases || [];
  const selectedRunPhase = selectedPhase;
  const activePhase = selectedRunPhase || currentPhase || phases[0]?.id || null;
  const activeStatus = phases.find((p) => (p.id || p.name) === activePhase)?.status;
  const isActivePhaseRunning = activeStatus === "in_progress";
  const isActivePhaseAwaiting = activeStatus === "awaiting_input";
  const isActivePhaseFailed = activeStatus === "failed";
  const isAutoPhase = runWorkflowConfig?.phaseTypes?.[activePhase] === "auto" || runWorkflowConfig?.phaseTypes?.[activePhase] === "condition";
  const canPausePhase = Boolean(isAutoPhase && activePhase && activePhase === currentPhase && isActivePhaseRunning && !lastError);
  const canRestartPhase = Boolean(isAutoPhase && activePhase && activePhase === currentPhase && !isStreaming && (lastError || isActivePhaseAwaiting || isActivePhaseFailed));

  const detailPhase = activePhase;
  const detailStatus = phases.find((p) => (p.id || p.name) === detailPhase)?.status;
  const isPhaseStreaming = isStreaming && detailPhase === streamingPhase;
  const isPhaseRunning = detailStatus === "in_progress";
  const isPhaseAwaiting = detailStatus === "awaiting_input";
  const isPhaseFailed = detailStatus === "failed";
  const isCheckpointPhase = runWorkflowConfig?.phaseTypes?.[detailPhase] === "checkpoint";
  const activePhaseContent = detailPhase ? phaseMessages[detailPhase] || "" : "";
  const activePhaseInputDocument = detailPhase
    ? getCheckpointInputDocument(detailPhase, runWorkflowConfig, phaseOutputArtifacts, workflowState?.contextValues)
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
    contextValues: workflowState?.contextValues,
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
  const runNodes = useMemo(() => buildRunNodes({
    phases,
    workflowConfig: runWorkflowConfig,
    selectedPhase: detailPhase,
    onSelect: setSelectedPhase,
  }), [phases, runWorkflowConfig, detailPhase, setSelectedPhase]);
  const runEdges = useMemo(() => buildRunEdges(phases, runWorkflowConfig), [phases, runWorkflowConfig]);

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
    showToast(t("ticket.deleteTaskFailed"));
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

  async function handleOpenWorktree() {
    const targetPath = workflowState?.worktree?.rootPath || workflowState?.workFolder;
    if (!targetPath) return;
    try {
      await appApi.openInCode(targetPath);
    } catch (error) {
      showToast(error?.message || t("ticket.openInCodeFailed"));
    }
  }

  async function handleOpenDocument() {
    if (!taskId || !documentOpenTarget) return;
    try {
      await appApi.openTaskOutputInCode(
        taskId,
        workflowState?.runId || urlRunId || "",
        documentOpenTarget.phaseId,
        documentOpenTarget.outputKey,
      );
    } catch (error) {
      showToast(error?.message || t("ticket.openDocumentInCodeFailed"));
    }
  }

  function handleRestartPhase() {
    if (!canRestartPhase) return;
    restartPhase(activePhase);
  }

  function handlePausePhase() {
    if (!canPausePhase) return;
    pausePhase(activePhase);
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
            {workflowState?.worktree?.enabled && (
              <Badge
                as="button"
                type="button"
                variant="secondary"
                className="cursor-pointer border border-transparent hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                title={workflowState.worktree.rootPath || worktreeDisplayName}
                onClick={handleOpenWorktree}
              >
                {worktreeDisplayName
                  ? t("ticket.gitWorktreeNamed", { name: worktreeDisplayName })
                  : t("ticket.gitWorktree")}
              </Badge>
            )}
            {isStreaming && (
              <Badge variant="info" className="animate-pulse-subtle">{t("ticket.working")}</Badge>
            )}
            {canPausePhase && (
              <Button type="button" variant="outline" size="sm" onClick={handlePausePhase}>
                <Square className="h-3.5 w-3.5" />
                {t("ticket.pausePhase")}
              </Button>
            )}
            {canRestartPhase && (
              <Button type="button" variant="outline" size="sm" onClick={handleRestartPhase}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t("ticket.restartPhase")}
              </Button>
            )}
            <ThemeToggle />
            <WorkflowDebugPanel
              ticketId={taskId}
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
        <div className="grid flex-1 min-h-0 grid-cols-[320px_minmax(0,1fr)] bg-background/55">
          <aside className="flex min-h-0 flex-col overflow-hidden border-r border-border bg-card/70">
            <div className="border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">Task Run Graph</h2>
                <p className="text-xs text-muted-foreground">Workflow execution order.</p>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ReactFlow
                nodes={runNodes}
                edges={runEdges}
                nodeTypes={runNodeTypes}
                edgeTypes={runEdgeTypes}
                onNodeClick={(event, node) => {
                  event.stopPropagation();
                  setSelectedPhase(node.id);
                }}
                defaultViewport={{ x: 16, y: 36, zoom: 0.92 }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                deleteKeyCode={null}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="var(--border-color)" gap={18} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-card/95">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-foreground">Run details</h2>
                  <p className="truncate text-xs text-muted-foreground">Selected workflow step output and conversation.</p>
                </div>
                <Badge variant={workflowState?.overallStatus === "completed" ? "success" : workflowState?.overallStatus === "awaiting_input" ? "warning" : "outline"}>
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
                    <h3 className="text-sm font-semibold text-foreground">{t("ticket.deletingTask")}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{t("ticket.deletingTaskHint")}</p>
                  </div>
                </div>
                <div className="space-y-2 rounded-md border border-border bg-secondary/35 p-3 text-sm">
                  <div className="flex items-center gap-2 text-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />
                    <span>{t("ticket.deletingTaskData")}</span>
                  </div>
                  {hasWorktree && deleteWorktree && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Circle className="h-3.5 w-3.5" />
                      <span>{t("ticket.deletingWorktree")}</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-foreground mb-2">{t("ticket.deleteTask")}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("ticket.deleteTaskConfirm", { name: taskId })}
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
                      ? t("ticket.deleteWorktreeNamed", { name: worktreeDisplayName })
                      : t("ticket.deleteWorktreeWithTask")}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t("ticket.deleteWorktreeHint")}
                  </span>
                </span>
              </label>
            )}
            {!isDeletingTask && (
              <div className="flex justify-end gap-3">
                <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>{t("common.cancel")}</Button>
                <Button variant="destructive" size="sm" onClick={handleDelete}>
                  {hasWorktree && deleteWorktree ? t("ticket.deleteTaskAndWorktree") : t("common.delete")}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
