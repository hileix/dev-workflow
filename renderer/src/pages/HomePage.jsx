import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { X } from "lucide-react";
import { useConfigStore } from "../stores/configStore";
import { useWorkflowStore } from "../stores/workflowStore";
import { getDesktopApi } from "../lib/desktop-api";

const desktopApi = getDesktopApi();

function StepCheckbox({ status }) {
  if (status === "completed") {
    return (
      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="none">
        <rect x="1" y="1" width="18" height="18" rx="3" fill="#16a34a" />
        <path d="M6 10l3 3 5-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "in_progress") {
    return (
      <svg className="w-5 h-5 flex-shrink-0 animate-pulse-subtle" viewBox="0 0 20 20" fill="none">
        <rect x="1" y="1" width="18" height="18" rx="3" stroke="#3b82f6" strokeWidth="2" />
        <circle cx="10" cy="10" r="3" fill="#3b82f6" />
      </svg>
    );
  }
  if (status === "awaiting_input") {
    return (
      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="none">
        <rect x="1" y="1" width="18" height="18" rx="3" stroke="#f59e0b" strokeWidth="2" />
        <text x="10" y="14.5" textAnchor="middle" fill="#f59e0b" fontSize="12" fontWeight="bold">!</text>
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="none">
      <rect x="1" y="1" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" className="text-border" />
    </svg>
  );
}

function TaskCard({ task, groups, onClick }) {
  const phaseStatusMap = {};
  for (const p of task.phases || []) {
    phaseStatusMap[p.id] = p.status;
  }

  return (
    <div
      className={`inline-block border rounded-lg cursor-pointer transition-colors hover:bg-accent ${
        task.status === "awaiting_input" ? "border-2 border-warning animate-pulse-subtle" : "border-border"
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">{task.ticketId}</span>
        <Badge
          variant={
            task.status === "completed" ? "success" :
            task.status === "awaiting_input" ? "warning" :
            task.status === "in_progress" ? "info" :
            "secondary"
          }
        >
          {task.status}
        </Badge>
      </div>
      {groups.length > 0 && (
        <div className="px-4 py-3 space-y-2.5">
          {groups.map((g) => {
            const groupPhases = g.phases || [];
            const statuses = groupPhases.map((pid) => phaseStatusMap[pid] || "pending");
            let groupStatus = "pending";
            if (statuses.every((s) => s === "completed")) groupStatus = "completed";
            else if (statuses.some((s) => s === "awaiting_input")) groupStatus = "awaiting_input";
            else if (statuses.some((s) => s === "in_progress")) groupStatus = "in_progress";

            return (
              <div key={g.key} className="flex items-center gap-2.5">
                <StepCheckbox status={groupStatus} />
                <span className="text-sm text-foreground">{g.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StartWorkflowModal({ workflows, workFolders, defaultFolder, onStart, onClose }) {
  const [selectedWorkflow, setSelectedWorkflow] = useState(workflows[0]?.filename || null);
  const [selectedFolder, setSelectedFolder] = useState(defaultFolder);
  const [promptValues, setPromptValues] = useState({});
  const [images, setImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const activeWf = workflows.find((wf) => wf.filename === selectedWorkflow);
  const prompts = activeWf?.prompts || [];
  const defaultPrompts = [{ key: "ticketId", label: "Instance ID", placeholder: "Enter an identifier" }];
  const displayPrompts = prompts.length > 0 ? prompts : defaultPrompts;

  const firstKey = displayPrompts[0]?.key;
  const allFilled = displayPrompts.every((p) => (promptValues[p.key] || "").trim());

  function addImageFiles(files) {
    const newImages = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      newImages.push({ file, preview: URL.createObjectURL(file) });
    }
    if (newImages.length > 0) setImages((prev) => [...prev, ...newImages]);
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addImageFiles(imageFiles);
    }
  }

  function removeImage(idx) {
    setImages((prev) => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!allFilled || !selectedFolder || !selectedWorkflow || submitting) return;
    const id = (promptValues[firstKey] || "").trim();

    setSubmitting(true);
    try {
      let uploadedPaths = [];
      if (images.length > 0) {
        const payload = await Promise.all(images.map(async (img) => ({
          name: img.file.name,
          data: Array.from(new Uint8Array(await img.file.arrayBuffer())),
        })));
        const data = await desktopApi.saveTaskUploads(id, payload);
        uploadedPaths = data.paths || [];
      }

      onStart(id, selectedFolder, promptValues, uploadedPaths.length > 0 ? uploadedPaths : undefined);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Start Workflow</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">&times;</button>
        </div>

        <div className="px-6 py-4 space-y-5">
          <div className="space-y-2">
            <span className="text-xs font-semibold text-muted-foreground">Workflow</span>
            <div className="space-y-1.5">
              {workflows.map((wf) => (
                <div
                  key={wf.filename}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedWorkflow === wf.filename
                      ? "border-ring bg-accent"
                      : "border-border hover:bg-accent/50"
                  }`}
                  onClick={() => setSelectedWorkflow(wf.filename)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{wf.name}</span>
                    <span className="text-xs text-muted-foreground">{wf.phaseCount} steps</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-semibold text-muted-foreground">Work Folder</span>
            <div className="space-y-1.5">
              {workFolders.map((f) => (
                <div
                  key={f.path}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedFolder === f.path
                      ? "border-ring bg-accent"
                      : "border-border hover:bg-accent/50"
                  }`}
                  onClick={() => setSelectedFolder(f.path)}
                >
                  <div className="text-sm font-semibold text-foreground">{f.name}</div>
                  <div className="text-xs text-muted-foreground">{f.path}</div>
                </div>
              ))}
            </div>
          </div>

          <form className="space-y-3" onSubmit={handleSubmit}>
            {displayPrompts.map((p, i) => (
              <div key={p.key} className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground">{p.label}</span>
                <textarea
                  value={promptValues[p.key] || ""}
                  onChange={(e) => setPromptValues((prev) => ({ ...prev, [p.key]: e.target.value }))}
                  onPaste={handlePaste}
                  placeholder={p.placeholder || ""}
                  autoFocus={i === 0}
                  className="flex w-full rounded-lg border border-input bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring min-h-[60px] resize-y"
                  rows={2}
                />
              </div>
            ))}
            {images.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {images.map((img, i) => (
                  <div key={i} className="relative group">
                    <img src={img.preview} className="w-16 h-16 object-cover rounded border border-border" />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={!allFilled || !selectedFolder || !selectedWorkflow || submitting}>
                {submitting ? "Starting..." : "Start"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [showStartModal, setShowStartModal] = useState(false);
  const navigate = useNavigate();

  const workFolders = useConfigStore((s) => s.workFolders);
  const selectedFolder = useConfigStore((s) => s.selectedFolder);
  const workflows = useConfigStore((s) => s.workflows);
  const workflowConfig = useConfigStore((s) => s.workflowConfig);
  const loadWorkFolders = useConfigStore((s) => s.loadWorkFolders);
  const workflowState = useWorkflowStore((s) => s.workflowState);
  const startWorkflow = useWorkflowStore((s) => s.startWorkflow);

  useEffect(() => { loadWorkFolders(); }, []);

  const folder = workFolders.find((f) => f.path === selectedFolder);
  const tasks = (folder?.tasks || []).map((t) => {
    if (workflowState && t.ticketId === workflowState.ticketId && workflowState.overallStatus !== "completed") {
      return { ...t, status: workflowState.overallStatus, phases: workflowState.phases };
    }
    return t;
  });

  const groups = workflowConfig?.groups || [];

  function handleStartWorkflow(id, folderPath, promptValues, images) {
    startWorkflow(id, folderPath, promptValues, images);
    setShowStartModal(false);
    navigate(`/ticket/${id}`);
  }

  function handleResume(id) {
    startWorkflow(id);
    navigate(`/ticket/${id}`);
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mb-6">
        <h2 className="text-base font-semibold text-foreground mb-4">Tasks</h2>
        <div className="flex flex-wrap gap-3 items-stretch">
          <div
            className="inline-flex flex-col items-center justify-center w-48 min-h-[200px] border border-dashed border-border rounded-lg cursor-pointer transition-colors hover:bg-accent hover:border-ring text-muted-foreground hover:text-foreground"
            onClick={() => setShowStartModal(true)}
          >
            <span className="text-2xl leading-none mb-1">+</span>
            <span className="text-sm">Start</span>
          </div>
          {tasks.map((t) => (
            <TaskCard
              key={t.ticketId}
              task={t}
              groups={groups}
              onClick={() => handleResume(t.ticketId)}
            />
          ))}
        </div>
      </div>

      {showStartModal && (
        <StartWorkflowModal
          workflows={workflows}
          workFolders={workFolders}
          defaultFolder={selectedFolder}
          onStart={handleStartWorkflow}
          onClose={() => setShowStartModal(false)}
        />
      )}
    </div>
  );
}
