import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { I18nProvider } from "./i18n-provider";
import { ThemeProvider } from "./theme-provider";
import { ThemeToggle } from "./theme-toggle";

function setupMatchMedia(matches = false) {
  const listeners = new Set();
  const mediaQuery = {
    matches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((event, listener) => {
      if (event === "change") listeners.add(listener);
    }),
    removeEventListener: vi.fn((event, listener) => {
      if (event === "change") listeners.delete(listener);
    }),
    dispatch(matchesValue) {
      this.matches = matchesValue;
      listeners.forEach((listener) => listener({ matches: matchesValue }));
    },
  };

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => mediaQuery),
  });
  return mediaQuery;
}

function renderThemeToggle() {
  render(
    <I18nProvider>
      <ThemeProvider defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>
    </I18nProvider>
  );
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("selects system theme from the dropdown and follows system changes", async () => {
    const mediaQuery = setupMatchMedia(false);
    const user = userEvent.setup();

    renderThemeToggle();
    await user.click(screen.getByRole("button", { name: "Choose theme" }));
    await user.click(screen.getByRole("menuitemradio", { name: /System/ }));

    expect(localStorage.getItem("ui-theme")).toBe("system");
    expect(document.documentElement).toHaveClass("light");

    mediaQuery.dispatch(true);

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
    });
  });
});
