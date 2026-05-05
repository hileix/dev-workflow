import { cn } from "./lib/utils";
import { useI18n } from "./components/i18n-provider";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";

function getStatusLabel(status, t) {
  if (status === "awaiting_input") return t("stepList.waiting");
  if (status === "in_progress") return t("stepList.running");
  return null;
}

export default function StepList({ phases, currentPhase, selectedPhase, onSelect, phaseLabels, phaseTypes, onDelete }) {
  const { t } = useI18n();

  return (
    <div className="w-64 shrink-0 border-r border-border bg-sidebar/58 overflow-y-auto py-4 flex flex-col">
      <h2 className="px-4 pb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {t("stepList.title")}
      </h2>
      <ul className="list-none px-2">
        {(phases || []).map((phase) => {
          const phaseId = phase.name || phase.id;
          const status = phase.status || "pending";
          const isCurrent = phaseId === currentPhase;
          const isSelected = phaseId === selectedPhase;
          const isCheckpoint = phaseTypes?.[phaseId] === "checkpoint";
          const statusLabel = getStatusLabel(status, t);

          return (
            <li
              key={phaseId}
              className={cn(
                "mb-1.5 flex items-center gap-2.5 rounded-xl px-3 py-2.5 cursor-pointer text-sm transition-colors",
                "text-muted-foreground hover:bg-accent/70",
                isSelected && "bg-card/78 text-foreground shadow-[0_1px_0_rgba(255,255,255,0.55)_inset]",
                isCurrent && "text-foreground"
              )}
              onClick={() => onSelect(phaseId)}
            >
              <span
                className={cn(
                  "w-5 h-5 border-2 border-input rounded flex items-center justify-center text-xs font-bold shrink-0",
                  status === "completed" && "bg-success border-success-foreground text-success-foreground",
                  status === "awaiting_input" && "bg-warning border-warning-foreground text-warning-foreground",
                  status === "in_progress" && "bg-info border-info-foreground text-info-foreground"
                )}
              >
                {status === "completed" ? "✓" : status === "awaiting_input" ? "!" : status === "in_progress" ? "•" : ""}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{phaseLabels?.[phaseId] || phaseId}</span>
                {isCheckpoint && (
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {t("stepList.checkpoint")}
                  </span>
                )}
              </span>
              {statusLabel && (
                <Badge
                  variant={status === "awaiting_input" ? "warning" : "info"}
                  className="animate-pulse-subtle"
                >
                  {statusLabel}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
      {onDelete && (
        <div className="mx-3 mt-auto border-t border-border pt-4 pb-2">
          <Button variant="ghost" size="sm" className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onDelete}>
            {t("stepList.deleteTask")}
          </Button>
        </div>
      )}
    </div>
  );
}
