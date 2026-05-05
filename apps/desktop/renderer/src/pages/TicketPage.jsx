import { useState, useEffect } from "react";
import { RotateCcw, Square } from "lucide-react";
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

function getCheckpointInputDocument(phaseId, workflowConfig, phaseArtifacts, phaseMessages, contextValues) {
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
      content = phaseArtifacts?.[input.phaseId] || phaseMessages?.[input.phaseId] || "";
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

export default function TicketPage() {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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
  const phaseArtifacts = useWorkflowStore((s) => s.phaseArtifacts);
  const phaseInteractions = useWorkflowStore((s) => s.phaseInteractions);
  const isStreaming = useWorkflowStore((s) => s.isStreaming);
  const streamingPhase = useWorkflowStore((s) => s.streamingPhase);
  const debugEvents = useWorkflowStore((s) => s.debugEvents);
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
  const currentPhase = workflowState?.currentPhase;
  const phases = workflowState?.phases || [];
  const activePhase = selectedPhase || currentPhase || phases[0]?.id || null;
  const activeStatus = phases.find((p) => (p.id || p.name) === activePhase)?.status;
  const isPhaseStreaming = isStreaming && activePhase === streamingPhase;
  const isPhaseRunning = activeStatus === "in_progress";
  const isPhaseAwaiting = activeStatus === "awaiting_input";
  const isAutoPhase = workflowConfig?.phaseTypes?.[activePhase] === "auto";
  const canPausePhase = Boolean(isAutoPhase && activePhase && activePhase === currentPhase && isPhaseRunning && !lastError);
  const canRestartPhase = Boolean(isAutoPhase && activePhase && activePhase === currentPhase && !isStreaming && (lastError || isPhaseAwaiting));

  const isCheckpointPhase = workflowConfig?.phaseTypes?.[activePhase] === "checkpoint";
  const activePhaseContent = activePhase ? phaseMessages[activePhase] || "" : "";
  const activePhaseInputDocument = activePhase
    ? getCheckpointInputDocument(activePhase, workflowConfig, phaseArtifacts, phaseMessages, workflowState?.contextValues)
    : "";
  const activePhaseArtifact = activePhase
    ? isCheckpointPhase
      ? activePhaseInputDocument || phaseArtifacts[activePhase] || ""
      : phaseArtifacts[activePhase] || ""
    : "";
  const activePhaseInteractions = activePhase ? phaseInteractions[activePhase] || [] : [];

  async function handleDelete() {
    setShowDeleteConfirm(false);
    const deleted = await deleteTask(taskId, workflowState?.runId || urlRunId);
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
            onDelete={() => setShowDeleteConfirm(true)}
          />
          <StepDetail
            phase={activePhase}
            content={activePhaseContent}
            artifact={activePhaseArtifact}
            interactions={activePhaseInteractions}
            activeBackend={workflowConfig?.phaseBackends?.[activePhase]}
            isStreaming={isPhaseStreaming}
            isRunning={isPhaseRunning}
            isAwaiting={isPhaseAwaiting}
            onApprove={approve}
            onReject={reject}
            onSendMessage={sendMessage}
            phaseLabels={workflowConfig?.phaseLabels || {}}
            phaseTypes={workflowConfig?.phaseTypes || {}}
            rejectTargets={workflowConfig?.rejectTargets || {}}
          />
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">{t("ticket.deleteTask")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("ticket.deleteTaskConfirm", { name: taskId })}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>{t("common.cancel")}</Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>{t("common.delete")}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
