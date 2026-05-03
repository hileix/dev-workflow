import { forwardRef } from "react";
import { cn } from "../../lib/utils";

const Input = forwardRef(({ className, ...props }, ref) => {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-card/70 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
