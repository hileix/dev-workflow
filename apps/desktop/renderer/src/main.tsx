import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { I18nProvider } from "./components/i18n-provider";
import { ThemeProvider } from "./components/theme-provider";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <HashRouter>
      <I18nProvider>
        <ThemeProvider defaultTheme="dark">
          <App />
        </ThemeProvider>
      </I18nProvider>
    </HashRouter>
  </StrictMode>
);
