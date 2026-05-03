import { cn } from "./lib/utils";
import { useI18n } from "./components/i18n-provider";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";

function getGroupStatus(group, phaseMap, phaseLabels, t) {
  let awaitingPhase = null;
  let hasInProgress = false;
  let allCompleted = true;
  let anyStarted = false;

  for (const pid of group.phases) {
    const status = phaseMap[pid];
    if (status === "awaiting_input") awaitingPhase = pid;
    if (status === "in_progress") hasInProgress = true;
    if (status !== "completed") allCompleted = false;
    if (status && status !== "pending") anyStarted = true;
  }

  if (awaitingPhase) return { status: "awaiting", label: phaseLabels[awaitingPhase] || t("stepList.waiting") };
  if (hasInProgress) return { status: "running", label: t("stepList.running") };
  if (allCompleted && anyStarted) return { status: "completed", label: null };
  return { status: "pending", label: null };
}

export default function StepList({ phases, currentPhase, selectedGroup, onSelect, groups, phaseLabels, onDelete }) {
  const { t } = useI18n();
  const phaseMap = {};
  for (const p of phases) phaseMap[p.name] = p.status;

  return (
    <div className="w-64 shrink-0 border-r border-border bg-sidebar/58 overflow-y-auto py-4 flex flex-col">
      <h2 className="px-4 pb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {t("stepList.title")}
      </h2>
      <ul className="list-none px-2">
        {(groups || []).map((group) => {
          const { status, label } = getGroupStatus(group, phaseMap, phaseLabels || {}, t);
          const isCurrent = group.phases.includes(currentPhase);
          const isSelected = group.key === selectedGroup;

          return (
            <li
              key={group.key}
              className={cn(
                "mb-1.5 flex items-center gap-2.5 rounded-xl px-3 py-2.5 cursor-pointer text-sm transition-colors",
                "text-muted-foreground hover:bg-accent/70",
                isSelected && "bg-card/78 text-foreground shadow-[0_1px_0_rgba(255,255,255,0.55)_inset]",
                isCurrent && "text-foreground"
              )}
              onClick={() => onSelect(group.key)}
            >
              <span
                className={cn(
                  "w-5 h-5 border-2 border-input rounded flex items-center justify-center text-xs font-bold shrink-0",
                  status === "completed" && "bg-success border-success-foreground text-success-foreground",
                  status === "awaiting" && "bg-warning border-warning-foreground text-warning-foreground"
                )}
              >
                {status === "completed" ? "✓" : status === "awaiting" ? "!" : ""}
              </span>
              <span className="flex-1">{group.label}</span>
              {isCurrent && status !== "completed" && (
                <Badge
                  variant={status === "awaiting" ? "warning" : "info"}
                  className="animate-pulse-subtle"
                >
                  {label || t("stepList.running")}
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
