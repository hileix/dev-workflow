import { join } from "path";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "fs";
import { readConfigSync, LEGACY_WORKFLOW_DIR, getWorkflowDir } from "./config";
import { validateWorkflowDsl } from "../core-lib/langgraph-runtime/index";

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

export function assertSafeWorkflowFilename(filename) {
  const value = String(filename || "").trim();
  if (
    !value.endsWith(".json") ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value === ".json" ||
    value.includes("..")
  ) {
    throw new Error("invalid workflow filename");
  }
  return value;
}

export function readWorkflowFileSync(filename) {
  const safeFilename = assertSafeWorkflowFilename(filename);
  const raw = JSON.parse(readFileSync(join(getWorkflowDir(), safeFilename), "utf-8"));
  return validateWorkflowDsl(raw);
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

function getStepBackend(workflow, step) {
  if (step.type !== "agent" && step.type !== "condition") return "";
  if (step.backend === "ai_api") return step.aiApiProfileId ? `ai-api:${step.aiApiProfileId}` : "ai-api";
  return step.backend || workflow?.runtime?.backend || "";
}

export function getWorkflowStepOrder(workflow = WORKFLOW) {
  return (workflow?.steps || []).map((step) => step.id);
}

export function getWorkflowRejectTargets(workflow = WORKFLOW) {
  const rejectTargets = {};
  for (const step of workflow?.steps || []) {
    if (step.type === "checkpoint") rejectTargets[step.id] = step.rejectTargets || [step.rejectTo].filter(Boolean);
  }
  return rejectTargets;
}

export function getWorkflowStepType(workflow = WORKFLOW, stepId) {
  return workflow?.steps?.find((step) => step.id === stepId)?.type || "";
}

export function isWorkflowAutoStep(workflow = WORKFLOW, stepId) {
  const type = getWorkflowStepType(workflow, stepId);
  return type === "agent" || type === "condition";
}

export function getWorkflowGraphShape(workflow = WORKFLOW) {
  const nodes = [];
  const edges = [];
  const stepIds = new Set(getWorkflowStepOrder(workflow));

  for (const step of workflow?.steps || []) {
    nodes.push({
      id: step.id,
      label: step.label || step.id,
      type: step.type,
      backend: getStepBackend(workflow, step),
      position: workflow?.ui?.nodePositions?.[step.id] || null,
    });

    if (step.type === "condition") {
      if (step.passTo && stepIds.has(step.passTo)) {
        edges.push({ id: `${step.id}:pass:${step.passTo}`, source: step.id, target: step.passTo, routeKind: "pass", sourceHandle: "pass", label: "pass" });
      }
      if (step.failTo && stepIds.has(step.failTo)) {
        edges.push({ id: `${step.id}:fail:${step.failTo}`, source: step.id, target: step.failTo, routeKind: "fail", sourceHandle: "fail", label: "fail" });
      }
      continue;
    }

    if (step.type === "checkpoint") {
      if (step.approve && stepIds.has(step.approve)) {
        edges.push({ id: `${step.id}:approve:${step.approve}`, source: step.id, target: step.approve, routeKind: "approve", sourceHandle: "approve", label: "approve" });
      }
      for (const target of step.rejectTargets || [step.rejectTo].filter(Boolean)) {
        if (stepIds.has(target)) {
          edges.push({ id: `${step.id}:reject:${target}`, source: step.id, target, routeKind: "reject", sourceHandle: "reject", label: "reject" });
        }
      }
      continue;
    }

    if (step.next && stepIds.has(step.next)) {
      edges.push({ id: `${step.id}:next:${step.next}`, source: step.id, target: step.next, routeKind: "next", sourceHandle: "next", label: "" });
    }
  }

  return {
    entry: workflow?.steps?.[0]?.id || "",
    nodes,
    edges,
  };
}

export function interpolate(template, vars) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export function deriveTaskInputFields(workflow = WORKFLOW) {
  const taskInputFields = [];
  const seen = new Set();
  for (const step of workflow?.steps || []) {
    for (const input of step.inputs || []) {
      if (input?.sourceType !== "task_input" || !input.name || seen.has(input.name)) continue;
      seen.add(input.name);
      taskInputFields.push({
        key: input.name,
        label: input.inputLabel || input.name,
        placeholder: input.inputPlaceholder || "",
        required: input.required !== false,
      });
    }
  }
  return taskInputFields;
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
      taskInputFields: [],
      worktree: { enabled: false, files: [], customFiles: [], removeOnComplete: false, namingProvider: "ai_api", namingAiApiProfileId: "", useCustomSetupScript: false, setupScript: "" },
    };
  }

  const phaseOrder = getWorkflowStepOrder(workflow);
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
    const groupKey = step.id;
    const groupLabel = step.label || step.id;
    phaseLabels[step.id] = step.label || step.id;
    phaseTypes[step.id] = step.type === "checkpoint" ? "checkpoint" : step.type === "condition" ? "condition" : "auto";
    phaseInputs[step.id] = (step.inputs || []).map((input) => ({
      name: input.name,
      sourceType: input.sourceType === "step_output" ? "phase_output" : "task_input",
      phaseId: input.stepId,
      outputKey: input.outputKey,
      inputLabel: input.inputLabel,
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
    graph: getWorkflowGraphShape(workflow),
    groups,
    phaseLabels,
    phaseTypes,
    phaseInputs,
    phaseOutputs,
    phaseBackends,
    rejectTargets,
    conditionRoutes,
    taskInputFields: deriveTaskInputFields(workflow),
    worktree: workflow.worktree || { enabled: false, files: [], customFiles: [], removeOnComplete: false, namingProvider: "ai_api", namingAiApiProfileId: "", useCustomSetupScript: false, setupScript: "" },
  };
}

export function loadWorkflow(path) {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const workflow = validateWorkflowDsl(raw);
  WORKFLOW = workflow;
  STEP_ORDER = getWorkflowStepOrder(workflow);
  REJECT_TARGETS = getWorkflowRejectTargets(workflow);
  STEP_META = {};

  for (const step of workflow.steps) {
    STEP_META[step.id] = {
      type: step.type === "checkpoint" ? "checkpoint" : step.type === "condition" ? "condition" : "auto",
      label: step.label || step.id,
      group: step.id,
      groupLabel: null,
      aiBackend: getStepBackend(workflow, step),
    };
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
  return isWorkflowAutoStep(WORKFLOW, stepId);
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
