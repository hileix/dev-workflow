import { cn } from "../lib/utils";
import { useI18n } from "./i18n-provider";

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-secondary/70 p-0.5 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset]">
      {[
        { key: "en", label: "EN" },
        { key: "zh-CN", label: "中" },
      ].map((item) => {
        const active = locale === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => setLocale(item.key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
            aria-label={t("language.switch")}
            title={t("language.switch")}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
