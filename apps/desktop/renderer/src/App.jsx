import { useEffect } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { useI18n } from "./components/i18n-provider";
import { ThemeToggle } from "./components/theme-toggle";
import { useConfigStore } from "./stores/configStore";
import { useWorkflowStore } from "./stores/workflowStore";
import HomePage from "./pages/HomePage";
import SettingsPage from "./pages/SettingsPage";
import TicketPage from "./pages/TicketPage";

export default function App() {
  const location = useLocation();
  const isTicketPage = location.pathname.startsWith("/ticket/");
  const toast = useWorkflowStore((s) => s.toast);
  const { t } = useI18n();

  useEffect(() => {
    useConfigStore.getState().loadAll();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {!isTicketPage && (
        <div className="app-toolbar flex items-center justify-between h-[52px] border-b border-border bg-card/80 px-5 pl-24">
          <Link to="/" className="no-drag text-[13px] font-semibold text-foreground hover:text-foreground/80 transition-colors">dev-Workflow</Link>
          <div className="no-drag flex items-center gap-2">
            <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors text-sm">{t("nav.settings")}</Link>
            <ThemeToggle />
          </div>
        </div>
      )}

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/ticket/:id" element={<TicketPage />} />
      </Routes>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-success text-success-foreground px-5 py-3 rounded-lg shadow-lg text-sm font-medium animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
