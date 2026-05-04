import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import WorkflowEditor from "../WorkflowEditor";
import { BackButton } from "../components/back-button";
import { useI18n } from "../components/i18n-provider";
import SkillManager from "../components/SkillManager";
import { ThemeToggle } from "../components/theme-toggle";
import { Button } from "../components/ui/button";
import { WindowChrome } from "../components/window-chrome";
import { cn } from "../lib/utils";
import { useConfigStore } from "../stores/configStore";

export default function SettingsPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState("workflows");
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [savingMobileAccess, setSavingMobileAccess] = useState(false);
  const [confirmRemoveWorkflow, setConfirmRemoveWorkflow] = useState(null);
  const [confirmRemoveWorkflowStep, setConfirmRemoveWorkflowStep] = useState(1);
  const [confirmRemoveFolder, setConfirmRemoveFolder] = useState(null);

  const workflowConfig = useConfigStore((s) => s.workflowConfig);
  const workflows = useConfigStore((s) => s.workflows);
  const skills = useConfigStore((s) => s.skills);
  const workFolders = useConfigStore((s) => s.workFolders);
  const selectedFolder = useConfigStore((s) => s.selectedFolder);
  const setSelectedFolder = useConfigStore((s) => s.setSelectedFolder);
  const setMobileAccessEnabled = useConfigStore((s) => s.setMobileAccessEnabled);
  const deleteWorkflow = useConfigStore((s) => s.deleteWorkflow);
  const addFolder = useConfigStore((s) => s.addFolder);
  const removeFolder = useConfigStore((s) => s.removeFolder);
  const saveSkill = useConfigStore((s) => s.saveSkill);
  const deleteSkill = useConfigStore((s) => s.deleteSkill);
  const importSkills = useConfigStore((s) => s.importSkills);
  const loadWorkflowConfig = useConfigStore((s) => s.loadWorkflowConfig);
  const loadWorkflows = useConfigStore((s) => s.loadWorkflows);
  const loadSkills = useConfigStore((s) => s.loadSkills);
  const loadWorkFolders = useConfigStore((s) => s.loadWorkFolders);
  const mobileAccessEnabled = workflowConfig?.mobileAccessEnabled === true;
  const tabs = [
    { key: "workflows", label: t("settings.tab.workflows") },
    { key: "skills", label: t("settings.tab.skills") },
    { key: "folders", label: t("settings.tab.folders") },
  ];

  useEffect(() => {
    loadWorkflowConfig();
    loadWorkflows();
    loadSkills();
    loadWorkFolders();
  }, []);

  if (showEditor) {
    return (
      <WorkflowEditor
        filename={editingWorkflow}
        onClose={() => { setShowEditor(false); setEditingWorkflow(null); loadWorkflows(); }}
        onSaved={() => {
          setShowEditor(false);
          setEditingWorkflow(null);
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <WindowChrome />

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <BackButton to="/" label={t("common.back")} className="-ml-2 mb-1" />
              <h1 className="text-[24px] font-semibold text-foreground">{t("settings.title")}</h1>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
            </div>
          </div>
          <div className="mb-6 rounded-2xl border border-border bg-card/78 p-4 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-[15px] font-semibold text-foreground">{t("settings.mobileAccessTitle")}</h3>
                <p className="text-sm text-muted-foreground">{t("settings.mobileAccessHint")}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={mobileAccessEnabled}
                aria-label={t("settings.mobileAccessTitle")}
                disabled={savingMobileAccess}
                className={cn(
                  "relative h-7 w-12 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  mobileAccessEnabled
                    ? "border-primary bg-primary"
                    : "border-border bg-muted"
                )}
                onClick={async () => {
                  const nextEnabled = !mobileAccessEnabled;
                  setSavingMobileAccess(true);
                  try {
                    await setMobileAccessEnabled(nextEnabled);
                    showToast(t("settings.mobileAccessSaved"));
                  } catch {
                    showToast(t("settings.mobileAccessSaveFailed"));
                  } finally {
                    setSavingMobileAccess(false);
                  }
                }}
              >
                <span
                  className={cn(
                    "absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform",
                    mobileAccessEnabled ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
            <div className="mt-3 text-xs font-medium text-muted-foreground">
              {mobileAccessEnabled ? t("settings.mobileAccessOn") : t("settings.mobileAccessOff")}
            </div>
          </div>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="lg:w-56 lg:shrink-0">
              <div className="flex flex-col gap-2 rounded-2xl border border-border bg-secondary/75 p-2 shadow-[0_1px_0_rgba(255,255,255,0.65)_inset]">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={cn(
                      "w-full rounded-xl px-4 py-2.5 text-left text-sm font-semibold transition-colors",
                      activeTab === tab.key
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background/55 hover:text-foreground"
                    )}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-w-0 flex-1">

              {activeTab === "workflows" && (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-[15px] font-semibold text-foreground">{t("settings.workflows")}</h3>
                  <Button variant="outline" size="sm" onClick={() => { setEditingWorkflow(null); setShowEditor(true); }}>{t("settings.newWorkflow")}</Button>
                </div>
                {workflows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
                    {t("settings.noWorkflows")}
                  </div>
                ) : (
                  <ul className="list-none divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/78 shadow-[0_1px_0_rgba(255,255,255,0.65)_inset]">
                    {workflows.map((wf) => (
                      <li
                        key={wf.filename}
                        className="flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-accent/70"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="text-sm font-semibold text-foreground">{wf.name}</span>
                          <span className="text-xs text-muted-foreground">{t("settings.workflowPhases", { count: wf.phaseCount })}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => { setEditingWorkflow(wf.filename); setShowEditor(true); }}>
                            {t("settings.edit")}
                          </Button>
                          <button
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => {
                              setConfirmRemoveWorkflow(wf);
                              setConfirmRemoveWorkflowStep(1);
                            }}
                            aria-label={`Remove ${wf.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              )}

              {activeTab === "skills" && (
              <SkillManager
                skills={skills}
                onSave={saveSkill}
                onDelete={deleteSkill}
                onImport={importSkills}
              />
              )}

              {activeTab === "folders" && (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-[15px] font-semibold text-foreground">{t("settings.workFolders")}</h3>
                  <Button variant="outline" size="sm" onClick={addFolder}>{t("settings.addFolder")}</Button>
                </div>

                {workFolders.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
                    {t("settings.noFolders")}
                  </div>
                ) : (
                  <ul className="list-none divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/78 shadow-[0_1px_0_rgba(255,255,255,0.65)_inset]">
                    {workFolders.map((f) => (
                      <li
                        key={f.path}
                        className={cn(
                          "flex cursor-pointer items-center justify-between px-4 py-3.5 transition-colors",
                          "hover:bg-accent/70",
                          selectedFolder === f.path && "bg-accent/75"
                        )}
                        onClick={() => setSelectedFolder(f.path)}
                      >
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="text-sm font-semibold text-foreground">{f.name}</span>
                          <span className="truncate text-xs text-muted-foreground">{f.path}</span>
                        </div>
                        <button
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setConfirmRemoveFolder(f); }}
                          aria-label={`Remove ${f.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmRemoveFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmRemoveFolder(null)}>
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">{t("settings.removeFolder")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("settings.removeFolderConfirm", { name: confirmRemoveFolder.name })}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setConfirmRemoveFolder(null)}>{t("common.cancel")}</Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  await removeFolder(confirmRemoveFolder.path);
                  loadWorkFolders();
                  setConfirmRemoveFolder(null);
                }}
              >
                {t("common.remove")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmRemoveWorkflow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => {
            setConfirmRemoveWorkflow(null);
            setConfirmRemoveWorkflowStep(1);
          }}
        >
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">
              {confirmRemoveWorkflowStep === 1 ? t("settings.removeWorkflow") : t("settings.confirmDelete")}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {confirmRemoveWorkflowStep === 1
                ? t("settings.removeWorkflowConfirm", { name: confirmRemoveWorkflow.name })
                : t("settings.deleteWorkflowConfirm", { name: confirmRemoveWorkflow.name })}
            </p>
            <div className="flex justify-end gap-3">
              {confirmRemoveWorkflowStep === 1 ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirmRemoveWorkflow(null);
                      setConfirmRemoveWorkflowStep(1);
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setConfirmRemoveWorkflowStep(2)}>{t("common.continue")}</Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setConfirmRemoveWorkflowStep(1)}>{t("common.back")}</Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      deleteWorkflow(confirmRemoveWorkflow.filename);
                      loadWorkflows();
                      loadWorkflowConfig();
                      setConfirmRemoveWorkflow(null);
                      setConfirmRemoveWorkflowStep(1);
                    }}
                  >
                    {t("common.delete")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
