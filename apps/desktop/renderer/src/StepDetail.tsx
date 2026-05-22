import { useRef, useState } from "react";
import Markdown from "react-markdown";
import { FileText, X } from "lucide-react";
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

export default function StepDetail({
  taskId,
  runId,
  workFolder,
  taskInputs,
  phase,
  artifact,
  interactions = [],
  emptyDocumentMessage = "",
  activeBackend,
  isStreaming,
  isRunning,
  isPaused,
  isAwaiting,
  isFailed,
  onApprove,
  onReject,
  onSendMessage,
  onInterrupt,
  onOpenDocument,
  phaseModel,
  phaseLabels,
  phaseTypes,
  rejectTargets,
}) {
  const { t } = useI18n();
  const [rejectTarget, setRejectTarget] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const contentRef = useRef(null);

  const isCheckpoint = phaseTypes?.[phase] === "checkpoint";
  const phaseType = phaseTypes?.[phase] || "auto";
  const showTerminal = phaseType === "auto" || phaseType === "condition";
  const currentBackend = isCheckpoint ? t("stepDetail.checkpoint") : getBackendLabel(getCurrentBackend(activeBackend, interactions));
  const rejectOptions = isCheckpoint ? rejectTargets?.[phase] || [] : [];
  const terminalSessionId = `${taskId || "task"}:${runId || taskId || "run"}`;

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
      <div className={`grid min-h-0 flex-1 overflow-hidden ${showTerminal ? "xl:grid-cols-[minmax(0,1fr)_420px]" : ""}`}>
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

        {showTerminal ? (
          <TaskTerminalPanel
            backendLabel={currentBackend}
            cwd={workFolder}
            enableShell={false}
            interactions={interactions}
            isRunning={isRunning}
            isStreaming={isStreaming}
            isPaused={isPaused}
            phaseKey={phase}
            phaseLabel={phaseLabels?.[phase] || phase}
            onInterrupt={onInterrupt}
            onSendMessage={onSendMessage}
            sessionId={terminalSessionId}
            modelLabel={phaseModel}
            taskInputs={taskInputs}
            taskTitle={taskId}
          />
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
