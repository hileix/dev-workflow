import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Settings2, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useI18n } from "../components/i18n-provider";
import { LanguageToggle } from "../components/language-toggle";
import { ThemeToggle } from "../components/theme-toggle";
import { useConfigStore } from "../stores/configStore";
import { useWorkflowStore } from "../stores/workflowStore";
import { getAppApi } from "../lib/api-client";

const appApi = getAppApi();

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
  if (status === "paused") {
    return (
      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="none">
        <rect x="1" y="1" width="18" height="18" rx="3" stroke="#f59e0b" strokeWidth="2" />
        <rect x="7" y="6" width="2.5" height="8" rx="1" fill="#f59e0b" />
        <rect x="10.5" y="6" width="2.5" height="8" rx="1" fill="#f59e0b" />
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
  if (status === "failed") {
    return (
      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="none">
        <rect x="1" y="1" width="18" height="18" rx="3" fill="#dc2626" />
        <path d="M7 7l6 6M13 7l-6 6" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="none">
      <rect x="1" y="1" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" className="text-border" />
    </svg>
  );
}

function TaskCard({ task, onClick, t }) {
  const taskId = task.taskId || "";
  const groups = task.workflowConfig?.groups || [];
  const phaseStatusMap = {};
  for (const p of task.phases || []) {
    phaseStatusMap[p.id] = p.status;
  }

  return (
    <div
      className={`w-60 max-w-full flex-none overflow-hidden rounded-md border bg-card cursor-pointer transition-colors hover:bg-accent/65 ${
        task.status === "failed"
          ? "border-2 border-destructive"
          : task.status === "awaiting_input" || task.status === "paused"
            ? "border-2 border-warning animate-pulse-subtle"
            : "border-border"
      }`}
      onClick={onClick}
    >
      <div className="flex min-w-0 items-center gap-3 px-4 py-3 border-b border-border">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={taskId}>{taskId}</span>
        <Badge
          className="shrink-0"
          variant={
            task.status === "completed" ? "success" :
            task.status === "awaiting_input" || task.status === "paused" ? "warning" :
            task.status === "in_progress" ? "info" :
            task.status === "failed" ? "destructive" :
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
            else if (statuses.some((s) => s === "failed")) groupStatus = "failed";
            else if (statuses.some((s) => s === "paused")) groupStatus = "paused";
            else if (statuses.some((s) => s === "awaiting_input")) groupStatus = "awaiting_input";
            else if (statuses.some((s) => s === "in_progress")) groupStatus = "in_progress";

            return (
              <div key={g.key} className="flex items-center gap-2.5">
                <StepCheckbox status={groupStatus} />
                <span className="min-w-0 truncate text-sm text-foreground">{g.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StartWorkflowModal({ workflows, workFolders, defaultFolder, defaultWorkflow, onStart, onClose, t }) {
  const initialWorkflow = workflows.some((wf) => wf.filename === defaultWorkflow)
    ? defaultWorkflow
    : workflows[0]?.filename || null;
  const [selectedWorkflow, setSelectedWorkflow] = useState(initialWorkflow);
  const [selectedFolder, setSelectedFolder] = useState(defaultFolder);
  const [taskInputs, setTaskInputs] = useState({});
  const [worktreeName, setWorktreeName] = useState("");
  const [images, setImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const activeWf = workflows.find((wf) => wf.filename === selectedWorkflow);
  const taskInputFields = activeWf?.taskInputFields || [];
  const worktreeConfig = activeWf?.worktree || { enabled: false, files: [] };
  const defaultTaskInputFields = [{ key: "taskId", label: t("home.instanceId"), placeholder: t("home.instanceIdPlaceholder") }];
  const displayTaskInputFields = taskInputFields.length > 0 ? taskInputFields : defaultTaskInputFields;

  const firstKey = displayTaskInputFields[0]?.key;
  const allFilled = displayTaskInputFields.every((field, index) => {
    const hasText = (taskInputs[field.key] || "").trim();
    if (field.required === false) return true;
    return hasText || (index === 0 && images.length > 0);
  });
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
    const descriptionValue = (taskInputs.task || taskInputs[firstKey] || "").trim();
    const derivedId = displayTaskInputFields.length === 1 && firstKey === "taskId"
      ? `task-${Date.now()}`
      : (taskInputs[firstKey] || descriptionValue).trim();
    const id = derivedId || `task-${Date.now()}`;

    setSubmitting(true);
    try {
      let uploadedPaths = [];
      if (images.length > 0) {
        const payload = await Promise.all(images.map(async (img) => ({
          name: img.file.name,
          data: Array.from(new Uint8Array(await img.file.arrayBuffer())),
        })));
        const data = await appApi.saveTaskUploads(runId, payload);
        uploadedPaths = data.paths || [];
      }

      onStart(id, selectedFolder, taskInputs, uploadedPaths.length > 0 ? uploadedPaths : undefined, runId, worktreeName.trim(), selectedWorkflow);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-md border border-border bg-card shadow-xl">
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
                {worktreeConfig.useCustomSetupScript ? (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {t("home.gitWorktreeCustomSetup")}
                  </div>
                ) : worktreeConfig.files.length > 0 && (
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
          {worktreeConfig.enabled && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground">{t("home.worktreeName")}</span>
              <input
                value={worktreeName}
                onChange={(e) => setWorktreeName(e.target.value)}
                placeholder={t("home.worktreeNamePlaceholder")}
                className="flex h-11 w-full rounded-lg border border-input bg-secondary px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
              />
              <div className="text-[10px] text-muted-foreground">
                {t("home.worktreeNameHint")}
              </div>
            </div>
          )}
          <form className="space-y-3" onSubmit={handleSubmit}>
            {displayTaskInputFields.map((field, i) => (
              <div key={field.key} className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground">{field.label}</span>
                <textarea
                  value={taskInputs[field.key] || ""}
                  onChange={(e) => setTaskInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
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
  const activeWorkflowFile = useConfigStore((s) => s.activeWorkflowFile);
  const workflowConfig = useConfigStore((s) => s.workflowConfig);
  const loadWorkFolders = useConfigStore((s) => s.loadWorkFolders);
  const workflowStatesByRun = useWorkflowStore((s) => s.workflowStatesByRun);
  const syncTaskSummaries = useWorkflowStore((s) => s.syncTaskSummaries);
  const startWorkflow = useWorkflowStore((s) => s.startWorkflow);
  const loadTask = useWorkflowStore((s) => s.loadTask);
  const visibleWorkflows = workflows.filter((workflow) => workflow.visible !== false);

  useEffect(() => { loadWorkFolders(); }, []);
  const taskSummaries = useMemo(() => workFolders.flatMap((folder) =>
    (folder.tasks || []).map((task) => ({
      ...task,
      taskId: task.taskId || "",
      workFolderPath: folder.path,
      workFolderName: folder.name,
    }))
  ), [workFolders]);
  useEffect(() => {
    syncTaskSummaries(taskSummaries);
  }, [taskSummaries, syncTaskSummaries]);
  const tasks = taskSummaries.map((task) => {
    const taskRunId = task.runId || task.taskId || "";
    const sharedState = workflowStatesByRun[`${task.taskId}:${taskRunId}`];
    const state = sharedState;
    const stateRunId = state?.runId || "";
    if (
      state &&
      task.taskId === state.taskId &&
      taskRunId === stateRunId
    ) {
      return {
        ...task,
        status: state.overallStatus,
        phases: state.phases,
        workflowConfig: state.workflowConfig || task.workflowConfig,
      };
    }
    return task;
  });

  const canStartWorkflow = visibleWorkflows.length > 0;

  function handleStartWorkflow(id, folderPath, taskInputs, images, runId, worktreeName, workflowFilename) {
    startWorkflow(id, folderPath, taskInputs, images, runId, worktreeName, workflowFilename);
    setShowStartModal(false);
    const query = runId ? `?runId=${encodeURIComponent(runId)}` : "";
    navigate(`/task/${encodeURIComponent(id)}${query}`);
  }

  function handleOpenTask(task) {
    const id = task.taskId;
    if (!id) return;
    loadTask(id, task.runId);
    const query = task.runId ? `?runId=${encodeURIComponent(task.runId)}` : "";
    navigate(`/task/${encodeURIComponent(id)}${query}`);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-8 py-5">
          <h1 className="text-[24px] font-semibold text-foreground">{t("home.tasks")}</h1>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/settings" aria-label={t("nav.settings")} title={t("nav.settings")}>
                <Settings2 className="h-4 w-4" />
              </Link>
            </Button>
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-5 text-sm font-medium text-muted-foreground">
            {tasks.length} active task{tasks.length === 1 ? "" : "s"}
          </div>
          <div className="flex flex-wrap items-stretch gap-4">
            <button
              type="button"
              className={`inline-flex min-h-[196px] w-60 flex-col items-center justify-center rounded-md border border-dashed border-border bg-card text-muted-foreground transition-colors ${
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
          workflows={visibleWorkflows}
          workFolders={workFolders}
          defaultFolder={selectedFolder}
          defaultWorkflow={activeWorkflowFile}
          onStart={handleStartWorkflow}
          onClose={() => setShowStartModal(false)}
          t={t}
        />
      )}
    </div>
  );
}
