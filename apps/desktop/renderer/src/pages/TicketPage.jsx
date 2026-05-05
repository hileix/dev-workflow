import { useState, useEffect } from "react";
import { CheckCircle2, Circle, Loader2, RotateCcw, Square } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import StepList from "../StepList";
import StepDetail from "../StepDetail";
import { BackButton } from "../components/back-button";
import { useI18n } from "../components/i18n-provider";
import { ThemeToggle } from "../components/theme-toggle";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { WindowChrome } from "../components/window-chrome";
import WorkflowDebugPanel from "../components/WorkflowDebugPanel";
import { getAppApi } from "../lib/api-client";
import { useWorkflowStore } from "../stores/workflowStore";
import { useConfigStore } from "../stores/configStore";

const appApi = getAppApi();

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

  const taskId = urlTicketId || activeTicket;
  const worktreeDisplayName = getWorktreeDisplayName(workflowState?.worktree);
  const hasWorktree = Boolean(workflowState?.worktree?.enabled);
  const currentPhase = workflowState?.currentPhase;
  const phases = workflowState?.phases || [];
  const activePhase = selectedPhase || currentPhase || phases[0]?.id || null;
  const activeStatus = phases.find((p) => (p.id || p.name) === activePhase)?.status;
  const isPhaseStreaming = isStreaming && activePhase === streamingPhase;
  const isPhaseRunning = activeStatus === "in_progress";
  const isPhaseAwaiting = activeStatus === "awaiting_input";
  const isPhaseFailed = activeStatus === "failed";
  const isAutoPhase = workflowConfig?.phaseTypes?.[activePhase] === "auto";
  const canPausePhase = Boolean(isAutoPhase && activePhase && activePhase === currentPhase && isPhaseRunning && !lastError);
  const canRestartPhase = Boolean(isAutoPhase && activePhase && activePhase === currentPhase && !isStreaming && (lastError || isPhaseAwaiting || isPhaseFailed));

  const isCheckpointPhase = workflowConfig?.phaseTypes?.[activePhase] === "checkpoint";
  const activePhaseContent = activePhase ? phaseMessages[activePhase] || "" : "";
  const activePhaseInputDocument = activePhase
    ? getCheckpointInputDocument(activePhase, workflowConfig, phaseOutputArtifacts, workflowState?.contextValues)
    : "";
  const activePhaseArtifact = activePhase
    ? isCheckpointPhase
      ? activePhaseInputDocument
      : getPhaseOutputDocument(activePhase, workflowConfig, phaseOutputArtifacts)
    : "";
  const documentOpenTarget = activePhase
    ? isCheckpointPhase
      ? getCheckpointDocumentTarget(activePhase, workflowConfig, phaseOutputArtifacts)
      : getPhaseOutputTarget(activePhase, workflowConfig, phaseOutputArtifacts)
    : null;
  const activePhaseInteractions = activePhase ? phaseInteractions[activePhase] || [] : [];
  const emptyDocumentMessage = getMissingDocumentMessage({
    t,
    phaseId: activePhase,
    workflowConfig,
    phaseOutputArtifacts,
    contextValues: workflowState?.contextValues,
    activeStatus,
    isCheckpointPhase,
  });
  const startupSteps = buildStartupSteps({
    t,
    debugEvents,
    workflowState,
    workflowConfig,
    connectionState,
  });

  async function handleDelete() {
    setShowDeleteConfirm(false);
    const deleted = await deleteTask(taskId, workflowState?.runId || urlRunId, {
      removeWorktree: hasWorktree && deleteWorktree,
    });
    if (deleted) navigate("/");
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
              phaseLabels={workflowConfig?.phaseLabels || {}}
              onCopy={handleCopyDebugInfo}
            />
          </div>
        </div>
        <div className="flex flex-1 min-h-0">
          <StepList
            phases={phases.map((p) => ({ name: p.id || p.name, status: p.status, updated: p.updated }))}
            currentPhase={currentPhase}
            selectedPhase={activePhase}
            onSelect={setSelectedPhase}
            phaseLabels={workflowConfig?.phaseLabels || {}}
            phaseTypes={workflowConfig?.phaseTypes || {}}
            onDelete={() => {
              setDeleteWorktree(hasWorktree);
              setShowDeleteConfirm(true);
            }}
          />
          <StepDetail
            phase={activePhase}
            content={activePhaseContent}
            artifact={activePhaseArtifact}
            interactions={activePhaseInteractions}
            emptyDocumentMessage={emptyDocumentMessage}
            activeBackend={workflowConfig?.phaseBackends?.[activePhase]}
            isStreaming={isPhaseStreaming}
            isRunning={isPhaseRunning}
            isAwaiting={isPhaseAwaiting}
            isFailed={isPhaseFailed}
            onApprove={approve}
            onReject={reject}
            onSendMessage={sendMessage}
            onOpenDocument={documentOpenTarget ? handleOpenDocument : undefined}
            phaseLabels={workflowConfig?.phaseLabels || {}}
            phaseTypes={workflowConfig?.phaseTypes || {}}
            rejectTargets={workflowConfig?.rejectTargets || {}}
          />
        </div>
      </div>

      <StartupProgressModal steps={startupSteps} t={t} />

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">{t("ticket.deleteTask")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("ticket.deleteTaskConfirm", { name: taskId })}
            </p>
            {hasWorktree && (
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
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>{t("common.cancel")}</Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                {hasWorktree && deleteWorktree ? t("ticket.deleteTaskAndWorktree") : t("common.delete")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
