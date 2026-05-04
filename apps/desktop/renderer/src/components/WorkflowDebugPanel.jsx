import { useEffect, useState } from "react";
import { AlertTriangle, Bug, Copy, X } from "lucide-react";
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
  if (payload.type === "phase_failed" || payload.type === "error") {
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
  if (payload.type === "phase_done" || payload.type === "phase_completed") {
    return t("debug.summaryDone");
  }
  if (payload.type === "client_connect") {
    return truncate(payload.workFolder || "");
  }
  if (payload.type === "client_detach") {
    return t("debug.summaryDetached");
  }
  return truncate(JSON.stringify(payload));
}

function getIdleVariant(idleSeconds, activeStatus) {
  if (activeStatus !== "in_progress") return "secondary";
  if (idleSeconds >= 15) return "warning";
  return "info";
}

export default function WorkflowDebugPanel({
  ticketId,
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
        {lastError && (
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
                {lastError && (
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

              {lastError && (
                <div className="mx-6 mt-4 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <div className="font-semibold">{t("debug.lastError")}</div>
                  <div className="mt-1 break-words">{lastError.message}</div>
                </div>
              )}

              <div className="grid gap-0 px-2 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                <div className="border-b border-border lg:border-b-0 lg:border-r">
                  <div className="flex items-center justify-between px-4 pb-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("debug.timeline")}</div>
                    <div className="text-xs text-muted-foreground">{ticketId || "--"}</div>
                  </div>
                  <div className="max-h-[52vh] overflow-y-auto px-2 pb-2">
                    {debugEvents.length ? (
                      debugEvents.slice().reverse().map((event) => {
                        const payload = event.payload || {};
                        const isSelected = event.id === selectedEventId;
                        const phaseLabel = payload.phase ? phaseLabels?.[payload.phase] || payload.phase : null;
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
                              <Badge variant={payload.type === "error" || payload.type === "phase_failed" ? "destructive" : "outline"}>
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
