import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { useI18n } from "./i18n-provider";
import { useTheme } from "./theme-provider";

const themeOptions = [
  { value: "light", labelKey: "theme.light", icon: Sun },
  { value: "dark", labelKey: "theme.dark", icon: Moon },
  { value: "system", labelKey: "theme.system", icon: Monitor }
];

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const TriggerIcon = theme === "system" ? Monitor : resolvedTheme === "dark" ? Sun : Moon;

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label={t("theme.toggle")}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t("theme.toggle")}
      >
        <TriggerIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-36 overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg"
          role="menu"
        >
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const selected = theme === option.value;

            return (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  selected && "bg-accent/70"
                )}
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setTheme(option.value);
                  setOpen(false);
                }}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{t(option.labelKey)}</span>
                {selected && <Check className="h-4 w-4 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
