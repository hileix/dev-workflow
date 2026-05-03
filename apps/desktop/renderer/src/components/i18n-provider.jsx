import { createContext, useContext, useEffect, useState } from "react";
import { messages } from "../lib/i18n";

const LOCALE_STORAGE_KEY = "ui-locale";
const DEFAULT_LOCALE = "en";
const CHINESE_LOCALE = "zh-CN";

function normalizeLocale(value) {
  const locale = String(value || "").toLowerCase();
  return locale.startsWith("zh") ? CHINESE_LOCALE : DEFAULT_LOCALE;
}

function formatMessage(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

function getInitialLocale() {
  try {
    return normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY) || navigator.language);
  } catch {
    return DEFAULT_LOCALE;
  }
}

const I18nContext = createContext({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(getInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  function setLocale(nextLocale) {
    setLocaleState(normalizeLocale(nextLocale));
  }

  function t(key, values) {
    const currentMessages = messages[locale] || messages[DEFAULT_LOCALE];
    const fallbackMessages = messages[DEFAULT_LOCALE];
    return formatMessage(currentMessages[key] ?? fallbackMessages[key] ?? key, values);
  }

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
