import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useI18n } from "./i18n-provider";
import { useTheme } from "./theme-provider";

const themeOptions = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
];

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const label = t("theme.toggle");
  const Icon = theme === "system" ? Monitor : resolvedTheme === "dark" ? Sun : Moon;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event) {
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function handleSelect(value) {
    setTheme(value);
    setOpen(false);
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-36 overflow-hidden rounded-md border border-border bg-card p-1 text-sm shadow-lg"
          style={{ backgroundColor: "var(--card)" }}
          role="menu"
        >
          {themeOptions.map((option) => {
            const OptionIcon = option.icon;
            const selected = theme === option.value;

            return (
              <button
                key={option.value}
                type="button"
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-card-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleSelect(option.value)}
                role="menuitemradio"
                aria-checked={selected}
              >
                <OptionIcon className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">{t(`theme.${option.value}`)}</span>
                {selected && <Check className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
