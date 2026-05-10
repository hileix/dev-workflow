import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

const Select = forwardRef(({ className, children, ...props }, ref) => {
  return (
    <div className="relative min-w-0">
      <select
        className={cn(
          "h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-card/70 px-3 pr-9 text-sm text-foreground outline-none focus:border-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
});
Select.displayName = "Select";

export { Select };
