import { useEffect, useState } from "react";
import { AlertTriangle, Bug, Copy, X } from "lucide-react";
import { DEBUG_EVENT_REQUESTED_BY, DEBUG_EVENT_TRIGGERS, DEBUG_EVENT_TYPES } from "../lib/debug-events";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { useI18n } from "./i18n-provider";

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], { hour12: false });
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

function truncate(value, max = 96) {
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function formatControlSource(payload, t) {
  if (payload?.requestedBy === DEBUG_EVENT_REQUESTED_BY.USER) {
    if (payload?.trigger === DEBUG_EVENT_TRIGGERS.TOOLBAR) return t("debug.summaryToolbar");
    if (payload?.trigger === DEBUG_EVENT_TRIGGERS.CHECKPOINT) return t("debug.summaryCheckpoint");
    if (payload?.trigger === DEBUG_EVENT_TRIGGERS.CHAT) return t("debug.summaryChat");
    return t("debug.summaryUser");
  }
  return "";
}

function getEventSummary(event, t) {
  const payload = event?.payload || {};
  if (payload.type === "state") {
    return `${payload.state?.currentPhase || "--"} · ${payload.state?.overallStatus || "--"}`;
  }
  if (payload.type === "text_delta") {
    return t("debug.summaryTextDelta", { count: payload.text?.length || 0 });
  }
  if (payload.type === "tool_use") {
    return payload.log || payload.name || t("debug.unknown");
  }
  if (payload.type === "backend_selected") {
    const mode = payload.resumed ? t("debug.resumed") : t("debug.started");
    return `${payload.backend || t("debug.unknown")} · ${mode}`;
  }
  if (payload.type === "session_attached") {
    return truncate(payload.sessionId, 48);
  }
  if (payload.type === DEBUG_EVENT_TYPES.PHASE_FAILED || payload.type === DEBUG_EVENT_TYPES.ERROR) {
    return truncate(payload.message || t("debug.unknown"));
  }
  if (payload.type === "user_message") {
    return truncate(payload.text || "");
  }
  if (payload.type === "phase_artifact") {
    return t("debug.summaryArtifact");
  }
  if (payload.type === "phase_content") {
    return t("debug.summaryContent");
  }
  if (payload.type === DEBUG_EVENT_TYPES.WORKFLOW_STARTING) {
    return t("debug.summaryWorkflowStarting");
  }
  if (payload.type === DEBUG_EVENT_TYPES.WORKTREE_NAMING_STARTED) {
    return t("debug.summaryWorktreeNamingStarted");
  }
  if (payload.type === DEBUG_EVENT_TYPES.WORKTREE_NAMING_COMPLETED) {
    return payload.name ? `${t("debug.summaryWorktreeNamingCompleted")} · ${payload.name}` : t("debug.summaryWorktreeNamingCompleted");
  }
  if (payload.type === DEBUG_EVENT_TYPES.WORKTREE_PREPARING) {
    return payload.name ? `${t("debug.summaryWorktreePreparing")} · ${payload.name}` : t("debug.summaryWorktreePreparing");
  }
  if (payload.type === DEBUG_EVENT_TYPES.WORKTREE_READY) {
    return payload.branchName || payload.rootPath || t("debug.summaryWorktreeReady");
  }
  if (payload.type === DEBUG_EVENT_TYPES.PHASE_PAUSED) {
    const source = formatControlSource(payload, t);
    return source ? `${t("debug.summaryPaused")} · ${source}` : t("debug.summaryPaused");
  }
  if (payload.type === DEBUG_EVENT_TYPES.PHASE_RESUMED || payload.type === DEBUG_EVENT_TYPES.PHASE_RESUME_REQUESTED) {
    const source = formatControlSource(payload, t);
    return source ? `${t("debug.summaryResumed")} · ${source}` : t("debug.summaryResumed");
  }
  if (payload.type === DEBUG_EVENT_TYPES.PHASE_RETRIED || payload.type === DEBUG_EVENT_TYPES.PHASE_RETRY_REQUESTED) {
    const source = formatControlSource(payload, t);
    return source ? `${t("debug.summaryRetried")} · ${source}` : t("debug.summaryRetried");
  }
  if (payload.type === DEBUG_EVENT_TYPES.PHASE_APPROVED || payload.type === DEBUG_EVENT_TYPES.PHASE_APPROVE_REQUESTED) {
    const source = formatControlSource(payload, t);
    return source ? `${t("debug.summaryApproved")} · ${source}` : t("debug.summaryApproved");
  }
  if (payload.type === DEBUG_EVENT_TYPES.PHASE_REJECTED || payload.type === DEBUG_EVENT_TYPES.PHASE_REJECT_REQUESTED) {
    const source = formatControlSource(payload, t);
    return source ? `${t("debug.summaryRejected")} · ${source}` : t("debug.summaryRejected");
  }
  if (payload.type === DEBUG_EVENT_TYPES.PHASE_MESSAGE_REQUESTED) {
    const source = formatControlSource(payload, t);
    return source ? `${t("debug.summaryMessage")} · ${source}` : t("debug.summaryMessage");
  }
  if (payload.type === DEBUG_EVENT_TYPES.TASK_DELETE_REQUESTED) {
    return t("debug.summaryDeleteTask");
  }
  if (payload.type === DEBUG_EVENT_TYPES.TASK_DELETED) {
    return t("debug.summaryTaskDeleted");
  }
  if (payload.type === DEBUG_EVENT_TYPES.TASK_DELETE_FAILED) {
    return t("debug.summaryTaskDeleteFailed");
  }
  if (payload.type === DEBUG_EVENT_TYPES.WORKTREE_REMOVE_REQUESTED) {
    return t("debug.summaryRemoveWorktree");
  }
  if (payload.type === DEBUG_EVENT_TYPES.WORKTREE_REMOVED) {
    return t("debug.summaryWorktreeRemoved");
  }
  if (payload.type === DEBUG_EVENT_TYPES.WORKTREE_REMOVE_FAILED) {
    return t("debug.summaryWorktreeRemoveFailed");
  }
  if (payload.type === DEBUG_EVENT_TYPES.WORKTREE_OPEN_REQUESTED) {
    return t("debug.summaryOpenWorktree");
  }
  if (payload.type === DEBUG_EVENT_TYPES.WORKTREE_OPENED) {
    return t("debug.summaryWorktreeOpened");
  }
  if (payload.type === DEBUG_EVENT_TYPES.WORKTREE_OPEN_FAILED) {
    return t("debug.summaryWorktreeOpenFailed");
  }
  if (payload.type === DEBUG_EVENT_TYPES.DOCUMENT_OPEN_REQUESTED) {
    return t("debug.summaryOpenDocument");
  }
  if (payload.type === DEBUG_EVENT_TYPES.DOCUMENT_OPENED) {
    return t("debug.summaryDocumentOpened");
  }
  if (payload.type === DEBUG_EVENT_TYPES.DOCUMENT_OPEN_FAILED) {
    return t("debug.summaryDocumentOpenFailed");
  }
  if (payload.type === "phase_done" || payload.type === "phase_completed") {
    return t("debug.summaryDone");
  }
  if (payload.type === DEBUG_EVENT_TYPES.CLIENT_CONNECT) {
    return truncate(payload.workFolder || "");
  }
  if (payload.type === DEBUG_EVENT_TYPES.CLIENT_DETACH) {
    return t("debug.summaryDetached");
  }
  return truncate(JSON.stringify(payload));
}

function isFailureEvent(payload) {
  return payload?.type === DEBUG_EVENT_TYPES.ERROR || payload?.type === DEBUG_EVENT_TYPES.PHASE_FAILED;
}

function isPhaseControlEvent(payload) {
  return payload?.type === DEBUG_EVENT_TYPES.PHASE_PAUSED
    || payload?.type === DEBUG_EVENT_TYPES.PHASE_RESUMED
    || payload?.type === DEBUG_EVENT_TYPES.PHASE_RETRIED
    || payload?.type === DEBUG_EVENT_TYPES.PHASE_APPROVED
    || payload?.type === DEBUG_EVENT_TYPES.PHASE_REJECTED
    || payload?.type === DEBUG_EVENT_TYPES.PHASE_RESUME_REQUESTED
    || payload?.type === DEBUG_EVENT_TYPES.PHASE_RETRY_REQUESTED
    || payload?.type === DEBUG_EVENT_TYPES.PHASE_PAUSE_REQUESTED
    || payload?.type === DEBUG_EVENT_TYPES.PHASE_APPROVE_REQUESTED
    || payload?.type === DEBUG_EVENT_TYPES.PHASE_REJECT_REQUESTED
    || payload?.type === DEBUG_EVENT_TYPES.PHASE_MESSAGE_REQUESTED;
}

function isLocalActionEvent(payload) {
  return payload?.type?.startsWith("task_")
    || payload?.type?.startsWith("worktree_")
    || payload?.type?.startsWith("document_");
}

function getEventCategory(payload, event) {
  if (isFailureEvent(payload)) return "error";
  if (isLocalActionEvent(payload)) return "local";
  if (isPhaseControlEvent(payload) || event?.source === "client") return "action";
  return "workflow";
}

function getEventCategoryVariant(category) {
  if (category === "error") return "destructive";
  if (category === "local") return "secondary";
  if (category === "action") return "warning";
  return "outline";
}

function getIdleVariant(idleSeconds, activeStatus) {
  if (activeStatus !== "in_progress") return "secondary";
  if (idleSeconds >= 15) return "warning";
  return "info";
}

export default function WorkflowDebugPanel({
  taskId,
  workflowState,
  activePhase,
  activeStatus,
  debugEvents,
  lastEventAt,
  lastError,
  phaseLabels,
  onCopy,
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!debugEvents.length) {
      setSelectedEventId(null);
      return;
    }
    if (!selectedEventId || !debugEvents.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(debugEvents[debugEvents.length - 1].id);
    }
  }, [debugEvents, selectedEventId]);

  const activePhaseLabel = phaseLabels?.[activePhase] || activePhase || "--";
  const activePhaseState = workflowState?.phases?.find((phase) => phase.id === activePhase);
  let currentBackend = "--";
  let currentTool = "--";
  let currentSessionId = activePhaseState?.sessionId || "--";
  let phaseLastEventAt = lastEventAt;

  for (let i = debugEvents.length - 1; i >= 0; i -= 1) {
    const event = debugEvents[i];
    const payload = event.payload || {};
    if (!phaseLastEventAt && payload.phase === activePhase) {
      phaseLastEventAt = event.at;
    }
    if (currentBackend === "--" && payload.type === "backend_selected" && payload.phase === activePhase) {
      currentBackend = payload.backend || "--";
    }
    if (currentTool === "--" && payload.type === "tool_use" && payload.phase === activePhase) {
      currentTool = payload.log || payload.name || "--";
    }
    if (currentSessionId === "--" && payload.type === "session_attached" && payload.phase === activePhase) {
      currentSessionId = payload.sessionId || "--";
    }
    if (currentBackend !== "--" && currentTool !== "--" && currentSessionId !== "--" && phaseLastEventAt) {
      break;
    }
  }

  const idleSeconds = phaseLastEventAt ? Math.max(0, Math.floor((now - new Date(phaseLastEventAt).getTime()) / 1000)) : 0;
  const idleLabel = phaseLastEventAt ? formatDuration(idleSeconds) : "--";
  const selectedEvent = debugEvents.find((event) => event.id === selectedEventId) || null;
  const isIdleWarning = Boolean(phaseLastEventAt) && activeStatus === "in_progress" && idleSeconds >= 15;
  const showIdleBadge = activeStatus === "in_progress";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        {showIdleBadge && (
          <Badge variant={getIdleVariant(idleSeconds, activeStatus)}>
            {t("debug.idleFor", { duration: idleLabel })}
          </Badge>
        )}
        {lastError && !isPhaseControlEvent(lastError.payload) && (
          <Badge variant="destructive">
            {t("debug.lastError")}
          </Badge>
        )}
        <Button variant="outline" size="sm" onClick={() => setIsOpen(true)}>
          <Bug className="h-3.5 w-3.5" />
          {t("debug.title")}
        </Button>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={() => setIsOpen(false)} />
          <div
            className="relative mx-4 flex max-h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <h2 className="text-base font-semibold text-foreground">{t("debug.title")}</h2>
                {showIdleBadge && (
                  <Badge variant={getIdleVariant(idleSeconds, activeStatus)}>
                    {t("debug.idleFor", { duration: idleLabel })}
                  </Badge>
                )}
                {lastError && !isPhaseControlEvent(lastError.payload) && (
                  <Badge variant="destructive">
                    {t("debug.lastError")}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onCopy} disabled={!debugEvents.length}>
                  <Copy className="h-3.5 w-3.5" />
                  {t("debug.copy")}
                </Button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label={t("common.close")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto">
              <div className="grid gap-3 border-b border-border px-6 py-4 md:grid-cols-3 xl:grid-cols-6">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("debug.currentPhase")}</div>
                  <div className="mt-1 text-sm font-medium text-foreground">{activePhaseLabel}</div>
                  <div className="text-xs text-muted-foreground">{activeStatus ? t(`status.${activeStatus}`) : "--"}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("debug.backend")}</div>
                  <div className="mt-1 font-mono text-sm text-foreground">{currentBackend}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("debug.session")}</div>
                  <div className="mt-1 font-mono text-sm text-foreground break-all">{currentSessionId}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("debug.lastEvent")}</div>
                  <div className="mt-1 font-mono text-sm text-foreground">{formatTime(lastEventAt)}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("debug.lastTool")}</div>
                  <div className="mt-1 font-mono text-sm text-foreground break-all">{currentTool}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("debug.eventCount")}</div>
                  <div className="mt-1 text-sm font-medium text-foreground">{debugEvents.length}</div>
                </div>
              </div>

              {isIdleWarning && (
                <div className="mx-6 mt-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    {t("debug.idleWarning", { phase: activePhaseLabel, duration: formatDuration(idleSeconds) })}
                  </div>
                </div>
              )}

              {lastError && !isPhaseControlEvent(lastError.payload) && (
                <div className="mx-6 mt-4 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <div className="font-semibold">{t("debug.lastError")}</div>
                  <div className="mt-1 break-words">{lastError.message}</div>
                </div>
              )}

              <div className="grid gap-0 px-2 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                <div className="border-b border-border lg:border-b-0 lg:border-r">
                  <div className="flex items-center justify-between px-4 pb-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("debug.timeline")}</div>
                    <div className="text-xs text-muted-foreground">{taskId || "--"}</div>
                  </div>
                  <div className="max-h-[52vh] overflow-y-auto px-2 pb-2">
                    {debugEvents.length ? (
                      debugEvents.slice().reverse().map((event) => {
                        const payload = event.payload || {};
                        const isSelected = event.id === selectedEventId;
                        const phaseLabel = payload.phase ? phaseLabels?.[payload.phase] || payload.phase : null;
                        const category = getEventCategory(payload, event);
                        return (
                          <button
                            key={event.id}
                            type="button"
                            onClick={() => setSelectedEventId(event.id)}
                            className={`mb-2 w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                              isSelected
                                ? "border-primary/35 bg-primary/10"
                                : "border-border bg-card/55 hover:bg-accent/60"
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-mono">{formatTime(event.at)}</span>
                              <Badge variant={event.source === "client" ? "secondary" : "outline"}>{event.source}</Badge>
                              <Badge variant={getEventCategoryVariant(category)}>{category}</Badge>
                              <Badge variant={isFailureEvent(payload) ? "destructive" : isPhaseControlEvent(payload) ? "warning" : "outline"}>
                                {payload.type || t("debug.unknown")}
                              </Badge>
                              {phaseLabel && <span>{phaseLabel}</span>}
                            </div>
                            <div className="mt-2 font-mono text-xs text-foreground break-all">
                              {getEventSummary(event, t)}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-2 py-6 text-sm text-muted-foreground">{t("debug.noEvents")}</div>
                    )}
                  </div>
                </div>

                <div className="px-4 pb-4">
                  <div className="pb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("debug.payload")}</div>
                  <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-border bg-slate-950 px-3 py-3">
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-slate-100">
                      {selectedEvent ? JSON.stringify(selectedEvent.payload, null, 2) : t("debug.selectEvent")}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
