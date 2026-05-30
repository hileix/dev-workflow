import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

export function Tooltip({ content, children, className, side = "top", align = "center" }) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }

    const updatePosition = () => {
      if (!triggerRef.current || !tooltipRef.current) return;

      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 10;
      const canShowBelow = triggerRect.bottom + gap + tooltipRect.height <= window.innerHeight - viewportPadding;
      const canShowAbove = triggerRect.top - gap - tooltipRect.height >= viewportPadding;

      let placedSide = side;
      if (side === "bottom" && !canShowBelow && canShowAbove) placedSide = "top";
      if (side === "top" && !canShowAbove && canShowBelow) placedSide = "bottom";

      const top = placedSide === "bottom"
        ? triggerRect.bottom + gap
        : triggerRect.top - tooltipRect.height - gap;

      let left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
      if (align === "start") left = triggerRect.left;
      if (align === "end") left = triggerRect.right - tooltipRect.width;

      const maxLeft = Math.max(viewportPadding, window.innerWidth - tooltipRect.width - viewportPadding);
      const clampedLeft = Math.min(Math.max(left, viewportPadding), maxLeft);
      const triggerCenter = triggerRect.left + triggerRect.width / 2;
      const arrowLeft = Math.min(
        Math.max(triggerCenter - clampedLeft, 12),
        tooltipRect.width - 12
      );

      setPosition({
        top: Math.max(viewportPadding, top),
        left: clampedLeft,
        arrowLeft,
        placedSide,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, open, side]);

  return (
    <span
      ref={triggerRef}
      className={cn("inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? tooltipId : undefined} className="inline-flex">
        {children}
      </span>
      {open && typeof document !== "undefined" && createPortal(
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          style={{
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            visibility: position ? "visible" : "hidden",
          }}
          className="pointer-events-none fixed z-[100] w-80 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-card px-2.5 py-2 text-[11px] font-normal leading-4 text-card-foreground shadow-md whitespace-pre-line break-words"
        >
          <span className="block">{content}</span>
          <span
            style={{
              left: position?.arrowLeft ?? 12,
            }}
            className={cn(
              "absolute h-2 w-2 -translate-x-1/2 border-l border-t border-border bg-card rotate-45",
              position?.placedSide === "bottom" ? "top-[-4px]" : "bottom-[-4px]"
            )}
          />
        </span>,
        document.body
      )}
    </span>
  );
}
