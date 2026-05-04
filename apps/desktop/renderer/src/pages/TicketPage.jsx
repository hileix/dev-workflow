import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
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

function getActivePhaseForGroup(groupKey, phases, groups) {
  const group = groups.find((g) => g.key === groupKey);
  if (!group) return null;
  for (const pid of group.phases) {
    const p = phases.find((ph) => (ph.id || ph.name) === pid);
    if (p?.status === "awaiting_input") return pid;
  }
  for (const pid of group.phases) {
    const p = phases.find((ph) => (ph.id || ph.name) === pid);
    if (p?.status === "in_progress") return pid;
  }
  for (const pid of [...group.phases].reverse()) {
    const p = phases.find((ph) => (ph.id || ph.name) === pid);
    if (p?.status === "completed") return pid;
  }
  return group.phases[0];
}

function getWorktreeDisplayName(worktree) {
  if (!worktree?.enabled) return "";
  if (worktree.branchName) return worktree.branchName;
  if (worktree.rootPath) {
    const parts = String(worktree.rootPath).split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || "";
  }
  return "";
}

export default function TicketPage() {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const navigate = useNavigate();
  const { id: urlTicketId } = useParams();
  const { t } = useI18n();

  const activeTicket = useWorkflowStore((s) => s.activeTicket);
  const loadTicket = useWorkflowStore((s) => s.loadTicket);
  const showToast = useWorkflowStore((s) => s.showToast);

  useEffect(() => {
    if (urlTicketId && urlTicketId !== activeTicket) {
      loadTicket(urlTicketId);
    }
  }, [urlTicketId]);
  const workflowState = useWorkflowStore((s) => s.workflowState);
  const selectedGroup = useWorkflowStore((s) => s.selectedGroup);
  const setSelectedGroup = useWorkflowStore((s) => s.setSelectedGroup);
  const phaseMessages = useWorkflowStore((s) => s.phaseMessages);
  const phaseArtifacts = useWorkflowStore((s) => s.phaseArtifacts);
  const isStreaming = useWorkflowStore((s) => s.isStreaming);
  const streamingPhase = useWorkflowStore((s) => s.streamingPhase);
  const debugEvents = useWorkflowStore((s) => s.debugEvents);
  const lastEventAt = useWorkflowStore((s) => s.lastEventAt);
  const lastError = useWorkflowStore((s) => s.lastError);
  const approve = useWorkflowStore((s) => s.approve);
  const reject = useWorkflowStore((s) => s.reject);
  const sendMessage = useWorkflowStore((s) => s.sendMessage);
  const deleteTask = useWorkflowStore((s) => s.deleteTask);
  const workflowConfig = useConfigStore((s) => s.workflowConfig);

  const taskId = activeTicket || urlTicketId;
  const worktreeDisplayName = getWorktreeDisplayName(workflowState?.worktree);
  const currentPhase = workflowState?.currentPhase;
  const phases = workflowState?.phases || [];
  const groups = workflowConfig?.groups || [];
  const activePhase = getActivePhaseForGroup(selectedGroup, phases, groups);
  const activeStatus = phases.find((p) => (p.id || p.name) === activePhase)?.status;
  const isPhaseStreaming = isStreaming && activePhase === streamingPhase;
  const isPhaseRunning = activeStatus === "in_progress";
  const isPhaseAwaiting = activeStatus === "awaiting_input";

  const selectedGroupObj = groups.find((g) => g.key === selectedGroup);
  const allGroupContent = selectedGroupObj
    ? selectedGroupObj.phases
        .map((pid) => phaseMessages[pid])
        .filter(Boolean)
        .join("\n\n---\n\n")
    : "";

  const groupArtifact = selectedGroupObj
    ? selectedGroupObj.phases
        .map((pid) => phaseArtifacts[pid])
        .filter(Boolean)
        .join("\n\n---\n\n")
    : "";

  async function handleDelete() {
    setShowDeleteConfirm(false);
    await deleteTask();
    navigate("/");
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
            selectedGroup={selectedGroup}
            onSelect={setSelectedGroup}
            groups={groups}
            phaseLabels={workflowConfig?.phaseLabels || {}}
            onDelete={() => setShowDeleteConfirm(true)}
          />
          <StepDetail
            phase={activePhase}
            content={allGroupContent}
            artifact={groupArtifact}
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
