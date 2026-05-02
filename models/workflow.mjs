import { join } from "path";
import { readFileSync } from "fs";
import { CONFIG_FILE, WORKFLOW_DIR } from "./config.mjs";

let WORKFLOW = null;
let PHASE_ORDER = [];
let PHASE_SKILLS = {};
let REJECT_TARGETS = {};
let PHASE_ARTIFACT_FILES = {};
let PHASE_META = {};
let ACTIVE_WORKFLOW_FILE = "default.json";

export function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export function loadWorkflow(path) {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  WORKFLOW = raw;
  PHASE_ORDER = raw.phases.map((p) => p.id);
  PHASE_SKILLS = {};
  REJECT_TARGETS = {};
  PHASE_ARTIFACT_FILES = {};
  PHASE_META = {};

  for (const p of raw.phases) {
    PHASE_META[p.id] = { type: p.type, label: p.label, group: p.group, groupLabel: p.groupLabel || null };
    if (p.prompt || p.skill) {
      PHASE_SKILLS[p.id] = (tid, baseDir, promptValues) => {
        const vars = { ticketId: tid, baseDir, taskDir: join(baseDir, tid), ...promptValues };
        const parts = [];
        if (p.skill) parts.push(interpolate(p.skill, vars));
        if (p.prompt) parts.push(interpolate(p.prompt, vars));
        return parts.join("\n\n");
      };
    }
    if (p.rejectTargets) {
      REJECT_TARGETS[p.id] = p.rejectTargets;
    }
    if (p.artifact) {
      PHASE_ARTIFACT_FILES[p.id] = (tid) => interpolate(p.artifact, { ticketId: tid });
    }
  }
}

export function getWorkflow() { return WORKFLOW; }
export function getPhaseOrder() { return PHASE_ORDER; }
export function getPhaseSkills() { return PHASE_SKILLS; }
export function getRejectTargets() { return REJECT_TARGETS; }
export function getPhaseArtifactFiles() { return PHASE_ARTIFACT_FILES; }
export function getPhaseMeta() { return PHASE_META; }
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
  const startupConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  if (startupConfig.activeWorkflow) ACTIVE_WORKFLOW_FILE = startupConfig.activeWorkflow;
} catch {}

try {
  loadWorkflow(join(WORKFLOW_DIR, ACTIVE_WORKFLOW_FILE));
} catch (err) {
  console.error(`ERROR: Could not load workflow config from workflows/${ACTIVE_WORKFLOW_FILE}: ${err.message}`);
  process.exit(1);
}
