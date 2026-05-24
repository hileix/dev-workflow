import { useRef, useState } from "react";
import Markdown from "react-markdown";
import { Bot, Clock3, FileText, GitBranch, MessageSquareText, X } from "lucide-react";
import TaskTerminalPanel from "./components/TaskTerminalPanel";
import { useI18n } from "./components/i18n-provider";
import { Button } from "./components/ui/button";

function getBackendLabel(backend) {
  if (String(backend || "").startsWith("ai-api:")) return `AI API: ${String(backend).slice("ai-api:".length)}`;
  if (backend === "ai-api") return "AI API";
  if (backend === "codex") return "Codex";
  if (backend === "claude") return "Claude Code";
  return "Shell";
}

function getCurrentBackend(activeBackend, interactions) {
  if (activeBackend) return activeBackend;
  for (let i = (interactions || []).length - 1; i >= 0; i -= 1) {
    if (interactions[i]?.backend) return interactions[i].backend;
  }
  return "";
}

function getStatusLabel(t, status) {
  if (status === "completed") return t("status.completed");
  if (status === "paused") return t("status.paused");
  if (status === "awaiting_input") return t("status.awaiting_input");
  if (status === "in_progress") return t("status.in_progress");
  if (status === "failed") return t("status.failed");
  return t("status.pending");
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

function getExecutionTitle(t, phaseType, backendType) {
  const backend = String(backendType || "");
  if (phaseType === "checkpoint") return t("stepDetail.reviewDetails");
  if (phaseType === "condition") return backend.startsWith("ai-api") ? t("stepDetail.routingDetails") : t("stepDetail.execution");
  if (backend.startsWith("ai-api")) return t("stepDetail.callDetails");
  return t("stepDetail.execution");
}

function getInteractionTitle(t, interaction) {
  if (interaction?.type === "prompt") return t("stepDetail.prompt");
  if (interaction?.role === "user" || interaction?.type === "user_message") return t("stepDetail.user");
  if (interaction?.type === "tool_use" || interaction?.role === "tool") return t("stepDetail.tool");
  if (interaction?.type === "assistant_delta" || interaction?.role === "assistant") return t("stepDetail.assistant");
  return t("stepDetail.systemEvent");
}

function DetailRow({ label, mono = false, value }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 text-sm text-foreground ${mono ? "break-all font-mono text-[12px]" : "break-words"}`}>{value}</dd>
    </div>
  );
}

function ExecutionDetailsPanel({
  agentSessionId,
  backendLabel,
  backendType,
  conditionRoutes,
  interactions,
  phase,
  phaseDecision,
  phaseLabels,
  phaseModel,
  phaseStatus,
  phaseType,
  phaseUpdatedAt,
  rejectTargets,
  t,
}) {
  const visibleInteractions = (interactions || []).filter((interaction) => interaction?.type !== "phase_start");
  const conditionRoute = conditionRoutes?.[phase] || {};
  const rejectOptions = rejectTargets?.[phase] || [];
  const conditionTarget = phaseDecision
    ? (phaseDecision.passed ? (phaseDecision.passTo || conditionRoute.passTo) : (phaseDecision.failTo || conditionRoute.failTo))
    : "";
  const hasRoutingDetails = phaseType === "condition"
    ? Boolean(phaseDecision || conditionRoute.passTo || conditionRoute.failTo)
    : phaseType === "checkpoint"
      ? Boolean(phaseDecision || rejectOptions.length > 0)
      : false;

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card/72">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">{getExecutionTitle(t, phaseType, backendType)}</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border px-4 py-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            {t("stepDetail.overview")}
          </div>
          <dl className="space-y-3">
            <DetailRow label={t("stepDetail.backend")} value={backendLabel || t("stepDetail.notAvailable")} />
            <DetailRow label={t("stepDetail.status")} value={getStatusLabel(t, phaseStatus)} />
            <DetailRow label={t("stepDetail.model")} value={phaseModel || t("stepDetail.notAvailable")} />
            <DetailRow label={t("stepDetail.updatedAt")} value={formatTimestamp(phaseUpdatedAt) || t("stepDetail.notAvailable")} />
            {agentSessionId ? <DetailRow label={t("stepDetail.session")} mono value={agentSessionId} /> : null}
          </dl>
        </section>

        {hasRoutingDetails ? (
          <section className="border-b border-border px-4 py-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              {t("stepDetail.routingDetails")}
            </div>
            <dl className="space-y-3">
              {phaseType === "condition" ? (
                <>
                  {phaseDecision ? (
                    <>
                      <DetailRow label={t("stepDetail.decision")} value={phaseDecision.passed ? t("stepDetail.pass") : t("stepDetail.fail")} />
                      <DetailRow label={t("stepDetail.route")} value={conditionTarget ? (phaseLabels?.[conditionTarget] || conditionTarget) : t("stepDetail.notAvailable")} />
                      {phaseDecision.reason ? <DetailRow label={t("stepDetail.reason")} value={phaseDecision.reason} /> : null}
                    </>
                  ) : (
                    <>
                      <DetailRow label={t("stepDetail.passRoute")} value={conditionRoute.passTo ? (phaseLabels?.[conditionRoute.passTo] || conditionRoute.passTo) : t("stepDetail.notAvailable")} />
                      <DetailRow label={t("stepDetail.failRoute")} value={conditionRoute.failTo ? (phaseLabels?.[conditionRoute.failTo] || conditionRoute.failTo) : t("stepDetail.notAvailable")} />
                    </>
                  )}
                </>
              ) : (
                <>
                  {phaseDecision ? (
                    <>
                      <DetailRow label={t("stepDetail.decision")} value={phaseDecision.approved ? t("stepDetail.approved") : t("stepDetail.rejected")} />
                      {!phaseDecision.approved ? (
                        <DetailRow
                          label={t("stepDetail.route")}
                          value={phaseDecision.rejectTo ? (phaseLabels?.[phaseDecision.rejectTo] || phaseDecision.rejectTo) : t("stepDetail.notAvailable")}
                        />
                      ) : null}
                      {phaseDecision.notes ? <DetailRow label={t("stepDetail.notes")} value={phaseDecision.notes} /> : null}
                    </>
                  ) : (
                    <DetailRow
                      label={t("stepDetail.rejectRoutes")}
                      value={rejectOptions.length > 0 ? rejectOptions.map((target) => phaseLabels?.[target] || target).join(", ") : t("stepDetail.notAvailable")}
                    />
                  )}
                </>
              )}
            </dl>
          </section>
        ) : null}

        <section className="px-4 py-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <MessageSquareText className="h-3.5 w-3.5" />
            {t("stepDetail.events")}
          </div>
          {visibleInteractions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("stepDetail.noExecutionDetails")}</p>
          ) : (
            <div className="space-y-4">
              {visibleInteractions.map((interaction) => (
                <article key={interaction.id || `${interaction.type || interaction.role}-${interaction.at || ""}`} className="border-b border-border/70 pb-4 last:border-b-0 last:pb-0">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">{getInteractionTitle(t, interaction)}</span>
                    <span className="text-[11px] text-muted-foreground">{formatTimestamp(interaction.at)}</span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded-md bg-background/65 px-3 py-2 text-[12px] leading-5 text-foreground">
                    {String(interaction.text || interaction.log || interaction.backend || "").trim() || t("stepDetail.notAvailable")}
                  </pre>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

export default function StepDetail({
  agentSessionId,
  taskId,
  runId,
  workFolder,
  taskInputs,
  phase,
  artifact,
  interactions = [],
  emptyDocumentMessage = "",
  activeBackend,
  backendType,
  isStreaming,
  isRunning,
  isPaused,
  isAwaiting,
  isFailed,
  phaseStatus,
  phaseUpdatedAt,
  phaseDecision,
  onApprove,
  onReject,
  onOpenDocument,
  phaseModel,
  phaseLabels,
  phaseTypes,
  rejectTargets,
  conditionRoutes,
  terminalPanels = [],
}) {
  const { t } = useI18n();
  const [rejectTarget, setRejectTarget] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const contentRef = useRef(null);

  const isCheckpoint = phaseTypes?.[phase] === "checkpoint";
  const phaseType = phaseTypes?.[phase] || "auto";
  const activeTerminalPanel = terminalPanels.find((panel) => panel.phaseKey === phase) || null;
  const hasMountedTerminalPanels = terminalPanels.length > 0;
  const showExecutionPanel = Boolean(phase && !activeTerminalPanel);
  const showSidePanel = Boolean(activeTerminalPanel || showExecutionPanel || hasMountedTerminalPanels);
  const currentBackend = isCheckpoint ? t("stepDetail.checkpoint") : getBackendLabel(getCurrentBackend(activeBackend, interactions));
  const rejectOptions = isCheckpoint ? rejectTargets?.[phase] || [] : [];

  function openRejectModal(target) {
    setRejectTarget(target);
    setRejectReason("");
  }

  function closeRejectModal() {
    setRejectTarget("");
    setRejectReason("");
  }

  function submitReject(e) {
    e.preventDefault();
    const reason = rejectReason.trim();
    if (!rejectTarget || !reason) return;
    onReject?.(rejectTarget, reason);
    closeRejectModal();
  }

  if (!phase) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          {t("stepDetail.selectStep")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className={`grid min-h-0 flex-1 overflow-hidden ${showSidePanel ? "xl:grid-cols-[minmax(0,1fr)_420px]" : ""}`}>
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-4 text-sm leading-relaxed" ref={contentRef}>
            <div className="mx-auto max-w-4xl">
              <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                <FileText className="h-4 w-4" />
                {onOpenDocument ? (
                  <button
                    type="button"
                    className="rounded-sm px-0.5 py-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    title={t("stepDetail.openDocumentInCode")}
                    onClick={onOpenDocument}
                  >
                    {t("stepDetail.document")}
                  </button>
                ) : (
                  <span>{t("stepDetail.document")}</span>
                )}
              </div>
              {artifact ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Markdown>{artifact}</Markdown>
                </div>
              ) : (
                <div className={`rounded-lg border border-dashed border-border bg-card/35 px-4 py-8 text-center text-sm ${emptyDocumentMessage ? "text-destructive" : "text-muted-foreground"}`}>
                  {isStreaming || isRunning
                    ? t("stepDetail.receivingOutput")
                    : emptyDocumentMessage || (isCheckpoint
                        ? t("stepDetail.noCheckpointDocument")
                        : t("stepDetail.noDocument"))}
                </div>
              )}
            </div>
          </div>
          {isAwaiting && isCheckpoint && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background px-6 py-3">
              {rejectOptions.map((target) => (
                <Button key={target} variant="outline" onClick={() => openRejectModal(target)}>
                  {t("stepDetail.rejectTo", { phase: phaseLabels?.[target] || target })}
                </Button>
              ))}
              <Button variant="success" onClick={onApprove}>{t("common.approve")}</Button>
            </div>
          )}
        </section>

        {showSidePanel ? (
          <div className="relative min-h-0 border-t border-border xl:border-l xl:border-t-0">
            {showExecutionPanel ? (
              <div className="absolute inset-0">
                <ExecutionDetailsPanel
                  agentSessionId={agentSessionId}
                  backendLabel={currentBackend}
                  backendType={backendType}
                  conditionRoutes={conditionRoutes}
                  interactions={interactions}
                  phase={phase}
                  phaseDecision={phaseDecision}
                  phaseLabels={phaseLabels}
                  phaseModel={phaseModel}
                  phaseStatus={phaseStatus}
                  phaseType={phaseType}
                  phaseUpdatedAt={phaseUpdatedAt}
                  rejectTargets={rejectTargets}
                  t={t}
                />
              </div>
            ) : null}
            {hasMountedTerminalPanels ? terminalPanels.map((panel) => (
              <TaskTerminalPanel
                key={panel.phaseKey}
                {...panel}
                className={panel.phaseKey === phase && activeTerminalPanel ? "absolute inset-0" : "pointer-events-none absolute inset-0 opacity-0"}
                enableShell
              />
            )) : null}
          </div>
        ) : null}
      </div>

      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
          <form
            className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
            onSubmit={submitReject}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {t("stepDetail.rejectReasonTitle")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("stepDetail.rejectReasonHint", { phase: phaseLabels?.[rejectTarget] || rejectTarget })}
                </p>
              </div>
              <button
                type="button"
                onClick={closeRejectModal}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={5}
              autoFocus
              placeholder={t("stepDetail.rejectReasonPlaceholder")}
              className="min-h-28 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeRejectModal}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={!rejectReason.trim()}>
                {t("stepDetail.submitReject")}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
