import { join } from "path";
import { readFileSync } from "fs";
import { readConfigSync, WORKFLOW_DIR, getWorkfoldersFile } from "./config.mjs";
import { readManagedSkillContentSync } from "./skills.mjs";

let WORKFLOW = null;
let PHASE_ORDER = [];
let PHASE_SKILLS = {};
let REJECT_TARGETS = {};
let PHASE_ARTIFACT_FILES = {};
let PHASE_META = {};
let ACTIVE_WORKFLOW_FILE = "default.json";

function normalizeWorktreeConfig(worktree) {
  const files = Array.isArray(worktree?.files)
    ? worktree.files.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const customFiles = Array.isArray(worktree?.customFiles)
    ? worktree.customFiles.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  return {
    enabled: Boolean(worktree?.enabled),
    files,
    customFiles,
    removeOnComplete: worktree?.removeOnComplete !== undefined ? Boolean(worktree.removeOnComplete) : false,
  };
}

export function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function getPrimaryOutput(phase) {
  if (!Array.isArray(phase?.outputs) || phase.outputs.length === 0) return null;
  return phase.outputs[0];
}

function createArtifactLocator(output) {
  if (!output?.filename) return null;
  return (taskId, vars = {}) => interpolate(output.filename, { taskId, ...vars });
}

function getPhaseOutputLocator(phase, outputKey) {
  const output = (phase?.outputs || []).find((item) => item.key === outputKey);
  return createArtifactLocator(output || getPrimaryOutput(phase));
}

function getContextValue(contextValues, key) {
  return contextValues && Object.prototype.hasOwnProperty.call(contextValues, key) ? contextValues[key] : "";
}

function resolveTaskRunIdSync(baseDir, taskId) {
  if (!baseDir || !taskId) return "";
  try {
    const folders = JSON.parse(readFileSync(getWorkfoldersFile(baseDir), "utf-8"));
    for (const folder of folders || []) {
      for (const task of folder.tasks || []) {
        if (task.taskId === taskId && task.runId) {
          return task.runId;
        }
      }
    }
  } catch {}
  return "";
}

export function deriveContextFields(workflow = WORKFLOW) {
  const contextFields = [];
  const seen = new Set();
  for (const phase of workflow?.phases || []) {
    for (const input of phase.inputs || []) {
      if (input?.sourceType !== "workflow_context" || !input.name || seen.has(input.name)) continue;
      seen.add(input.name);
      contextFields.push({
        key: input.name,
        label: input.contextLabel || input.name,
        placeholder: input.contextPlaceholder || "",
        required: input.required !== false,
      });
    }
  }
  return contextFields;
}

function resolveInputValue(raw, phase, input, tid, baseDir, contextValues, runId = "") {
  if (!input?.name) return "";
  if (input.sourceType === "workflow_context") {
    return getContextValue(contextValues, input.name);
  }

  if (input.sourceType === "phase_output") {
    const sourcePhase = raw.phases.find((item) => item.id === input.phaseId);
    const locator = getPhaseOutputLocator(sourcePhase, input.outputKey);
    if (!locator) return "";
    const taskRunId = runId || resolveTaskRunIdSync(baseDir, tid);
    const artifactPath = join(baseDir, taskRunId || tid, locator(tid, { ...contextValues, runId: taskRunId }));
    try {
      return readFileSync(artifactPath, "utf-8");
    } catch {
      return "";
    }
  }

  return "";
}

export function loadWorkflow(path) {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  raw.worktree = normalizeWorktreeConfig(raw.worktree);
  WORKFLOW = raw;
  PHASE_ORDER = raw.phases.map((p) => p.id);
  PHASE_SKILLS = {};
  REJECT_TARGETS = {};
  PHASE_ARTIFACT_FILES = {};
  PHASE_META = {};

  for (const p of raw.phases) {
    PHASE_META[p.id] = {
      type: p.type,
      label: p.label,
      group: p.group,
      groupLabel: p.groupLabel || null,
      aiBackend: p.aiBackend || "claude",
    };
    if (p.prompt || p.skill || p.skillRefs?.length) {
      PHASE_SKILLS[p.id] = (taskId, baseDir, contextValues) => {
        const runId = resolveTaskRunIdSync(baseDir, taskId);
        const vars = { taskId, baseDir, taskDir: join(baseDir, runId || taskId), runId };
        for (const input of p.inputs || []) {
          if (!input?.name) continue;
          vars[input.name] = resolveInputValue(raw, p, input, taskId, baseDir, contextValues, vars.runId);
        }
        const parts = [];
        for (const ref of p.skillRefs || []) {
          const managedSkill = readManagedSkillContentSync(ref);
          if (managedSkill) parts.push(interpolate(managedSkill, vars));
        }
        if (p.skill) parts.push(interpolate(p.skill, vars));
        if (p.prompt) parts.push(interpolate(p.prompt, vars));
        return parts.join("\n\n");
      };
    }
    if (p.checkpoint?.rejectTargets) {
      REJECT_TARGETS[p.id] = p.checkpoint.rejectTargets;
    }
    const primaryOutput = getPrimaryOutput(p);
    const locator = createArtifactLocator(primaryOutput);
    if (locator) {
      PHASE_ARTIFACT_FILES[p.id] = locator;
    }
  }
}

export function getWorkflow() { return WORKFLOW; }
export function getPhaseOrder() { return PHASE_ORDER; }
export function getPhaseSkills() { return PHASE_SKILLS; }
export function getRejectTargets() { return REJECT_TARGETS; }
export function getPhaseArtifactFiles() { return PHASE_ARTIFACT_FILES; }
export function getPhaseMeta() { return PHASE_META; }
export function getPhaseBackend(phaseId) { return PHASE_META[phaseId]?.aiBackend || "claude"; }
export function getActiveWorkflowFile() { return ACTIVE_WORKFLOW_FILE; }
export function setActiveWorkflowFile(f) { ACTIVE_WORKFLOW_FILE = f; }

export function isAutoPhase(phaseId) {
  const meta = PHASE_META[phaseId];
  return meta ? meta.type === "auto" : false;
}

export function nextPhase(currentPhaseId) {
  const idx = PHASE_ORDER.indexOf(currentPhaseId);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1];
}

// Startup: load active workflow
try {
  const startupConfig = readConfigSync();
  if (startupConfig.activeWorkflow) ACTIVE_WORKFLOW_FILE = startupConfig.activeWorkflow;
} catch {}

try {
  loadWorkflow(join(WORKFLOW_DIR, ACTIVE_WORKFLOW_FILE));
} catch (err) {
  console.error(`ERROR: Could not load workflow config from workflows/${ACTIVE_WORKFLOW_FILE}: ${err.message}`);
  process.exit(1);
}
