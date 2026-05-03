import { cn } from "./lib/utils";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";

function getGroupStatus(group, phaseMap, phaseLabels) {
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

  if (awaitingPhase) return { status: "awaiting", label: phaseLabels[awaitingPhase] || "Waiting" };
  if (hasInProgress) return { status: "running", label: "Running" };
  if (allCompleted && anyStarted) return { status: "completed", label: null };
  return { status: "pending", label: null };
}

export default function StepList({ phases, currentPhase, selectedGroup, onSelect, groups, phaseLabels, onDelete }) {
  const phaseMap = {};
  for (const p of phases) phaseMap[p.name] = p.status;

  return (
    <div className="w-60 shrink-0 border-r border-border bg-sidebar overflow-y-auto py-4 flex flex-col">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-4 pb-3">
        Steps
      </h2>
      <ul className="list-none">
        {(groups || []).map((group) => {
          const { status, label } = getGroupStatus(group, phaseMap, phaseLabels || {});
          const isCurrent = group.phases.includes(currentPhase);
          const isSelected = group.key === selectedGroup;

          return (
            <li
              key={group.key}
              className={cn(
                "flex items-center gap-2.5 px-4 py-2.5 cursor-pointer text-sm transition-colors",
                "text-muted-foreground hover:bg-accent",
                isSelected && "bg-secondary text-foreground",
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
                  {label || "Running"}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
      {onDelete && (
        <div className="px-4 mt-auto pt-4 pb-2 border-t border-border">
          <Button variant="ghost" size="sm" className="w-full text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onDelete}>
            Delete Task
          </Button>
        </div>
      )}
    </div>
  );
}
