import { join } from "path";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "fs";
import { readConfigSync, LEGACY_WORKFLOW_DIR, getWorkflowDir } from "./config.mjs";
import { validateWorkflowDsl } from "../core-lib/langgraph-runtime/index.mjs";

let WORKFLOW = null;
let STEP_ORDER = [];
let REJECT_TARGETS = {};
let STEP_META = {};
let ACTIVE_WORKFLOW_FILE = "";

function clearWorkflowState() {
  WORKFLOW = null;
  STEP_ORDER = [];
  REJECT_TARGETS = {};
  STEP_META = {};
}

function listWorkflowFilesSync(dir) {
  try {
    return readdirSync(dir).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

function migrateLegacyWorkflowsSync() {
  const workflowDir = getWorkflowDir();
  mkdirSync(workflowDir, { recursive: true });

  const legacyFiles = listWorkflowFilesSync(LEGACY_WORKFLOW_DIR);
  for (const file of legacyFiles) {
    const sourcePath = join(LEGACY_WORKFLOW_DIR, file);
    const targetPath = join(workflowDir, file);
    if (existsSync(targetPath)) continue;
    try {
      renameSync(sourcePath, targetPath);
    } catch {}
  }
}

function getStepAgent(workflow, step) {
  if (step.type !== "agent" && step.type !== "condition") return "";
  if (step.agent) return step.agent;
  if (step.contextGroup) {
    return workflow.contextGroups.find((group) => group.id === step.contextGroup)?.agent || "";
  }
  return "";
}

function getStepBackend(workflow, step) {
  const agentId = getStepAgent(workflow, step);
  return workflow.agents?.[agentId]?.backend || "";
}

export function interpolate(template, vars) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export function deriveContextFields(workflow = WORKFLOW) {
  const contextFields = [];
  const seen = new Set();
  for (const step of workflow?.steps || []) {
    for (const input of step.inputs || []) {
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

export function getWorkflowConfigShape(workflow = WORKFLOW) {
  if (!workflow) {
    return {
      name: "",
      activeWorkflow: getActiveWorkflowFile(),
      phaseOrder: [],
      groups: [],
      phaseLabels: {},
      phaseTypes: {},
      phaseInputs: {},
      phaseOutputs: {},
      phaseBackends: {},
      rejectTargets: {},
      conditionRoutes: {},
      contextFields: [],
      worktree: { enabled: false, files: [], customFiles: [], removeOnComplete: false },
    };
  }

  const phaseOrder = workflow.steps.map((step) => step.id);
  const groups = [];
  const seenGroups = new Set();
  const phaseLabels = {};
  const phaseTypes = {};
  const phaseInputs = {};
  const phaseOutputs = {};
  const phaseBackends = {};
  const rejectTargets = {};
  const conditionRoutes = {};

  for (const step of workflow.steps) {
    const groupKey = step.contextGroup || step.id;
    const groupLabel = workflow.contextGroups.find((group) => group.id === step.contextGroup)?.label || step.label || step.id;
    phaseLabels[step.id] = step.label || step.id;
    phaseTypes[step.id] = step.type === "checkpoint" ? "checkpoint" : step.type === "condition" ? "condition" : "auto";
    phaseInputs[step.id] = (step.inputs || []).map((input) => ({
      name: input.name,
      sourceType: input.sourceType === "step_output" ? "phase_output" : "workflow_context",
      phaseId: input.stepId,
      outputKey: input.outputKey,
      contextLabel: input.contextLabel,
      required: input.required,
    }));
    phaseOutputs[step.id] = (step.outputs || []).map((output) => ({
      key: output.key,
      kind: output.kind,
      filename: output.filename,
    }));
    phaseBackends[step.id] = getStepBackend(workflow, step);
    if (step.type === "checkpoint") rejectTargets[step.id] = step.rejectTargets || [step.rejectTo].filter(Boolean);
    if (step.type === "condition") conditionRoutes[step.id] = { passTo: step.passTo || "", failTo: step.failTo || "" };
    if (!seenGroups.has(groupKey)) {
      seenGroups.add(groupKey);
      groups.push({ key: groupKey, label: groupLabel, phases: [] });
    }
    groups.find((group) => group.key === groupKey).phases.push(step.id);
  }

  return {
    name: workflow.name,
    activeWorkflow: getActiveWorkflowFile(),
    phaseOrder,
    groups,
    phaseLabels,
    phaseTypes,
    phaseInputs,
    phaseOutputs,
    phaseBackends,
    rejectTargets,
    conditionRoutes,
    contextFields: deriveContextFields(workflow),
    worktree: workflow.worktree || { enabled: false, files: [], customFiles: [], removeOnComplete: false },
  };
}

export function loadWorkflow(path) {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const workflow = validateWorkflowDsl(raw);
  WORKFLOW = workflow;
  STEP_ORDER = workflow.steps.map((step) => step.id);
  REJECT_TARGETS = {};
  STEP_META = {};

  for (const step of workflow.steps) {
    STEP_META[step.id] = {
      type: step.type === "checkpoint" ? "checkpoint" : step.type === "condition" ? "condition" : "auto",
      label: step.label || step.id,
      group: step.contextGroup || step.id,
      groupLabel: workflow.contextGroups.find((group) => group.id === step.contextGroup)?.label || null,
      aiBackend: getStepBackend(workflow, step),
    };
    if (step.type === "checkpoint") {
      REJECT_TARGETS[step.id] = step.rejectTargets || [step.rejectTo].filter(Boolean);
    }
  }
}

export function getWorkflow() { return WORKFLOW; }
export function getPhaseOrder() { return STEP_ORDER; }
export function getStepOrder() { return STEP_ORDER; }
export function getRejectTargets() { return REJECT_TARGETS; }
export function getPhaseMeta() { return STEP_META; }
export function getStepMeta() { return STEP_META; }
export function getPhaseBackend(stepId) { return STEP_META[stepId]?.aiBackend || "claude"; }
export function getActiveWorkflowFile() { return ACTIVE_WORKFLOW_FILE; }
export function setActiveWorkflowFile(f) { ACTIVE_WORKFLOW_FILE = f; }
export function unloadWorkflow() {
  ACTIVE_WORKFLOW_FILE = "";
  clearWorkflowState();
}

export function isAutoPhase(stepId) {
  const meta = STEP_META[stepId];
  return meta ? meta.type === "auto" || meta.type === "condition" : false;
}

export function nextPhase(currentStepId) {
  const idx = STEP_ORDER.indexOf(currentStepId);
  if (idx < 0 || idx >= STEP_ORDER.length - 1) return null;
  return STEP_ORDER[idx + 1];
}

try {
  const startupConfig = readConfigSync();
  if (startupConfig.activeWorkflow) ACTIVE_WORKFLOW_FILE = startupConfig.activeWorkflow;
} catch {}

try {
  migrateLegacyWorkflowsSync();
  const workflowDir = getWorkflowDir();
  const files = listWorkflowFilesSync(workflowDir);
  if (!files.includes(ACTIVE_WORKFLOW_FILE)) {
    ACTIVE_WORKFLOW_FILE = files[0] || "";
  }
  if (ACTIVE_WORKFLOW_FILE) {
    loadWorkflow(join(workflowDir, ACTIVE_WORKFLOW_FILE));
  } else {
    clearWorkflowState();
  }
} catch (err) {
  clearWorkflowState();
  console.error(`ERROR: Could not load workflow config from ${ACTIVE_WORKFLOW_FILE || "no active workflow"}: ${err.message}`);
}
