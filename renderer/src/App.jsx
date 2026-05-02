import { useEffect } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
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

  useEffect(() => {
    useConfigStore.getState().loadAll();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {!isTicketPage && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
          <Link to="/" className="text-lg font-semibold text-foreground hover:text-foreground/80 transition-colors">Workbench</Link>
          <div className="flex items-center gap-3">
            <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors text-sm">Settings</Link>
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
