import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import WorkflowEditor from "../WorkflowEditor";
import SkillManager from "../components/SkillManager";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { useConfigStore } from "../stores/configStore";
import { useWorkflowStore } from "../stores/workflowStore";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("workflows");
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [confirmRemoveWorkflow, setConfirmRemoveWorkflow] = useState(null);
  const [confirmRemoveWorkflowStep, setConfirmRemoveWorkflowStep] = useState(1);
  const [confirmRemoveFolder, setConfirmRemoveFolder] = useState(null);

  const workflows = useConfigStore((s) => s.workflows);
  const skills = useConfigStore((s) => s.skills);
  const workFolders = useConfigStore((s) => s.workFolders);
  const selectedFolder = useConfigStore((s) => s.selectedFolder);
  const setSelectedFolder = useConfigStore((s) => s.setSelectedFolder);
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
  const tabs = [
    { key: "workflows", label: "Workflows" },
    { key: "skills", label: "Skills" },
    { key: "folders", label: "Work Folders" },
  ];

  if (showEditor) {
    return (
      <WorkflowEditor
        filename={editingWorkflow}
        onClose={() => { setShowEditor(false); setEditingWorkflow(null); loadWorkflows(); }}
        onSaved={() => {
          showToast("Workflow saved successfully");
          loadWorkflowConfig();
          loadWorkflows();
          setShowEditor(false);
          setEditingWorkflow(null);
        }}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors text-sm">&larr; Back</Link>
        <h2 className="text-lg font-semibold text-foreground">Settings</h2>
      </div>

      <div className="flex items-center gap-2 border-b border-border mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={cn(
              "px-4 py-2 text-sm font-semibold border-b-2 transition-colors",
              activeTab === tab.key
                ? "border-ring text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "workflows" && (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground">Workflows</h3>
          <Button variant="outline" size="sm" onClick={() => { setEditingWorkflow(null); setShowEditor(true); }}>+ New Workflow</Button>
        </div>
        {workflows.length === 0 ? (
          <div className="text-muted-foreground text-sm p-6 text-center border border-dashed border-border rounded-lg">
            No workflows found.
          </div>
        ) : (
          <ul className="list-none space-y-2">
            {workflows.map((wf) => (
              <li
                key={wf.filename}
                className="flex items-center justify-between p-3 border border-border rounded-lg transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-semibold text-foreground">{wf.name}</span>
                  <span className="text-xs text-muted-foreground">{wf.phaseCount} phases</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => { setEditingWorkflow(wf.filename); setShowEditor(true); }}>
                    Edit
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
          <h3 className="text-base font-semibold text-foreground">Work Folders</h3>
          <Button variant="outline" size="sm" onClick={addFolder}>+ Add Folder</Button>
        </div>

        {workFolders.length === 0 ? (
          <div className="text-muted-foreground text-sm p-6 text-center border border-dashed border-border rounded-lg">
            No work folders configured. Click "+ Add Folder" to browse and select a project directory.
          </div>
        ) : (
          <ul className="list-none space-y-2">
            {workFolders.map((f) => (
              <li
                key={f.path}
                className={cn(
                  "flex items-center justify-between p-3 border border-border rounded-lg cursor-pointer transition-colors",
                  "hover:bg-accent",
                  selectedFolder === f.path && "bg-secondary border-ring"
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
            <h3 className="text-sm font-semibold text-foreground mb-2">Remove Work Folder</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to remove <strong>{confirmRemoveFolder.name}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setConfirmRemoveFolder(null)}>Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  await removeFolder(confirmRemoveFolder.path);
                  loadWorkFolders();
                  setConfirmRemoveFolder(null);
                }}
              >
                Remove
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
              {confirmRemoveWorkflowStep === 1 ? "Remove Workflow" : "Confirm Delete"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {confirmRemoveWorkflowStep === 1
                ? <>Are you sure you want to remove <strong>{confirmRemoveWorkflow.name}</strong>?</>
                : <>This will permanently delete <strong>{confirmRemoveWorkflow.name}</strong>. This action cannot be undone.</>}
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
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setConfirmRemoveWorkflowStep(2)}>
                    Continue
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setConfirmRemoveWorkflowStep(1)}>
                    Back
                  </Button>
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
                    Delete
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
