import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Settings2, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useI18n } from "../components/i18n-provider";
import { ThemeToggle } from "../components/theme-toggle";
import { WindowChrome } from "../components/window-chrome";
import { useConfigStore } from "../stores/configStore";
import { useWorkflowStore } from "../stores/workflowStore";
import { getAppApi } from "../lib/api-client";

const desktopApi = getAppApi();

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

function TaskCard({ task, groups, onClick, t }) {
  const taskId = task.taskId || task.ticketId || "";
  const phaseStatusMap = {};
  for (const p of task.phases || []) {
    phaseStatusMap[p.id] = p.status;
  }

  return (
    <div
      className={`inline-block min-w-[18rem] overflow-hidden rounded-2xl border bg-card/78 shadow-[0_1px_0_rgba(255,255,255,0.65)_inset] cursor-pointer transition-colors hover:bg-accent/65 ${
        task.status === "awaiting_input" ? "border-2 border-warning animate-pulse-subtle" : "border-border"
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">{taskId}</span>
        <Badge
          variant={
            task.status === "completed" ? "success" :
            task.status === "awaiting_input" ? "warning" :
            task.status === "in_progress" ? "info" :
            "secondary"
          }
        >
          {t(`status.${task.status}`)}
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

function StartWorkflowModal({ workflows, workFolders, defaultFolder, onStart, onClose, t }) {
  const [selectedWorkflow, setSelectedWorkflow] = useState(workflows[0]?.filename || null);
  const [selectedFolder, setSelectedFolder] = useState(defaultFolder);
  const [contextValues, setContextValues] = useState({});
  const [images, setImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const activeWf = workflows.find((wf) => wf.filename === selectedWorkflow);
  const contextFields = activeWf?.contextFields || [];
  const worktreeConfig = activeWf?.worktree || { enabled: false, files: [] };
  const defaultContextFields = [{ key: "taskId", label: t("home.instanceId"), placeholder: t("home.instanceIdPlaceholder") }];
  const displayContextFields = contextFields.length > 0 ? contextFields : defaultContextFields;

  const firstKey = displayContextFields[0]?.key;
  const allFilled = displayContextFields.every((field) => (contextValues[field.key] || "").trim());
  const runId = `run-${Date.now()}`;

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
    const descriptionValue = (contextValues.task || contextValues[firstKey] || "").trim();
    const id = displayContextFields.length === 1 && firstKey === "taskId"
      ? `task-${Date.now()}`
      : (contextValues[firstKey] || descriptionValue).trim();

    setSubmitting(true);
    try {
      let uploadedPaths = [];
      if (images.length > 0) {
        const payload = await Promise.all(images.map(async (img) => ({
          name: img.file.name,
          data: Array.from(new Uint8Array(await img.file.arrayBuffer())),
        })));
        const data = await desktopApi.saveTaskUploads(runId, payload);
        uploadedPaths = data.paths || [];
      }

      onStart(id, selectedFolder, contextValues, uploadedPaths.length > 0 ? uploadedPaths : undefined, runId);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-card/92 shadow-[0_24px_80px_rgba(15,23,42,0.2)]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">{t("home.startWorkflow")}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">&times;</button>
        </div>

        <div className="px-6 py-4 space-y-5">
          <div className="space-y-2">
            <span className="text-xs font-semibold text-muted-foreground">{t("home.workflow")}</span>
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
                    <span className="text-xs text-muted-foreground">{t("home.stepsCount", { count: wf.phaseCount })}</span>
                  </div>
                </div>
              ))}
            </div>
            {worktreeConfig.enabled && (
              <div className="rounded-lg border border-border bg-secondary/60 px-3 py-2">
                <div className="text-xs font-semibold text-foreground">{t("home.gitWorktreeEnabled")}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {t("home.gitWorktreeHint")}
                </div>
                {worktreeConfig.removeOnComplete && (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {t("home.gitWorktreeRemoveHint")}
                  </div>
                )}
                {worktreeConfig.files.length > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {t("home.gitWorktreeFiles", { files: worktreeConfig.files.join(", ") })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <span className="text-xs font-semibold text-muted-foreground">{t("home.workFolder")}</span>
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
            {displayContextFields.map((field, i) => (
              <div key={field.key} className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground">{field.label}</span>
                <textarea
                  value={contextValues[field.key] || ""}
                  onChange={(e) => setContextValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  onPaste={handlePaste}
                  placeholder={field.placeholder || ""}
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
              <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={!allFilled || !selectedFolder || !selectedWorkflow || submitting}>
                {submitting ? t("home.starting") : t("home.start")}
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
  const { t } = useI18n();

  const workFolders = useConfigStore((s) => s.workFolders);
  const selectedFolder = useConfigStore((s) => s.selectedFolder);
  const workflows = useConfigStore((s) => s.workflows);
  const workflowConfig = useConfigStore((s) => s.workflowConfig);
  const loadWorkFolders = useConfigStore((s) => s.loadWorkFolders);
  const workflowState = useWorkflowStore((s) => s.workflowState);
  const startWorkflow = useWorkflowStore((s) => s.startWorkflow);
  const loadTicket = useWorkflowStore((s) => s.loadTicket);

  useEffect(() => { loadWorkFolders(); }, []);
  const tasks = workFolders.flatMap((folder) =>
    (folder.tasks || []).map((task) => ({
      ...task,
      taskId: task.taskId || task.ticketId || "",
      workFolderPath: folder.path,
      workFolderName: folder.name,
    }))
  ).map((task) => {
    if (workflowState && task.taskId === workflowState.taskId && workflowState.overallStatus !== "completed") {
      return { ...task, status: workflowState.overallStatus, phases: workflowState.phases };
    }
    return task;
  });

  const groups = workflowConfig?.groups || [];
  const canStartWorkflow = workflows.length > 0;

  function handleStartWorkflow(id, folderPath, contextValues, images, runId) {
    startWorkflow(id, folderPath, contextValues, images, runId);
    setShowStartModal(false);
    const query = runId ? `?runId=${encodeURIComponent(runId)}` : "";
    navigate(`/ticket/${encodeURIComponent(id)}${query}`);
  }

  function handleOpenTask(task) {
    const id = task.taskId;
    if (!id) return;
    loadTicket(id, task.runId);
    const query = task.runId ? `?runId=${encodeURIComponent(task.runId)}` : "";
    navigate(`/ticket/${encodeURIComponent(id)}${query}`);
  }

  return (
    <div className="flex h-full flex-col">
      <WindowChrome />

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-[24px] font-semibold text-foreground">{t("home.tasks")}</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/settings" aria-label={t("nav.settings")} title={t("nav.settings")}>
                  <Settings2 className="h-4 w-4" />
                </Link>
              </Button>
              <ThemeToggle />
            </div>
          </div>
          <div className="flex flex-wrap gap-3 items-stretch">
            <button
              type="button"
              className={`inline-flex min-h-[196px] w-52 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/55 text-muted-foreground shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] transition-colors ${
                canStartWorkflow
                  ? "hover:border-ring hover:bg-accent/70 hover:text-foreground"
                  : "cursor-not-allowed opacity-50"
              }`}
              onClick={() => {
                if (canStartWorkflow) setShowStartModal(true);
              }}
              disabled={!canStartWorkflow}
            >
              <span className="mb-1 text-2xl leading-none">+</span>
              <span className="text-sm font-medium">{t("home.start")}</span>
            </button>
            {tasks.map((task) => (
              <TaskCard
                key={`${task.workFolderPath}:${task.runId || task.taskId}`}
                task={task}
                groups={groups}
                onClick={() => {
                  handleOpenTask(task);
                }}
                t={t}
              />
            ))}
          </div>
        </div>
      </div>

      {showStartModal && (
        <StartWorkflowModal
          workflows={workflows}
          workFolders={workFolders}
          defaultFolder={selectedFolder}
          onStart={handleStartWorkflow}
          onClose={() => setShowStartModal(false)}
          t={t}
        />
      )}
    </div>
  );
}
