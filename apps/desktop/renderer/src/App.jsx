import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { useConfigStore } from "./stores/configStore";
import { useWorkflowStore } from "./stores/workflowStore";
import HomePage from "./pages/HomePage";
import SettingsPage from "./pages/SettingsPage";
import TicketPage from "./pages/TicketPage";

export default function App() {
  const toast = useWorkflowStore((s) => s.toast);

  useEffect(() => {
    useConfigStore.getState().loadAll();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
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
