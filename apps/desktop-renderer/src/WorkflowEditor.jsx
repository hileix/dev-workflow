import { useState, useEffect } from "react";
import { PanelRightClose, PanelRightOpen, Trash2 } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import WorkflowFlowchart from "./components/WorkflowFlowchart";
import { cn } from "./lib/utils";
import { getAppApi } from "./lib/api-client";
import { useConfigStore } from "./stores/configStore";

const desktopApi = getAppApi();

function generateId(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const EMPTY_PHASE = {
  id: "",
  type: "auto",
  aiBackend: "claude",
  label: "",
  group: "",
  groupLabel: "",
  artifact: "",
  skill: "",
  skillRefs: [],
  prompt: "",
  rejectTargets: [],
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

export default function WorkflowEditor({ filename, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [prompts, setPrompts] = useState([]);
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
  const [flowchartCollapsed, setFlowchartCollapsed] = useState(false);
  const isNew = !filename;
  const skills = useConfigStore((s) => s.skills);
  const loadSkills = useConfigStore((s) => s.loadSkills);

  useEffect(() => {
    loadSkills();
    if (!filename) {
      setName("");
      setPrompts([]);
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
        setPrompts(wf.prompts || []);
        setPhases((wf.phases || []).map((phase) => ({ aiBackend: "claude", skillRefs: [], ...phase })));
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
      .catch(() => setError("Failed to load workflow"));
  }, [filename]);

  function updatePhase(idx, field, value) {
    setPhases((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
    setDirty(true);
  }

  function addPhase() {
    const newPhase = { ...EMPTY_PHASE, id: `phase_new_${phases.length + 1}`, label: "New Phase" };
    setPhases((prev) => [...prev, newPhase]);
    setSelectedIdx(phases.length);
    setDirty(true);
  }

  function removePhase(idx) {
    setPhases((prev) => prev.filter((_, i) => i !== idx));
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
      return copy;
    });
    setSelectedIdx(newIdx);
    setDirty(true);
  }

  function toggleRejectTarget(target) {
    if (selectedIdx === null) return;
    const phase = phases[selectedIdx];
    const current = phase.rejectTargets || [];
    const updated = current.includes(target)
      ? current.filter((t) => t !== target)
      : [...current, target];
    updatePhase(selectedIdx, "rejectTargets", updated);
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
    if (!name.trim()) { setError("Workflow name is required"); return; }
    if (phases.length === 0) { setError("At least one phase is required"); return; }
    for (const p of phases) {
      if (!p.id || !p.label || !p.type || !p.group) {
        setError(`Phase "${p.label || p.id || "(unnamed)"}" is missing required fields (id, label, type, group)`);
        return;
      }
    }
    setError(null);
    setSaving(true);

    const worktreeFiles = Array.from(new Set([...selectedWorktreeFiles, ...customWorktreeFiles]));

    const workflow = {
      name: name.trim(),
      prompts,
      phases,
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
      setError(err.message || "Failed to save workflow");
    } finally {
      setSaving(false);
    }
  }

  const selected = selectedIdx !== null ? phases[selectedIdx] : null;
  const autoPhaseIds = phases.filter((p) => p.type === "auto").map((p) => p.id);
  const displayedWorktreeFiles = [...COMMON_WORKTREE_FILES, ...customWorktreeFiles];

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card">
        <Button variant="ghost" size="sm" onClick={() => dirty ? setShowBackConfirm(true) : onClose()}>
          &larr; Back
        </Button>
        <Input
          value={name}
          onChange={(e) => { setName(e.target.value); setDirty(true); }}
          placeholder="Workflow name"
          className="max-w-xs"
        />
        <div className="flex-1" />
        {error && <span className="text-destructive text-xs">{error}</span>}
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Phase list (left) */}
        <div className="w-96 shrink-0 border-r border-border bg-sidebar overflow-y-auto py-4">
          <div className="px-4 pb-4 border-b border-border mb-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold text-muted-foreground">Prompts ({prompts.length})</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPrompts((prev) => [...prev, { key: "", label: "", placeholder: "" }]);
                  setDirty(true);
                }}
              >
                + Add
              </Button>
            </div>
            {prompts.length === 0 && (
              <span className="text-[10px] text-muted-foreground">Define inputs the user fills in when starting a new task, e.g. task description.</span>
            )}
            {prompts.map((p, i) => (
              <div key={i} className="mt-2 p-2 border border-border rounded-lg space-y-1.5 bg-card">
                <div className="flex gap-1.5">
                  <Input
                    value={p.key}
                    onChange={(e) => {
                      setPrompts((prev) => prev.map((item, idx) => idx === i ? { ...item, key: e.target.value } : item));
                      setDirty(true);
                    }}
                    placeholder="key"
                    className="text-xs h-7"
                  />
                  <button
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded shrink-0"
                    onClick={() => {
                      setPrompts((prev) => prev.filter((_, idx) => idx !== i));
                      setDirty(true);
                    }}
                    aria-label="Remove prompt"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Input
                  value={p.label}
                  onChange={(e) => {
                    setPrompts((prev) => prev.map((item, idx) => idx === i ? { ...item, label: e.target.value } : item));
                    setDirty(true);
                  }}
                  placeholder="Label"
                  className="text-xs h-7"
                />
                <Input
                  value={p.placeholder}
                  onChange={(e) => {
                    setPrompts((prev) => prev.map((item, idx) => idx === i ? { ...item, placeholder: e.target.value } : item));
                    setDirty(true);
                  }}
                  placeholder="Placeholder text"
                  className="text-xs h-7"
                />
              </div>
            ))}
          </div>
          <div className="px-4 pb-4 border-b border-border mb-3">
            <div className="flex items-center justify-between mb-2 gap-3">
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground">Git Worktree</h2>
                <span className="text-[10px] text-muted-foreground">Create a sibling worktree before the workflow starts.</span>
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
                <label className="text-[10px] text-muted-foreground block mb-1.5">Extra files or folders</label>
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
                    placeholder="e.g. .env.test.local or apps/web/.env.local"
                    className="h-10 font-mono text-xs"
                  />
                  <Button type="button" variant="outline" className="h-10 px-4" onClick={addCustomWorktreeFile}>
                    Add
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
                Remove the worktree automatically when the task is completed
              </label>
            )}
            {worktreeEnabled && (
              <span className="text-[10px] text-muted-foreground mt-1 block">
                Common files can be toggled above. Add any extra relative paths below, one per line.
              </span>
            )}
          </div>
          <div className="flex items-center justify-between px-4 pb-3">
            <h2 className="text-xs font-semibold text-muted-foreground">
              Phases ({phases.length})
            </h2>
            <Button variant="outline" size="sm" onClick={addPhase}>+ Add</Button>
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
                  <span className="truncate">{p.label || p.id || "(unnamed)"}</span>
                  <span className="text-xs text-muted-foreground truncate">{p.id}</span>
                </div>
                <Badge variant={p.type === "auto" ? "info" : "warning"} className="shrink-0 text-[10px]">
                  {p.type}
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
              No phases. Click "+ Add" to create one.
            </div>
          )}
        </div>

        {/* Phase edit form (middle) */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {selected ? (
            <div className="max-w-2xl space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Label *</label>
                  <Input
                    value={selected.label}
                    onChange={(e) => {
                      updatePhase(selectedIdx, "label", e.target.value);
                      if (!dirty || selected.id === generateId(selected.label) || !selected.id) {
                        updatePhase(selectedIdx, "id", (selected.type === "checkpoint" ? "checkpoint_" : "phase_") + generateId(e.target.value));
                      }
                    }}
                    placeholder="e.g., Read Ticket"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">ID *</label>
                  <Input
                    value={selected.id}
                    onChange={(e) => updatePhase(selectedIdx, "id", e.target.value)}
                    placeholder="e.g., phase_read_ticket"
                  />
                </div>
              </div>

              {selected.type === "auto" && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">AI Backend *</label>
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
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">This step will use the selected AI runtime when it runs.</span>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Type *</label>
                <div className="flex gap-3">
                  {["auto", "checkpoint"].map((t) => (
                    <button
                      key={t}
                      className={cn(
                        "px-4 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer",
                        selected.type === t
                          ? "border-ring bg-secondary text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent"
                      )}
                      onClick={() => updatePhase(selectedIdx, "type", t)}
                    >
                      {t === "auto" ? "Auto (AI runs)" : "Checkpoint (User reviews)"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Group Key *</label>
                  <Input
                    value={selected.group}
                    onChange={(e) => updatePhase(selectedIdx, "group", e.target.value)}
                    placeholder="e.g., plan"
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">Phases with the same group are shown together in the sidebar</span>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Group Label</label>
                  <Input
                    value={selected.groupLabel || ""}
                    onChange={(e) => updatePhase(selectedIdx, "groupLabel", e.target.value || undefined)}
                    placeholder="e.g., Plan"
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">Display name for the group (only needed on first phase of group)</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Artifact Filename</label>
                <Input
                  value={selected.artifact || ""}
                  onChange={(e) => updatePhase(selectedIdx, "artifact", e.target.value)}
                  placeholder="e.g., plan.md or {{ticketId}}.md"
                />
                <span className="text-[10px] text-muted-foreground mt-0.5 block">
                  {"Variables: {{ticketId}}, or any prompt key. Each phase can save an artifact document; later phases can read earlier artifacts for additional context."}
                </span>
              </div>

              {selected.type === "auto" && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Skill</label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSkillGenerate(true)}
                      disabled={generatingSkill}
                    >
                      {generatingSkill ? "Generating..." : "Generate with AI"}
                    </Button>
                  </div>
                  <div className="mb-2 rounded-lg border border-border bg-secondary/30 p-2">
                    {skills.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        No managed skills yet. Add skills in Settings.
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
                    placeholder="Skill instructions for this phase (can be generated by AI)"
                    className="flex w-full rounded-lg border border-input bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring min-h-[80px] resize-y font-mono"
                    rows={3}
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">
                    AI-generated or manual skill instructions prepended to the prompt when this phase runs.
                  </span>
                </div>
              )}

              {selected.type === "auto" && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Prompt</label>
                  <textarea
                    value={selected.prompt || ""}
                    onChange={(e) => updatePhase(selectedIdx, "prompt", e.target.value)}
                    placeholder="e.g., /read-ticket {{ticketId}}\n\nSave output to {{taskDir}}/ticket.md"
                    className="flex w-full rounded-lg border border-input bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring min-h-[120px] resize-y font-mono"
                    rows={5}
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">
                    {"Variables: {{ticketId}} (or any prompt key), {{baseDir}}, {{taskDir}}. Prefer plain instructions so the workflow can run on either Claude or Codex."}
                  </span>
                </div>
              )}

              {selected.type === "checkpoint" && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Reject Targets</label>
                  <div className="flex flex-wrap gap-2">
                    {autoPhaseIds.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No auto phases defined yet</span>
                    ) : (
                      autoPhaseIds.map((pid) => {
                        const isSelected = (selected.rejectTargets || []).includes(pid);
                        return (
                          <button
                            key={pid}
                            className={cn(
                              "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer",
                              isSelected
                                ? "border-ring bg-secondary text-foreground"
                                : "border-border text-muted-foreground hover:bg-accent"
                            )}
                            onClick={() => toggleRejectTarget(pid)}
                          >
                            {phases.find((p) => p.id === pid)?.label || pid}
                          </button>
                        );
                      })
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">
                    Which phases the user can reject back to from this checkpoint
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {phases.length === 0 ? 'Click "+ Add" to create your first phase' : "Select a phase to edit"}
            </div>
          )}
        </div>

        {/* Workflow preview (right) */}
        <div
          className={cn(
            "shrink-0 border-l border-border bg-secondary/30 transition-all duration-200",
            flowchartCollapsed ? "w-14" : "w-[34rem]"
          )}
        >
          <div className="flex h-full flex-col min-h-0">
            <div
              className={cn(
                "flex items-center gap-2 border-b border-border px-4 py-3",
                flowchartCollapsed && "justify-center px-2"
              )}
            >
              {!flowchartCollapsed && (
                <div className="min-w-0 flex-1">
                  <h2 className="text-xs font-semibold text-muted-foreground">Workflow Preview</h2>
                  <span className="text-[10px] text-muted-foreground">Preview generated from the phase order and reject targets.</span>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 px-0"
                onClick={() => setFlowchartCollapsed((prev) => !prev)}
                aria-label={flowchartCollapsed ? "Expand workflow preview" : "Collapse workflow preview"}
                title={flowchartCollapsed ? "Expand workflow preview" : "Collapse workflow preview"}
              >
                {flowchartCollapsed ? (
                  <PanelRightOpen className="h-4 w-4" />
                ) : (
                  <PanelRightClose className="h-4 w-4" />
                )}
              </Button>
            </div>
            {!flowchartCollapsed && (
              <div className="min-h-0 flex-1 p-4">
                <WorkflowFlowchart
                  phases={phases}
                  selectedIdx={selectedIdx}
                  onSelectPhase={setSelectedIdx}
                />
              </div>
            )}
            {flowchartCollapsed && (
              <div className="flex flex-1 items-start justify-center pt-4">
                <span className="vertical-rl text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Workflow
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {showBackConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowBackConfirm(false)}>
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">Unsaved Changes</h3>
            <p className="text-sm text-muted-foreground mb-4">
              You have unsaved changes. Are you sure you want to leave?
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowBackConfirm(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={() => { setShowBackConfirm(false); onClose(); }}>Discard</Button>
            </div>
          </div>
        </div>
      )}

      {showSkillGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { if (!generatingSkill) { setShowSkillGenerate(false); setSkillDescription(""); } }}>
          <div className="bg-card border border-border rounded-lg p-6 max-w-md w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">Generate Skill with AI</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Describe what this skill should do (optional). The AI will also use the phase label and prompt as context.
            </p>
            <textarea
              value={skillDescription}
              onChange={(e) => setSkillDescription(e.target.value)}
              placeholder="e.g., Review the PR for security issues and code quality..."
              className="flex w-full rounded-lg border border-input bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring min-h-[80px] resize-y mb-4"
              rows={3}
              disabled={generatingSkill}
            />
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => { setShowSkillGenerate(false); setSkillDescription(""); }} disabled={generatingSkill}>Cancel</Button>
              <Button size="sm" onClick={generateSkill} disabled={generatingSkill}>
                {generatingSkill ? "Generating..." : "Generate"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmRemoveIdx !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmRemoveIdx(null)}>
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">Remove Phase</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to remove <strong>{phases[confirmRemoveIdx]?.label || phases[confirmRemoveIdx]?.id || "this phase"}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setConfirmRemoveIdx(null)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={() => { removePhase(confirmRemoveIdx); setConfirmRemoveIdx(null); }}>Remove</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
