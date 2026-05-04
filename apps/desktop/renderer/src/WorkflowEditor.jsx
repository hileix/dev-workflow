import { useState, useEffect } from "react";
import { ChevronDown, PanelRightClose, PanelRightOpen, Trash2 } from "lucide-react";
import { BackButton } from "./components/back-button";
import { useI18n } from "./components/i18n-provider";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import WorkflowFlowchart from "./components/WorkflowFlowchart";
import { WindowChrome } from "./components/window-chrome";
import { cn } from "./lib/utils";
import { getAppApi } from "./lib/api-client";
import { useConfigStore } from "./stores/configStore";

const desktopApi = getAppApi();

function generateId(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const EMPTY_INPUT = {
  name: "",
  sourceType: "workflow_context",
  contextLabel: "",
  contextPlaceholder: "",
  phaseId: "",
  outputKey: "",
  required: true,
};

const EMPTY_OUTPUT = {
  key: "",
  kind: "document",
  filename: "",
};

const EMPTY_PUBLISH_RULE = {
  action: "approve",
  sourceName: "",
  asOutputKey: "",
  filename: "",
};

const DEFAULT_CHECKPOINT = {
  actions: ["approve", "request_revision"],
  rejectTargets: [],
  publish: [],
};

const EMPTY_PHASE = {
  id: "",
  type: "auto",
  aiBackend: "claude",
  label: "",
  group: "",
  groupLabel: "",
  inputs: [],
  outputs: [],
  skill: "",
  skillRefs: [],
  prompt: "",
  checkpoint: { ...DEFAULT_CHECKPOINT },
};

const DEFAULT_WORKTREE = {
  enabled: false,
  files: [],
  customFiles: [],
  removeOnComplete: false,
};

const COMMON_WORKTREE_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".npmrc",
  ".pnpmrc",
  ".yarnrc.yml",
  ".claude/settings.local.json",
];

function normalizeCustomWorktreeFiles(customFiles) {
  const seen = new Set();
  const result = [];

  for (const file of customFiles || []) {
    const value = String(file || "").trim();
    if (!value || seen.has(value) || COMMON_WORKTREE_FILES.includes(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

function normalizeCheckpoint(checkpoint) {
  return {
    actions: Array.isArray(checkpoint?.actions) && checkpoint.actions.length > 0
      ? checkpoint.actions
      : [...DEFAULT_CHECKPOINT.actions],
    rejectTargets: Array.isArray(checkpoint?.rejectTargets) ? checkpoint.rejectTargets : [],
    publish: Array.isArray(checkpoint?.publish) ? checkpoint.publish : [],
  };
}

function normalizePhase(phase) {
  return {
    ...EMPTY_PHASE,
    ...phase,
    aiBackend: phase?.aiBackend || "claude",
    skillRefs: Array.isArray(phase?.skillRefs) ? phase.skillRefs : [],
    inputs: Array.isArray(phase?.inputs) ? phase.inputs : [],
    outputs: Array.isArray(phase?.outputs) ? phase.outputs : [],
    checkpoint: normalizeCheckpoint(phase?.checkpoint),
  };
}

function getDefaultPhaseLabel(type, index) {
  if (type === "checkpoint") return `Review ${index}`;
  return `Phase ${index}`;
}

function normalizeFirstPhaseInputs(phases) {
  return phases.map((phase, idx) => {
    if (idx !== 0) return phase;
    return {
      ...phase,
      inputs: (phase.inputs || []).map((input) => ({
        ...input,
        sourceType: "workflow_context",
        phaseId: "",
        outputKey: "",
      })),
    };
  });
}

function getOutputSummary(phase) {
  const outputs = Array.isArray(phase?.outputs) ? phase.outputs : [];
  if (outputs.length === 0) return "Produces 0";
  return `out: ${outputs.map((output) => output.key || output.filename || "output").join(", ")}`;
}

function getInputSummary(phase) {
  const inputs = Array.isArray(phase?.inputs) ? phase.inputs : [];
  if (inputs.length === 0) return "Consumes 0";
  return `in: ${inputs.map((input) => input.name || "input").join(", ")}`;
}

function extractTemplateVariables(text) {
  return Array.from(String(text || "").matchAll(/\{\{(\w+)\}\}/g)).map((match) => match[1]);
}

export default function WorkflowEditor({ filename, onClose, onSaved }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [phases, setPhases] = useState([]);
  const [worktreeEnabled, setWorktreeEnabled] = useState(false);
  const [selectedWorktreeFiles, setSelectedWorktreeFiles] = useState([...COMMON_WORKTREE_FILES]);
  const [customWorktreeFiles, setCustomWorktreeFiles] = useState([]);
  const [newCustomWorktreeFile, setNewCustomWorktreeFile] = useState("");
  const [removeWorktreeOnComplete, setRemoveWorktreeOnComplete] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState(null);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [showSkillGenerate, setShowSkillGenerate] = useState(false);
  const [skillDescription, setSkillDescription] = useState("");
  const [generatingSkill, setGeneratingSkill] = useState(false);
  const [flowchartCollapsed, setFlowchartCollapsed] = useState(true);
  const isNew = !filename;
  const skills = useConfigStore((s) => s.skills);
  const loadSkills = useConfigStore((s) => s.loadSkills);

  useEffect(() => {
    loadSkills();
    if (!filename) {
      setName("");
      setPhases([]);
      setWorktreeEnabled(false);
      setSelectedWorktreeFiles([...COMMON_WORKTREE_FILES]);
      setCustomWorktreeFiles([]);
      setNewCustomWorktreeFile("");
      setRemoveWorktreeOnComplete(false);
      setSelectedIdx(null);
      return;
    }
    desktopApi.getWorkflow(filename)
      .then((wf) => {
        setName(wf.name || "");
        setPhases(normalizeFirstPhaseInputs((wf.phases || []).map((phase) => normalizePhase(phase))));
        const worktree = { ...DEFAULT_WORKTREE, ...(wf.worktree || {}) };
        const mergedSelectedFiles = Array.isArray(worktree.files) && worktree.files.length > 0
          ? worktree.files
          : [...COMMON_WORKTREE_FILES, ...(worktree.customFiles || [])];
        const inferredCustomFiles = mergedSelectedFiles.filter((file) => !COMMON_WORKTREE_FILES.includes(file));
        setWorktreeEnabled(Boolean(worktree.enabled));
        setSelectedWorktreeFiles(mergedSelectedFiles.length > 0 ? mergedSelectedFiles : [...COMMON_WORKTREE_FILES]);
        setCustomWorktreeFiles(normalizeCustomWorktreeFiles(
          Array.isArray(worktree.customFiles) && worktree.customFiles.length > 0
            ? worktree.customFiles
            : inferredCustomFiles
        ));
        setNewCustomWorktreeFile("");
        setRemoveWorktreeOnComplete(Boolean(worktree.removeOnComplete));
        setSelectedIdx(wf.phases?.length > 0 ? 0 : null);
      })
      .catch(() => setError(t("editor.loadWorkflowFailed")));
  }, [filename]);

  function updatePhase(idx, field, value) {
    setPhases((prev) => normalizeFirstPhaseInputs(prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p))));
    setDirty(true);
  }

  function updatePhaseWith(fn) {
    if (selectedIdx === null) return;
    setPhases((prev) => normalizeFirstPhaseInputs(prev.map((phase, idx) => (
      idx === selectedIdx ? fn(phase) : phase
    ))));
    setDirty(true);
  }

  function addPhase() {
    const nextIndex = phases.length + 1;
    const newPhase = normalizePhase({
      ...EMPTY_PHASE,
      id: `phase_new_${nextIndex}`,
      label: getDefaultPhaseLabel("auto", nextIndex),
    });
    setPhases((prev) => normalizeFirstPhaseInputs([...prev, newPhase]));
    setSelectedIdx(phases.length);
    setDirty(true);
  }

  function removePhase(idx) {
    setPhases((prev) => normalizeFirstPhaseInputs(prev.filter((_, i) => i !== idx)));
    setSelectedIdx((prev) => {
      if (prev === idx) return phases.length > 1 ? Math.min(idx, phases.length - 2) : null;
      if (prev > idx) return prev - 1;
      return prev;
    });
    setDirty(true);
  }

  function movePhase(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= phases.length) return;
    setPhases((prev) => {
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return normalizeFirstPhaseInputs(copy);
    });
    setSelectedIdx(newIdx);
    setDirty(true);
  }

  function toggleSkillRef(ref) {
    if (selectedIdx === null) return;
    const selectedPhase = phases[selectedIdx];
    const current = selectedPhase.skillRefs || [];
    const updated = current.includes(ref)
      ? current.filter((item) => item !== ref)
      : [...current, ref];
    updatePhase(selectedIdx, "skillRefs", updated);
  }

  function toggleWorktreeFile(file) {
    setSelectedWorktreeFiles((prev) => (
      prev.includes(file)
        ? prev.filter((item) => item !== file)
        : [...prev, file]
    ));
    setDirty(true);
  }

  function updateSelectedPhaseInput(inputIdx, field, value) {
    updatePhaseWith((phase) => ({
      ...phase,
      inputs: phase.inputs.map((input, idx) => idx === inputIdx ? { ...input, [field]: value } : input),
    }));
  }

  function addSelectedPhaseInput() {
    updatePhaseWith((phase) => ({
      ...phase,
      inputs: [...phase.inputs, { ...EMPTY_INPUT, sourceType: selectedIdx === 0 ? "workflow_context" : "workflow_context" }],
    }));
  }

  function removeSelectedPhaseInput(inputIdx) {
    updatePhaseWith((phase) => ({
      ...phase,
      inputs: phase.inputs.filter((_, idx) => idx !== inputIdx),
    }));
  }

  function updateSelectedPhaseOutput(outputIdx, field, value) {
    updatePhaseWith((phase) => ({
      ...phase,
      outputs: phase.outputs.map((output, idx) => idx === outputIdx ? { ...output, [field]: value } : output),
    }));
  }

  function addSelectedPhaseOutput() {
    updatePhaseWith((phase) => ({
      ...phase,
      outputs: [...phase.outputs, { ...EMPTY_OUTPUT }],
    }));
  }

  function removeSelectedPhaseOutput(outputIdx) {
    updatePhaseWith((phase) => ({
      ...phase,
      outputs: phase.outputs.filter((_, idx) => idx !== outputIdx),
    }));
  }

  function updateSelectedCheckpoint(field, value) {
    updatePhaseWith((phase) => ({
      ...phase,
      checkpoint: {
        ...normalizeCheckpoint(phase.checkpoint),
        [field]: value,
      },
    }));
  }

  function toggleCheckpointAction(action) {
    updatePhaseWith((phase) => {
      const checkpoint = normalizeCheckpoint(phase.checkpoint);
      const currentActions = checkpoint.actions || [];
      const nextActions = currentActions.includes(action)
        ? currentActions.filter((item) => item !== action)
        : [...currentActions, action];
      return {
        ...phase,
        checkpoint: {
          ...checkpoint,
          actions: nextActions.length > 0 ? nextActions : [action],
        },
      };
    });
  }

  function toggleCheckpointRejectTarget(target) {
    updatePhaseWith((phase) => {
      const checkpoint = normalizeCheckpoint(phase.checkpoint);
      const current = checkpoint.rejectTargets || [];
      const updated = current.includes(target)
        ? current.filter((item) => item !== target)
        : [...current, target];
      return {
        ...phase,
        checkpoint: {
          ...checkpoint,
          rejectTargets: updated,
        },
      };
    });
  }

  function updateSelectedPublishRule(ruleIdx, field, value) {
    updatePhaseWith((phase) => {
      const checkpoint = normalizeCheckpoint(phase.checkpoint);
      return {
        ...phase,
        checkpoint: {
          ...checkpoint,
          publish: checkpoint.publish.map((rule, idx) => idx === ruleIdx ? { ...rule, [field]: value } : rule),
        },
      };
    });
  }

  function addSelectedPublishRule() {
    updatePhaseWith((phase) => {
      const checkpoint = normalizeCheckpoint(phase.checkpoint);
      return {
        ...phase,
        checkpoint: {
          ...checkpoint,
          publish: [...checkpoint.publish, { ...EMPTY_PUBLISH_RULE }],
        },
      };
    });
  }

  function removeSelectedPublishRule(ruleIdx) {
    updatePhaseWith((phase) => {
      const checkpoint = normalizeCheckpoint(phase.checkpoint);
      return {
        ...phase,
        checkpoint: {
          ...checkpoint,
          publish: checkpoint.publish.filter((_, idx) => idx !== ruleIdx),
        },
      };
    });
  }

  function addCustomWorktreeFile() {
    const value = newCustomWorktreeFile.trim();
    if (!value) return;
    if (!selectedWorktreeFiles.includes(value)) {
      setSelectedWorktreeFiles((prev) => [...prev, value]);
    }
    setCustomWorktreeFiles((prev) => normalizeCustomWorktreeFiles([...prev, value]));
    setNewCustomWorktreeFile("");
    setDirty(true);
  }

  function removeCustomWorktreeFile(file) {
    setCustomWorktreeFiles((prev) => prev.filter((item) => item !== file));
    setSelectedWorktreeFiles((prev) => prev.filter((item) => item !== file));
    setDirty(true);
  }

  async function generateSkill() {
    if (selectedIdx === null) return;
    const phase = phases[selectedIdx];
    setGeneratingSkill(true);
    try {
      const data = await desktopApi.generateSkill({
        label: phase.label,
        id: phase.id,
        prompt: phase.prompt,
        description: skillDescription,
      });
      updatePhase(selectedIdx, "skill", data.skill);
    } catch {}
    setGeneratingSkill(false);
    setShowSkillGenerate(false);
    setSkillDescription("");
  }

  async function handleSave() {
    if (!name.trim()) { setError(t("editor.workflowNameRequired")); return; }
    if (phases.length === 0) { setError(t("editor.phaseRequired")); return; }
    for (const p of phases) {
      if (!p.id || !p.label || !p.type || !p.group) {
        setError(t("editor.phaseMissingFields", { name: p.label || p.id || t("editor.unnamed") }));
        return;
      }
      for (const input of p.inputs || []) {
        if (!input.name || !input.sourceType) {
          setError(t("editor.phaseMissingFields", { name: p.label || p.id || t("editor.unnamed") }));
          return;
        }
        if (input.sourceType === "workflow_context" && !input.contextLabel) {
          setError(t("editor.phaseMissingFields", { name: p.label || p.id || t("editor.unnamed") }));
          return;
        }
        if (input.sourceType === "phase_output" && (!input.phaseId || !input.outputKey)) {
          setError(t("editor.phaseMissingFields", { name: p.label || p.id || t("editor.unnamed") }));
          return;
        }
      }
      for (const output of p.outputs || []) {
        if (!output.key || !output.filename) {
          setError(t("editor.phaseMissingFields", { name: p.label || p.id || t("editor.unnamed") }));
          return;
        }
      }
      if (p.type === "checkpoint") {
        const checkpoint = normalizeCheckpoint(p.checkpoint);
        for (const rule of checkpoint.publish || []) {
          if (!rule.action || !rule.sourceName || !rule.asOutputKey || !rule.filename) {
            setError(t("editor.phaseMissingFields", { name: p.label || p.id || t("editor.unnamed") }));
            return;
          }
        }
      }
      if (p.type === "auto") {
        const allowedVariables = new Set(["taskId", "baseDir", "taskDir", ...(p.inputs || []).map((input) => input.name).filter(Boolean)]);
        const referencedVariables = extractTemplateVariables([p.skill, p.prompt].filter(Boolean).join("\n\n"));
        const invalidVariable = referencedVariables.find((name) => !allowedVariables.has(name));
        if (invalidVariable) {
          setError(`Phase "${p.label || p.id}" uses undeclared variable "{{${invalidVariable}}}"`);
          return;
        }
      }
    }
    setError(null);
    setSaving(true);

    const worktreeFiles = Array.from(new Set([...selectedWorktreeFiles, ...customWorktreeFiles]));

    const workflow = {
      name: name.trim(),
      phases: normalizeFirstPhaseInputs(phases).map((phase) => ({
        ...phase,
        checkpoint: phase.type === "checkpoint" ? normalizeCheckpoint(phase.checkpoint) : undefined,
      })),
      worktree: {
        enabled: worktreeEnabled,
        files: worktreeFiles,
        customFiles: normalizeCustomWorktreeFiles(customWorktreeFiles),
        removeOnComplete: worktreeEnabled && removeWorktreeOnComplete,
      },
    };
    try {
      if (isNew) {
        await desktopApi.createWorkflow(workflow);
      } else {
        await desktopApi.updateWorkflow(filename, workflow);
      }
      setDirty(false);
      onSaved();
    } catch (err) {
      setError(err.message || t("editor.saveWorkflowFailed"));
    } finally {
      setSaving(false);
    }
  }

  const selected = selectedIdx !== null ? phases[selectedIdx] : null;
  const autoPhaseIds = phases.filter((p) => p.type === "auto").map((p) => p.id);
  const displayedWorktreeFiles = [...COMMON_WORKTREE_FILES, ...customWorktreeFiles];

  return (
    <div className="flex flex-col h-full">
      <WindowChrome />
      <div className="flex items-center gap-4 border-b border-border/70 bg-background/55 px-8 py-5">
        <BackButton onClick={() => dirty ? setShowBackConfirm(true) : onClose()} label={t("editor.back")} className="-ml-2" />
        <Input
          value={name}
          onChange={(e) => { setName(e.target.value); setDirty(true); }}
          placeholder={t("editor.workflowName")}
          className="no-drag max-w-xs"
        />
        <div className="flex-1" />
        {error && <span className="text-destructive text-xs">{error}</span>}
        <Button className="no-drag" size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? t("editor.saving") : t("editor.save")}
        </Button>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Phase list (left) */}
        <div className="w-96 shrink-0 border-r border-border bg-sidebar/60 overflow-y-auto py-4">
          <div className="px-4 pb-4 border-b border-border mb-3">
            <div className="flex items-center justify-between mb-2 gap-3">
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground">{t("editor.gitWorktree")}</h2>
                <span className="text-[10px] text-muted-foreground">{t("editor.gitWorktreeHint")}</span>
              </div>
              <button
                type="button"
                className={cn(
                  "inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors",
                  worktreeEnabled ? "justify-end" : "justify-start",
                  worktreeEnabled
                    ? "border-ring bg-ring/70"
                    : "border-border bg-secondary"
                )}
                onClick={() => {
                  setWorktreeEnabled((prev) => !prev);
                  setDirty(true);
                }}
                aria-pressed={worktreeEnabled}
              >
                <span
                  className={cn(
                    "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm"
                  )}
                />
              </button>
            </div>
            {worktreeEnabled && (
              <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
                {displayedWorktreeFiles.map((file) => (
                  <label key={file} className="flex items-center gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={selectedWorktreeFiles.includes(file)}
                      onChange={() => toggleWorktreeFile(file)}
                    />
                    <span className="font-mono">{file}</span>
                    {!COMMON_WORKTREE_FILES.includes(file) && (
                      <button
                        type="button"
                        className="ml-auto text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded shrink-0"
                        onClick={(e) => {
                          e.preventDefault();
                          removeCustomWorktreeFile(file);
                        }}
                        aria-label={`Remove ${file}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </label>
                ))}
              </div>
            )}
            {worktreeEnabled && (
              <div className="mt-3">
                <label className="text-[10px] text-muted-foreground block mb-1.5">{t("editor.extraFiles")}</label>
                <div className="flex gap-2">
                  <Input
                    value={newCustomWorktreeFile}
                    onChange={(e) => setNewCustomWorktreeFile(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomWorktreeFile();
                      }
                    }}
                    placeholder={t("editor.extraFilesPlaceholder")}
                    className="h-10 font-mono text-xs"
                  />
                  <Button type="button" variant="outline" className="h-10 px-4" onClick={addCustomWorktreeFile}>
                    {t("editor.add")}
                  </Button>
                </div>
              </div>
            )}
            {worktreeEnabled && (
              <label className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={removeWorktreeOnComplete}
                  onChange={(e) => {
                    setRemoveWorktreeOnComplete(e.target.checked);
                    setDirty(true);
                  }}
                />
                {t("editor.removeWorktreeOnComplete")}
              </label>
            )}
            {worktreeEnabled && (
              <span className="text-[10px] text-muted-foreground mt-1 block">
                {t("editor.worktreeFilesHint")}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between px-4 pb-3">
            <h2 className="text-xs font-semibold text-muted-foreground">
              {t("editor.phases", { count: phases.length })}
            </h2>
            <Button variant="outline" size="sm" onClick={addPhase}>{t("editor.add")}</Button>
          </div>
          <ul className="list-none">
            {phases.map((p, idx) => (
              <li
                key={idx}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 cursor-pointer text-sm transition-colors",
                  "text-muted-foreground hover:bg-accent",
                  selectedIdx === idx && "bg-primary/30 text-foreground border-l-2 border-l-primary"
                )}
                onClick={() => setSelectedIdx(idx)}
              >
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span className="truncate">{p.label || p.id || t("editor.unnamed")}</span>
                  <span className="text-xs text-muted-foreground truncate">{p.id}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{getInputSummary(p)}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{getOutputSummary(p)}</span>
                </div>
                <Badge variant={p.type === "auto" ? "info" : "warning"} className="shrink-0 text-[10px]">
                  {p.type === "auto" ? t("editor.typeAuto") : t("editor.typeCheckpoint")}
                </Badge>
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    className="text-muted-foreground hover:text-foreground text-[10px] leading-none px-0.5"
                    onClick={(e) => { e.stopPropagation(); movePhase(idx, -1); }}
                    disabled={idx === 0}
                  >
                    ▲
                  </button>
                  <button
                    className="text-muted-foreground hover:text-foreground text-[10px] leading-none px-0.5"
                    onClick={(e) => { e.stopPropagation(); movePhase(idx, 1); }}
                    disabled={idx === phases.length - 1}
                  >
                    ▼
                  </button>
                </div>
                <button
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded shrink-0"
                  onClick={(e) => { e.stopPropagation(); setConfirmRemoveIdx(idx); }}
                  aria-label="Remove phase"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
          {phases.length === 0 && (
            <div className="text-muted-foreground text-xs p-4 text-center">
              {t("editor.noPhases")}
            </div>
          )}
        </div>

        {/* Phase edit form (middle) */}
        <div className="flex-1 overflow-y-auto bg-background/55 px-6 py-6">
          {selected ? (
            <div className="max-w-2xl space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">{t("editor.labelRequired")}</label>
                  <Input
                    value={selected.label}
                    onChange={(e) => {
                      const nextLabel = e.target.value;
                      const nextId = (selected.type === "checkpoint" ? "checkpoint_" : "phase_") + generateId(nextLabel);
                      setPhases((prev) => prev.map((phase, idx) => (
                        idx === selectedIdx
                          ? {
                              ...phase,
                              label: nextLabel,
                              id: !phase.id || phase.id === selected.id ? nextId : phase.id,
                            }
                          : phase
                      )));
                      setDirty(true);
                    }}
                    placeholder="e.g., Read Ticket"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">{t("editor.idRequired")}</label>
                  <Input
                    value={selected.id}
                    onChange={(e) => updatePhase(selectedIdx, "id", e.target.value)}
                    placeholder="e.g., phase_read_ticket"
                  />
                </div>
              </div>

              {selected.type === "auto" && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">{t("editor.aiBackend")}</label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { key: "claude", label: "Claude Agent SDK", hint: "@anthropic-ai/claude-agent-sdk" },
                      { key: "codex", label: "Codex SDK", hint: "@openai/codex-sdk" },
                    ].map((backend) => (
                      <button
                        key={backend.key}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors cursor-pointer",
                          selected.aiBackend === backend.key
                            ? "border-ring bg-secondary text-foreground"
                            : "border-border text-muted-foreground hover:bg-accent"
                        )}
                        onClick={() => updatePhase(selectedIdx, "aiBackend", backend.key)}
                      >
                        <div className="text-sm font-semibold">{backend.label}</div>
                        <div className="text-[10px]">{backend.hint}</div>
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">{t("editor.aiBackendHint")}</span>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">{t("editor.type")}</label>
                <div className="flex gap-3">
                  {["auto", "checkpoint"].map((phaseType) => (
                    <button
                      key={phaseType}
                      className={cn(
                        "px-4 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer",
                        selected.type === phaseType
                          ? "border-ring bg-secondary text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent"
                      )}
                      onClick={() => updatePhaseWith((phase) => ({
                        ...phase,
                        type: phaseType,
                        id: phase.id.startsWith("checkpoint_") || phase.id.startsWith("phase_")
                          ? `${phaseType === "checkpoint" ? "checkpoint_" : "phase_"}${generateId(phase.label || phase.id)}`
                          : phase.id,
                        checkpoint: normalizeCheckpoint(phase.checkpoint),
                      }))}
                    >
                      {phaseType === "auto" ? t("editor.typeAuto") : t("editor.typeCheckpoint")}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">{t("editor.groupKey")}</label>
                  <Input
                    value={selected.group}
                    onChange={(e) => updatePhase(selectedIdx, "group", e.target.value)}
                    placeholder="e.g., plan"
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">{t("editor.groupKeyHint")}</span>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">{t("editor.groupLabel")}</label>
                  <Input
                    value={selected.groupLabel || ""}
                    onChange={(e) => updatePhase(selectedIdx, "groupLabel", e.target.value || undefined)}
                    placeholder="e.g., Plan"
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">{t("editor.groupLabelHint")}</span>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block">{t("editor.inputs")}</label>
                    <span className="text-[10px] text-muted-foreground">{t("editor.inputsHint")}</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={addSelectedPhaseInput}>{t("editor.add")}</Button>
                </div>
                <div className="space-y-3">
                  {selected.inputs.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
                      {t("editor.noInputs")}
                    </div>
                  ) : selected.inputs.map((input, inputIdx) => (
                    <div key={inputIdx} className="rounded-xl border border-border bg-background/75 p-3">
                      {(() => {
                        const isFirstPhase = selectedIdx === 0;
                        const sourceType = isFirstPhase ? "workflow_context" : (input.sourceType || "workflow_context");
                        return (
                          <>
                      <div className="mb-3 flex items-start gap-2">
                        <div className={cn("grid flex-1 gap-3", isFirstPhase ? "grid-cols-1" : "grid-cols-2")}>
                          <Input
                            value={input.name || ""}
                            onChange={(e) => updateSelectedPhaseInput(inputIdx, "name", e.target.value)}
                            placeholder={t("editor.inputNamePlaceholder")}
                          />
                          {!isFirstPhase && (
                            <select
                              value={sourceType}
                              onChange={(e) => updateSelectedPhaseInput(inputIdx, "sourceType", e.target.value)}
                              className="h-10 rounded-lg border border-input bg-secondary px-3 text-sm text-foreground outline-none focus:border-ring"
                            >
                              <option value="workflow_context">{t("editor.sourceWorkflowContext")}</option>
                              <option value="phase_output">{t("editor.sourcePhaseOutput")}</option>
                            </select>
                          )}
                        </div>
                        <button
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded shrink-0"
                          onClick={() => removeSelectedPhaseInput(inputIdx)}
                          aria-label="Remove input"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {sourceType === "workflow_context" ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-[1fr_auto] gap-3">
                            <Input
                              value={input.contextLabel || ""}
                              onChange={(e) => updateSelectedPhaseInput(inputIdx, "contextLabel", e.target.value)}
                              placeholder={t("editor.contextLabelPlaceholder")}
                            />
                            <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={input.required !== false}
                                onChange={(e) => updateSelectedPhaseInput(inputIdx, "required", e.target.checked)}
                              />
                              {t("editor.required")}
                            </label>
                          </div>
                          <Input
                            value={input.contextPlaceholder || ""}
                            onChange={(e) => updateSelectedPhaseInput(inputIdx, "contextPlaceholder", e.target.value)}
                            placeholder={t("editor.contextPlaceholderPlaceholder")}
                          />
                        </div>
                      ) : (
                        <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
                          <select
                            value={input.phaseId || ""}
                            onChange={(e) => updateSelectedPhaseInput(inputIdx, "phaseId", e.target.value)}
                            className="h-10 rounded-lg border border-input bg-secondary px-3 text-sm text-foreground outline-none focus:border-ring"
                          >
                            <option value="">{t("editor.selectPhaseSource")}</option>
                            {phases
                              .filter((phase, idx) => idx !== selectedIdx)
                              .map((phase) => (
                                <option key={phase.id} value={phase.id}>
                                  {phase.label || phase.id}
                                </option>
                              ))}
                          </select>
                          <select
                            value={input.outputKey || ""}
                            onChange={(e) => updateSelectedPhaseInput(inputIdx, "outputKey", e.target.value)}
                            className="h-10 rounded-lg border border-input bg-secondary px-3 text-sm text-foreground outline-none focus:border-ring"
                          >
                            <option value="">{t("editor.selectOutputSource")}</option>
                            {(phases.find((phase) => phase.id === input.phaseId)?.outputs || []).map((output) => (
                              <option key={output.key} value={output.key}>
                                {output.key || output.filename}
                              </option>
                            ))}
                          </select>
                          <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={input.required !== false}
                              onChange={(e) => updateSelectedPhaseInput(inputIdx, "required", e.target.checked)}
                            />
                            {t("editor.required")}
                          </label>
                        </div>
                      )}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>

              {selected.type === "auto" && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">{t("editor.skill")}</label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSkillGenerate(true)}
                      disabled={generatingSkill}
                    >
                      {generatingSkill ? t("editor.generating") : t("editor.generateWithAi")}
                    </Button>
                  </div>
                  <div className="mb-2 rounded-lg border border-border bg-secondary/30 p-2">
                    {skills.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {t("editor.noManagedSkills")}
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {skills.map((skill) => {
                          const isSelected = (selected.skillRefs || []).includes(skill.id);
                          return (
                            <button
                              key={skill.id}
                              type="button"
                              className={cn(
                                "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer",
                                isSelected
                                  ? "border-ring bg-secondary text-foreground"
                                  : "border-border text-muted-foreground hover:bg-accent"
                              )}
                              onClick={() => toggleSkillRef(skill.id)}
                              title={skill.description || skill.name}
                            >
                              {skill.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <textarea
                    value={selected.skill || ""}
                    onChange={(e) => updatePhase(selectedIdx, "skill", e.target.value)}
                    placeholder={t("editor.skillPlaceholder")}
                    className="flex w-full rounded-lg border border-input bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring min-h-[80px] resize-y font-mono"
                    rows={3}
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">
                    {t("editor.skillHint")}
                  </span>
                </div>
              )}

              {selected.type === "auto" && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">{t("editor.prompt")}</label>
                  <textarea
                    value={selected.prompt || ""}
                    onChange={(e) => updatePhase(selectedIdx, "prompt", e.target.value)}
                    placeholder={t("editor.promptPlaceholder")}
                    className="flex w-full rounded-lg border border-input bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring min-h-[120px] resize-y font-mono"
                    rows={5}
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">
                    {t("editor.promptVariables")}
                  </span>
                </div>
              )}

              {selected.type === "checkpoint" && (
                <div className="space-y-4 rounded-2xl border border-border bg-card/60 p-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block">{t("editor.checkpointRules")}</label>
                    <span className="text-[10px] text-muted-foreground">{t("editor.checkpointRulesHint")}</span>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-semibold text-muted-foreground">{t("editor.availableActions")}</label>
                    <div className="flex flex-wrap gap-2">
                      {["approve", "edit_and_approve", "request_revision", "stop"].map((action) => {
                        const isSelected = (selected.checkpoint?.actions || []).includes(action);
                        return (
                          <button
                            key={action}
                            className={cn(
                              "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer",
                              isSelected
                                ? "border-ring bg-secondary text-foreground"
                                : "border-border text-muted-foreground hover:bg-accent"
                            )}
                            onClick={() => toggleCheckpointAction(action)}
                          >
                            {t(`editor.action.${action}`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-semibold text-muted-foreground">{t("editor.rejectTargets")}</label>
                    <div className="flex flex-wrap gap-2">
                      {autoPhaseIds.length === 0 ? (
                        <span className="text-xs text-muted-foreground">{t("editor.noAutoPhases")}</span>
                      ) : (
                        autoPhaseIds.map((pid) => {
                          const isSelected = (selected.checkpoint?.rejectTargets || []).includes(pid);
                          return (
                            <button
                              key={pid}
                              className={cn(
                                "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer",
                                isSelected
                                  ? "border-ring bg-secondary text-foreground"
                                  : "border-border text-muted-foreground hover:bg-accent"
                              )}
                              onClick={() => toggleCheckpointRejectTarget(pid)}
                            >
                              {phases.find((p) => p.id === pid)?.label || pid}
                            </button>
                          );
                        })
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-1 block">{t("editor.rejectTargetsHint")}</span>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label className="text-xs font-semibold text-muted-foreground">{t("editor.publishRules")}</label>
                      <Button variant="outline" size="sm" onClick={addSelectedPublishRule}>{t("editor.add")}</Button>
                    </div>
                    <div className="space-y-3">
                      {(selected.checkpoint?.publish || []).length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
                          {t("editor.noPublishRules")}
                        </div>
                      ) : (selected.checkpoint?.publish || []).map((rule, ruleIdx) => (
                        <div key={ruleIdx} className="rounded-xl border border-border bg-background/75 p-3">
                          <div className="mb-3 flex items-start gap-2">
                            <div className="grid flex-1 grid-cols-2 gap-3">
                              <select
                                value={rule.action || "approve"}
                                onChange={(e) => updateSelectedPublishRule(ruleIdx, "action", e.target.value)}
                                className="h-10 rounded-lg border border-input bg-secondary px-3 text-sm text-foreground outline-none focus:border-ring"
                              >
                                {["approve", "edit_and_approve", "request_revision", "stop"].map((action) => (
                                  <option key={action} value={action}>{t(`editor.action.${action}`)}</option>
                                ))}
                              </select>
                              <select
                                value={rule.sourceName || ""}
                                onChange={(e) => updateSelectedPublishRule(ruleIdx, "sourceName", e.target.value)}
                                className="h-10 rounded-lg border border-input bg-secondary px-3 text-sm text-foreground outline-none focus:border-ring"
                              >
                                <option value="">{t("editor.selectInputSource")}</option>
                                {selected.inputs.map((input) => (
                                  <option key={input.name} value={input.name}>
                                    {input.name || t("editor.unnamed")}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded shrink-0"
                              onClick={() => removeSelectedPublishRule(ruleIdx)}
                              aria-label="Remove publish rule"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Input
                              value={rule.asOutputKey || ""}
                              onChange={(e) => updateSelectedPublishRule(ruleIdx, "asOutputKey", e.target.value)}
                              placeholder={t("editor.publishOutputKeyPlaceholder")}
                            />
                            <Input
                              value={rule.filename || ""}
                              onChange={(e) => updateSelectedPublishRule(ruleIdx, "filename", e.target.value)}
                              placeholder={t("editor.publishFilenamePlaceholder")}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-border bg-card/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block">{t("editor.outputs")}</label>
                    <span className="text-[10px] text-muted-foreground">{t("editor.outputsHint")}</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={addSelectedPhaseOutput}>{t("editor.add")}</Button>
                </div>
                <div className="space-y-3">
                  {selected.outputs.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
                      {t("editor.noOutputs")}
                    </div>
                  ) : selected.outputs.map((output, outputIdx) => (
                    <div key={outputIdx} className="rounded-xl border border-border bg-background/75 p-3">
                      <div className="mb-3 flex items-start gap-2">
                        <div className="grid flex-1 grid-cols-3 gap-3">
                          <Input
                            value={output.key || ""}
                            onChange={(e) => updateSelectedPhaseOutput(outputIdx, "key", e.target.value)}
                            placeholder={t("editor.outputKeyPlaceholder")}
                          />
                          <div className="relative">
                            <select
                              value={output.kind || "document"}
                              onChange={(e) => updateSelectedPhaseOutput(outputIdx, "kind", e.target.value)}
                              className="h-9 w-full appearance-none rounded-md border border-input bg-secondary px-3 pr-9 text-sm text-foreground outline-none focus:border-ring"
                            >
                              <option value="document">{t("editor.outputKindDocument")}</option>
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          </div>
                          <Input
                            value={output.filename || ""}
                            onChange={(e) => updateSelectedPhaseOutput(outputIdx, "filename", e.target.value)}
                            placeholder={t("editor.outputFilenamePlaceholder")}
                          />
                        </div>
                        <button
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded shrink-0"
                          onClick={() => removeSelectedPhaseOutput(outputIdx)}
                          aria-label="Remove output"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {phases.length === 0 ? t("editor.firstPhaseHint") : t("editor.selectPhase")}
            </div>
          )}
        </div>

        {/* Workflow preview (right) */}
        {flowchartCollapsed ? (
          <div className="absolute right-3 top-3 z-10">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 px-0"
              onClick={() => setFlowchartCollapsed(false)}
              aria-label={t("editor.expandPreview")}
              title={t("editor.expandPreview")}
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="shrink-0 w-[34rem] border-l border-border bg-secondary/30 transition-all duration-200">
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xs font-semibold text-muted-foreground">{t("editor.workflowPreview")}</h2>
                  <span className="text-[10px] text-muted-foreground">{t("editor.workflowPreviewHint")}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 px-0"
                  onClick={() => setFlowchartCollapsed(true)}
                  aria-label={t("editor.collapsePreview")}
                  title={t("editor.collapsePreview")}
                >
                  <PanelRightClose className="h-4 w-4" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 p-4">
                <WorkflowFlowchart
                  phases={phases}
                  selectedIdx={selectedIdx}
                  onSelectPhase={setSelectedIdx}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {showBackConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowBackConfirm(false)}>
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">{t("editor.unsavedChanges")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("editor.unsavedChangesConfirm")}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowBackConfirm(false)}>{t("common.cancel")}</Button>
              <Button variant="destructive" size="sm" onClick={() => { setShowBackConfirm(false); onClose(); }}>{t("editor.discard")}</Button>
            </div>
          </div>
        </div>
      )}

      {showSkillGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { if (!generatingSkill) { setShowSkillGenerate(false); setSkillDescription(""); } }}>
          <div className="bg-card border border-border rounded-lg p-6 max-w-md w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">{t("editor.generateSkillTitle")}</h3>
            <p className="text-sm text-muted-foreground mb-3">
              {t("editor.generateSkillHint")}
            </p>
            <textarea
              value={skillDescription}
              onChange={(e) => setSkillDescription(e.target.value)}
              placeholder={t("editor.generateSkillPlaceholder")}
              className="flex w-full rounded-lg border border-input bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring min-h-[80px] resize-y mb-4"
              rows={3}
              disabled={generatingSkill}
            />
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => { setShowSkillGenerate(false); setSkillDescription(""); }} disabled={generatingSkill}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={generateSkill} disabled={generatingSkill}>
                {generatingSkill ? t("editor.generating") : t("editor.generate")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmRemoveIdx !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmRemoveIdx(null)}>
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">{t("editor.removePhase")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("editor.removePhaseConfirm", { name: phases[confirmRemoveIdx]?.label || phases[confirmRemoveIdx]?.id || t("editor.unnamed") })}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setConfirmRemoveIdx(null)}>{t("common.cancel")}</Button>
              <Button variant="destructive" size="sm" onClick={() => { removePhase(confirmRemoveIdx); setConfirmRemoveIdx(null); }}>{t("common.remove")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
