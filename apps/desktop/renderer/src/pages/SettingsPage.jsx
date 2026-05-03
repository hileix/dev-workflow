import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import WorkflowEditor from "../WorkflowEditor";
import { useI18n } from "../components/i18n-provider";
import { LanguageToggle } from "../components/language-toggle";
import SkillManager from "../components/SkillManager";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { useConfigStore } from "../stores/configStore";
import { useWorkflowStore } from "../stores/workflowStore";

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
  const loadWorkflows = useConfigStore((s) => s.loadWorkflows);
  const loadWorkflowConfig = useConfigStore((s) => s.loadWorkflowConfig);
  const loadWorkFolders = useConfigStore((s) => s.loadWorkFolders);
  const showToast = useWorkflowStore((s) => s.showToast);
  const mobileAccessEnabled = workflowConfig?.mobileAccessEnabled === true;
  const tabs = [
    { key: "workflows", label: t("settings.tab.workflows") },
    { key: "skills", label: t("settings.tab.skills") },
    { key: "folders", label: t("settings.tab.folders") },
  ];

  if (showEditor) {
    return (
      <WorkflowEditor
        filename={editingWorkflow}
        onClose={() => { setShowEditor(false); setEditingWorkflow(null); loadWorkflows(); }}
        onSaved={() => {
          showToast(t("settings.workflowSaved"));
          loadWorkflowConfig();
          loadWorkflows();
          setShowEditor(false);
          setEditingWorkflow(null);
        }}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors text-sm">&larr; {t("common.back")}</Link>
          <h2 className="text-[20px] font-semibold text-foreground">{t("settings.title")}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">{t("settings.language")}</span>
          <LanguageToggle />
        </div>
      </div>

      <div className="inline-flex items-center gap-1 rounded-lg bg-secondary p-1 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={cn(
              "min-w-28 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors",
              activeTab === tab.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mb-6 rounded-2xl border border-border bg-card/70 p-4 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]">
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

      {activeTab === "workflows" && (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-foreground">{t("settings.workflows")}</h3>
          <Button variant="outline" size="sm" onClick={() => { setEditingWorkflow(null); setShowEditor(true); }}>{t("settings.newWorkflow")}</Button>
        </div>
        {workflows.length === 0 ? (
          <div className="text-muted-foreground text-sm p-6 text-center border border-dashed border-border rounded-xl bg-card/50">
            {t("settings.noWorkflows")}
          </div>
        ) : (
          <ul className="list-none divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/70">
            {workflows.map((wf) => (
              <li
                key={wf.filename}
                className="flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-accent/70"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-semibold text-foreground">{wf.name}</span>
                  <span className="text-xs text-muted-foreground">{t("settings.workflowPhases", { count: wf.phaseCount })}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => { setEditingWorkflow(wf.filename); setShowEditor(true); }}>
                    {t("settings.edit")}
                  </Button>
                  <button
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded"
                    onClick={() => {
                      setConfirmRemoveWorkflow(wf);
                      setConfirmRemoveWorkflowStep(1);
                    }}
                    aria-label={`Remove ${wf.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
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
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-foreground">{t("settings.workFolders")}</h3>
          <Button variant="outline" size="sm" onClick={addFolder}>{t("settings.addFolder")}</Button>
        </div>

        {workFolders.length === 0 ? (
          <div className="text-muted-foreground text-sm p-6 text-center border border-dashed border-border rounded-xl bg-card/50">
            {t("settings.noFolders")}
          </div>
        ) : (
          <ul className="list-none divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/70">
            {workFolders.map((f) => (
              <li
                key={f.path}
                className={cn(
                  "flex items-center justify-between px-4 py-3.5 cursor-pointer transition-colors",
                  "hover:bg-accent/70",
                  selectedFolder === f.path && "bg-accent"
                )}
                onClick={() => setSelectedFolder(f.path)}
              >
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-sm font-semibold text-foreground">{f.name}</span>
                  <span className="text-xs text-muted-foreground truncate">{f.path}</span>
                </div>
                <button
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded"
                  onClick={(e) => { e.stopPropagation(); setConfirmRemoveFolder(f); }}
                  aria-label={`Remove ${f.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

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
