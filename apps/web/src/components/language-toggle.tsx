import { Languages } from "lucide-react";
import { useI18n } from "./i18n-provider";

export function LanguageToggle() {
  const { locale, t, toggleLocale } = useI18n();
  const nextLocale = locale === "zh-CN" ? "English" : "中文";

  return (
    <button
      type="button"
      onClick={toggleLocale}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label={`${t("language.switch")}: ${nextLocale}`}
      title={`${t("language.switch")}: ${nextLocale}`}
    >
      <Languages className="h-4 w-4" />
    </button>
  );
}
