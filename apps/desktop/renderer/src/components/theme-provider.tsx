import { createContext, useContext, useEffect, useState } from "react";

const THEME_OPTIONS = ["light", "dark", "system"];

const ThemeContext = createContext({ theme: "light", resolvedTheme: "light", setTheme: () => {} });

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children, defaultTheme = "light", storageKey = "ui-theme" }) {
  const [theme, setTheme] = useState(() => {
    const storedTheme = localStorage.getItem(storageKey);
    return THEME_OPTIONS.includes(storedTheme) ? storedTheme : defaultTheme;
  });
  const [resolvedTheme, setResolvedTheme] = useState(() => theme === "system" ? getSystemTheme() : theme);

  useEffect(() => {
    function applyTheme() {
      const resolved = theme === "system" ? getSystemTheme() : theme;
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(resolved);
      setResolvedTheme(resolved);
    }

    applyTheme();
    localStorage.setItem(storageKey, theme);

    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [theme, storageKey]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
