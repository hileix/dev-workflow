import { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import StepList from "../StepList";
import StepDetail from "../StepDetail";
import { ThemeToggle } from "../components/theme-toggle";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useWorkflowStore } from "../stores/workflowStore";
import { useConfigStore } from "../stores/configStore";

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

export default function TicketPage() {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const navigate = useNavigate();
  const { id: urlTicketId } = useParams();

  const activeTicket = useWorkflowStore((s) => s.activeTicket);
  const loadTicket = useWorkflowStore((s) => s.loadTicket);

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
  const approve = useWorkflowStore((s) => s.approve);
  const reject = useWorkflowStore((s) => s.reject);
  const sendMessage = useWorkflowStore((s) => s.sendMessage);
  const deleteTask = useWorkflowStore((s) => s.deleteTask);
  const workflowConfig = useConfigStore((s) => s.workflowConfig);

  const ticketId = activeTicket || urlTicketId;
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

  return (
    <>
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors text-sm">&larr; Back</Link>
          <h1 className="text-lg font-semibold text-foreground">{ticketId}</h1>
          {isStreaming && (
            <Badge variant="info" className="animate-pulse-subtle">Working...</Badge>
          )}
        </div>
        <ThemeToggle />
      </div>
      <div className="flex-1 flex min-h-0">
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

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">Delete Task</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to delete <strong>{ticketId}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
