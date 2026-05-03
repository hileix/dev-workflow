import { ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "../lib/utils";

const backButtonClassName = "no-drag inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-muted-foreground/90 transition-colors hover:bg-accent/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function BackButton({ to, onClick, label, className }) {
  if (to) {
    return (
      <Link to={to} className={cn(backButtonClassName, className)}>
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.25} />
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cn(backButtonClassName, className)}>
      <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.25} />
      <span>{label}</span>
    </button>
  );
}
