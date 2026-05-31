import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { useConfigStore } from "./stores/configStore";
import { useWorkflowStore } from "./stores/workflowStore";
import HomePage from "./pages/HomePage";
import SettingsPage from "./pages/SettingsPage";
import TaskPage from "./pages/TaskPage";

export default function App() {
  const toast = useWorkflowStore((s) => s.toast);

  useEffect(() => {
    useConfigStore.getState().loadAll();
    useWorkflowStore.getState().ensureWorkflowEvents();
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/workflows/new" element={<SettingsPage />} />
        <Route path="/settings/workflows/:filename/edit" element={<SettingsPage />} />
        <Route path="/task/:id" element={<TaskPage />} />
      </Routes>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md bg-success px-5 py-3 text-sm font-medium text-success-foreground shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
