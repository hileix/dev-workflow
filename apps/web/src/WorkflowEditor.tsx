import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Braces, CircleHelp, GitBranch, Trash2, X } from "lucide-react";
import { BackButton } from "./components/back-button";
import { useI18n } from "./components/i18n-provider";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Select } from "./components/ui/select";
import { Badge } from "./components/ui/badge";
import { Tooltip } from "./components/ui/tooltip";
import { cn } from "./lib/utils";
import { getAppApi } from "./lib/api-client";
import { useConfigStore } from "./stores/configStore";
import { getWorkflowEditorKey, useWorkflowEditorStore } from "./stores/workflowEditorStore";
import { useWorkflowStore } from "./stores/workflowStore";

const appApi = getAppApi();

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

const MODEL_OPTIONS = {
  claude: [
    { value: "sonnet", label: "Sonnet", description: "Balanced Claude Code default." },
    { value: "opus", label: "Opus", description: "Higher-capability Claude model." },
    { value: "haiku", label: "Haiku", description: "Faster Claude model." },
    { value: "claude-sonnet-4-6", label: "claude-sonnet-4-6", description: "Full Claude Sonnet model ID." },
    { value: "claude-opus-4-7", label: "claude-opus-4-7", description: "Full Claude Opus model ID." },
  ],
  codex: [
    { value: "gpt-5.5", label: "gpt-5.5", badge: "current", description: "Frontier model for complex coding, research, and real-world work." },
    { value: "gpt-5.4", label: "gpt-5.4", description: "Strong model for everyday coding." },
    { value: "gpt-5.4-mini", label: "gpt-5.4-mini", description: "Small, fast, and cost-efficient model for simpler coding tasks." },
    { value: "gpt-5.3-codex", label: "gpt-5.3-codex", description: "Coding-optimized model." },
    { value: "gpt-5.2", label: "gpt-5.2", description: "Optimized for professional work and long-running runtime sessions." },
  ],
};

const CODEX_REASONING_OPTIONS = [
  { value: "low", label: "Low", description: "Fast responses with lighter reasoning." },
  { value: "medium", label: "Medium", badge: "default", description: "Balances speed and reasoning depth for everyday tasks." },
  { value: "high", label: "High", description: "Greater reasoning depth for complex problems." },
  { value: "xhigh", label: "Extra high", description: "Extra high reasoning depth for complex problems." },
];

const WORKFLOW_CANVAS_LAYOUT = "vertical";
const NODE_X = 120;
const NODE_Y_GAP = 230;
const NODE_WIDTH = 260;
const NODE_HEIGHT = 126;
const NODE_PANEL_FALLBACK_WIDTH = 320;
const NODE_PANEL_GAP = 16;
const CODEBASE_ACCESS_TOOLTIP = "Workflow runtime: use the workflow default access for this step.\nRead-only can read files and write task artifacts only. Can edit project files can modify the codebase.";

function WorkflowStepNode({ data }) {
  const badgeVariant = data.type === "checkpoint" ? "warning" : data.type === "condition" ? "success" : "info";
  return (
    <button
      type="button"
      className={cn(
        "w-[260px] rounded-lg border bg-card px-4 py-3 text-left shadow-sm transition-colors",
        data.selected ? "border-ring ring-2 ring-ring/25" : "border-border hover:border-ring/60"
      )}
      onClick={(event) => {
        event.stopPropagation();
        data.onSelect();
      }}
    >
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !border-2 !border-card !bg-muted-foreground" />
      <Handle id="return" type="target" position={Position.Right} isConnectable={false} className="!top-[50%] !h-3 !w-3 !border-0 !bg-transparent" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{data.label}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{data.id}</div>
        </div>
        <Badge variant={badgeVariant} className="shrink-0 text-[10px]">{data.type}</Badge>
      </div>
      <div className="mt-3 truncate text-[10px] text-muted-foreground">{data.summary}</div>
      <div className="mt-1 truncate text-[10px] text-muted-foreground">outputs: {data.outputs}</div>
      {data.type === "checkpoint" ? (
        <>
          <Handle id="approve" type="source" position={Position.Bottom} className="!left-1/2 !h-3 !w-3 !-translate-x-1/2 !border-2 !border-card !bg-success" />
          <Handle id="reject" type="source" position={Position.Right} className="!top-1/2 !h-3 !w-3 !-translate-y-1/2 !border-2 !border-card !bg-warning" />
          <div className="mt-3 flex gap-2 text-[10px] text-muted-foreground">
            <span className="rounded bg-success/10 px-2 py-1 text-success">approve</span>
            <span className="rounded bg-warning/10 px-2 py-1 text-warning">reject</span>
          </div>
        </>
      ) : (
        <>
          {data.type === "condition" ? (
            <>
              <Handle id="pass" type="source" position={Position.Bottom} className="!left-1/2 !h-3 !w-3 !-translate-x-1/2 !border-2 !border-card !bg-success" />
              <Handle id="fail" type="source" position={Position.Right} className="!top-1/2 !h-3 !w-3 !-translate-y-1/2 !border-2 !border-card !bg-warning" />
              <div className="mt-3 flex gap-2 text-[10px] text-muted-foreground">
                <span className="rounded bg-success/10 px-2 py-1 text-success">pass</span>
                <span className="rounded bg-warning/10 px-2 py-1 text-warning">fail</span>
              </div>
            </>
          ) : (
            <Handle id="next" type="source" position={Position.Bottom} className="!h-3 !w-3 !border-2 !border-card !bg-primary" />
          )}
        </>
      )}
    </button>
  );
}

const nodeTypes = {
  workflowStep: WorkflowStepNode,
};

function WorkflowRouteEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  label,
  labelStyle,
  labelBgPadding,
  labelBgBorderRadius,
  data,
}) {
  const isBackRoute = data?.sourceIndex >= data?.targetIndex;
  const isRejectRoute = data?.routeKind === "reject" || data?.routeKind === "fail";
  const isReturnRoute = isBackRoute || isRejectRoute;
  const routeSpan = Math.max(0, (data?.sourceIndex ?? 0) - (data?.targetIndex ?? 0));
  const sideGap = isRejectRoute ? 54 + routeSpan * 22 : 58;
  let path;
  let labelX;
  let labelY;

  if (isReturnRoute) {
    const laneX = Math.max(sourceX, targetX) + sideGap;
    path = `M ${sourceX},${sourceY} H ${laneX} V ${targetY} H ${targetX}`;
    labelX = laneX;
    labelY = sourceY + (targetY - sourceY) / 2;
  } else {
    const laneY = sourceY + (targetY - sourceY) / 2;
    path = `M ${sourceX},${sourceY} V ${laneY} H ${targetX} V ${targetY}`;
    labelX = sourceX + (targetX - sourceX) / 2;
    labelY = laneY;
  }

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={style}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelStyle={labelStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      interactionWidth={28}
    />
  );
}

const edgeTypes = {
  workflowRoute: WorkflowRouteEdge,
};

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

function slugify(value, fallback = "step") {
  const slug = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return slug || fallback;
}

function createDefaultWorkflow({ includeStartStep = true } = {}) {
  return {
    id: "dev_workflow",
    name: "",
    visible: true,
    version: 1,
    runtime: {
      engine: "langgraph",
      backend: "codex",
      model: "",
      workspaceAccess: "write",
      options: {},
    },
    ui: {
      layout: WORKFLOW_CANVAS_LAYOUT,
      nodePositions: {},
    },
    worktree: {
      enabled: false,
      files: [...COMMON_WORKTREE_FILES],
      customFiles: [],
      removeOnComplete: false,
      namingProvider: "ai_api",
      namingAiApiProfileId: "",
      useCustomSetupScript: false,
      setupScript: "",
    },
    steps: includeStartStep
      ? [{
          ...createAgentStep(1),
          id: "start",
          label: "Start",
          outputs: [
            {
              key: "result",
              kind: "markdown",
              filename: "start.md",
            },
          ],
        }]
      : [],
  };
}

function normalizeNodePosition(position) {
  const x = Number(position?.x);
  const y = Number(position?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function normalizeWorkflowUi(rawUi, steps) {
  const stepIds = new Set((steps || []).map((step) => step.id));
  const layout = WORKFLOW_CANVAS_LAYOUT;
  const nodePositions = {};

  if (rawUi?.layout === WORKFLOW_CANVAS_LAYOUT) {
    for (const [stepId, position] of Object.entries(rawUi?.nodePositions || {})) {
      if (!stepIds.has(stepId)) continue;
      const normalized = normalizeNodePosition(position);
      if (normalized) nodePositions[stepId] = normalized;
    }
  }

  return { layout, nodePositions };
}

function createAgentStep(index) {
  return {
    id: `step_${index}`,
    label: `Step ${index}`,
    type: "agent",
    instructions: "",
    backend: "",
    model: "",
    prompt: "",
    workspaceAccess: "",
    options: {},
    inputs: [],
    outputs: [
      {
        key: "result",
        kind: "markdown",
        filename: `step-${index}.md`,
      },
    ],
    next: "",
  };
}

function createCheckpointStep(index, previousStepId, nextStepId = "") {
  return {
    id: `checkpoint_${index}`,
    label: `Checkpoint ${index}`,
    type: "checkpoint",
    question: "Approve this step?",
    inputs: previousStepId
      ? [{
          name: "review",
          sourceType: "step_output",
          stepId: previousStepId,
          outputKey: "result",
          required: true,
        }]
      : [],
    outputs: [],
    approve: nextStepId,
    rejectTo: previousStepId,
    rejectTargets: previousStepId ? [previousStepId] : [],
    publish: [],
  };
}

function createConditionStep(index, previousStepId, nextStepId = "", failStepId = previousStepId) {
  return {
    id: `condition_${index}`,
    label: `Conditional Gate ${index}`,
    type: "condition",
    instructions: "",
    backend: "",
    model: "",
    prompt: "Read the input and decide whether the workflow should pass or fail. Return only JSON: {\"passed\": true, \"reason\": \"short reason\"}.",
    workspaceAccess: "read",
    options: {},
    inputs: previousStepId
      ? [{
          name: "review",
          sourceType: "step_output",
          stepId: previousStepId,
          outputKey: "result",
          required: true,
        }]
      : [],
    outputs: [
      {
        key: "decision",
        kind: "markdown",
        filename: `condition-${index}.md`,
      },
    ],
    passTo: nextStepId,
    failTo: failStepId,
  };
}

function normalizeWorkflow(raw) {
  const base = createDefaultWorkflow();
  const worktreeFiles = Array.isArray(raw?.worktree?.files) ? raw.worktree.files : base.worktree.files;
  const inferredCustomFiles = worktreeFiles.filter((file) => !COMMON_WORKTREE_FILES.includes(file));
  const customFiles = normalizeCustomWorktreeFiles([
    ...(Array.isArray(raw?.worktree?.customFiles) ? raw.worktree.customFiles : []),
    ...inferredCustomFiles,
  ]);
  const rawRuntime = raw?.runtime || {};
  const { skill: _removedRuntimeSkill, ...runtimeWithoutSkill } = rawRuntime;
  const workflow = {
    ...base,
    ...raw,
    runtime: {
      ...base.runtime,
      ...runtimeWithoutSkill,
      engine: "langgraph",
    },
    steps: Array.isArray(raw?.steps) ? raw.steps : [],
    ui: normalizeWorkflowUi(raw?.ui, raw?.steps || []),
    worktree: {
      ...base.worktree,
      ...(raw?.worktree || {}),
      files: Array.from(new Set(worktreeFiles)),
      customFiles,
      namingProvider: raw?.worktree?.namingProvider === "ai_backend" ? "ai_backend" : "ai_api",
      namingAiApiProfileId: raw?.worktree?.namingAiApiProfileId || "",
      useCustomSetupScript: raw?.worktree?.useCustomSetupScript === true,
    },
  };
  return relinkSteps(workflow);
}

function relinkSteps(workflow) {
  const stepIds = new Set(workflow.steps.map((step) => step.id).filter(Boolean));
  const stepsById = new Map(workflow.steps.map((step) => [step.id, step]));
  const getTarget = (targetId) => {
    if (!targetId) return "";
    return stepIds.has(targetId) ? targetId : "";
  };
  const getInputs = (step) => (step.inputs || []).map((input) => {
    if (input.stepId && !stepIds.has(input.stepId)) return { ...input, stepId: "", outputKey: "" };
    if (input.sourceType !== "step_output" || !input.stepId) return input;

    const outputKeys = getStepOutputKeys(stepsById.get(input.stepId));
    if (outputKeys.length === 0 || outputKeys.includes(input.outputKey)) return input;
    return { ...input, outputKey: outputKeys[0] };
  });
  const steps = workflow.steps.map((step, index) => {
    const cleanStep = { ...step, inputs: getInputs(step) };
    delete cleanStep.skill;
    delete cleanStep.skillRefs;
    if (step.type === "checkpoint") {
      const rejectTargets = Array.isArray(cleanStep.rejectTargets)
        ? cleanStep.rejectTargets.filter((target) => target && stepIds.has(target))
        : [];
      const rejectTo = getTarget(cleanStep.rejectTo || rejectTargets[0] || "");
      return {
        ...cleanStep,
        approve: getTarget(cleanStep.approve || ""),
        rejectTo,
        rejectTargets: rejectTargets.length > 0 ? rejectTargets : [rejectTo].filter(Boolean),
      };
    }
    if (step.type === "condition") {
      return {
        ...cleanStep,
        passTo: getTarget(cleanStep.passTo || ""),
        failTo: getTarget(cleanStep.failTo || ""),
      };
    }
    return {
      ...cleanStep,
      next: getTarget(cleanStep.next || ""),
    };
  });

  return { ...workflow, steps, ui: normalizeWorkflowUi(workflow.ui, steps) };
}

function replaceStepReference(value, currentId, nextId) {
  return value === currentId ? nextId : value;
}

function replaceStepReferences(step, currentId, nextId) {
  return {
    ...step,
    next: replaceStepReference(step.next, currentId, nextId),
    approve: replaceStepReference(step.approve, currentId, nextId),
    rejectTo: replaceStepReference(step.rejectTo, currentId, nextId),
    rejectTargets: (step.rejectTargets || []).map((target) => replaceStepReference(target, currentId, nextId)),
    passTo: replaceStepReference(step.passTo, currentId, nextId),
    failTo: replaceStepReference(step.failTo, currentId, nextId),
    inputs: (step.inputs || []).map((input) => ({
      ...input,
      stepId: replaceStepReference(input.stepId, currentId, nextId),
    })),
  };
}

function getStepSummary(step) {
  if (step.type === "checkpoint") {
    return `approve: ${step.approve || "end"} · reject: ${(step.rejectTargets || []).join(", ") || "none"}`;
  }
  if (step.type === "condition") {
    return `pass: ${step.passTo || "end"} · reject: ${step.failTo || "end"}`;
  }
  return `runtime: ${step.backend || "default"} · next: ${step.next || "end"}`;
}

function getStepOutputSummary(step) {
  const outputs = step.outputs || [];
  return outputs.length > 0 ? outputs.map((output) => output.key || output.filename).join(", ") : "none";
}

function getStepOutputKeys(step) {
  return (step?.outputs || []).map((output) => output.key || output.filename).filter(Boolean);
}

function getStepNodePosition(workflow, step, index) {
  return normalizeNodePosition(workflow.ui?.nodePositions?.[step.id]) || { x: NODE_X, y: 80 + index * NODE_Y_GAP };
}

function getWorkflowNodes(workflow, selectedIdx, onSelectStep) {
  return workflow.steps.map((step, index) => ({
    id: step.id,
    type: "workflowStep",
    position: getStepNodePosition(workflow, step, index),
    data: {
      id: step.id,
      type: step.type,
      label: step.label || step.id,
      summary: getStepSummary(step),
      outputs: getStepOutputSummary(step),
      selected: selectedIdx === index,
      onSelect: () => onSelectStep(index),
    },
  }));
}

function getWorkflowEdges(workflow) {
  const stepIds = new Set(workflow.steps.map((step) => step.id));
  const stepIndexById = new Map(workflow.steps.map((step, index) => [step.id, index]));
  const getBaseEdge = (step, targetId, sourceHandle, label, color) => ({
    id: `${step.id}-${sourceHandle}-${targetId || "end"}`,
    source: step.id,
    target: targetId,
    sourceHandle,
    targetHandle: sourceHandle === "reject" || sourceHandle === "fail" ? "return" : undefined,
    label,
    type: "workflowRoute",
    animated: sourceHandle === "reject",
    markerEnd: { type: MarkerType.ArrowClosed, color },
    style: { stroke: color, strokeWidth: 1.8 },
    labelStyle: { fill: color, fontSize: 11, fontWeight: 700 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
    data: {
      routeKind: sourceHandle,
      sourceIndex: stepIndexById.get(step.id) ?? 0,
      targetIndex: stepIndexById.get(targetId) ?? 0,
      sourceId: step.id,
      targetId,
    },
  });

  return workflow.steps.flatMap((step) => {
    if (step.type === "checkpoint") {
      return [
        step.approve && stepIds.has(step.approve) ? getBaseEdge(step, step.approve, "approve", "approve", "#16a34a") : null,
        step.rejectTo && stepIds.has(step.rejectTo) ? getBaseEdge(step, step.rejectTo, "reject", "reject", "#d97706") : null,
      ].filter(Boolean);
    }
    if (step.type === "condition") {
      return [
        step.passTo && stepIds.has(step.passTo) ? getBaseEdge(step, step.passTo, "pass", "pass", "#16a34a") : null,
        step.failTo && stepIds.has(step.failTo) ? getBaseEdge(step, step.failTo, "fail", "fail", "#d97706") : null,
      ].filter(Boolean);
    }
    return step.next && stepIds.has(step.next)
      ? [getBaseEdge(step, step.next, "next", "next", "#2563eb")]
      : [];
  });
}

function createStepId(workflow, prefix) {
  let index = workflow.steps.length + 1;
  let id = `${prefix}_${index}`;
  while (workflow.steps.some((step) => step.id === id)) {
    index += 1;
    id = `${prefix}_${index}`;
  }
  return id;
}

function getModelOptions(backend) {
  return MODEL_OPTIONS[backend] || [];
}

function getModelLabel(backend, model) {
  if (!model) return "Default model";
  return getModelOptions(backend).find((option) => option.value === model)?.label || model;
}

function getCodexReasoning(runtime) {
  return runtime?.options?.thread?.modelReasoningEffort || "";
}

function getReasoningLabel(value) {
  if (!value) return "Default reasoning";
  return CODEX_REASONING_OPTIONS.find((option) => option.value === value)?.label || value;
}

export default function WorkflowEditor({ filename, onClose, onSaved }) {
  const { t } = useI18n();
  const editorKey = useWorkflowEditorStore((s) => s.editorKey);
  const storedWorkflow = useWorkflowEditorStore((s) => s.workflow);
  const currentFilename = useWorkflowEditorStore((s) => s.currentFilename);
  const selectedIdx = useWorkflowEditorStore((s) => s.selectedIdx);
  const dirty = useWorkflowEditorStore((s) => s.dirty);
  const saving = useWorkflowEditorStore((s) => s.saving);
  const error = useWorkflowEditorStore((s) => s.error);
  const initializeEditor = useWorkflowEditorStore((s) => s.initializeEditor);
  const setWorkflow = useWorkflowEditorStore((s) => s.setWorkflow);
  const setCurrentFilename = useWorkflowEditorStore((s) => s.setCurrentFilename);
  const setSelectedIdx = useWorkflowEditorStore((s) => s.setSelectedIdx);
  const setDirty = useWorkflowEditorStore((s) => s.setDirty);
  const setSaving = useWorkflowEditorStore((s) => s.setSaving);
  const setError = useWorkflowEditorStore((s) => s.setError);
  const resetEditor = useWorkflowEditorStore((s) => s.resetEditor);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState(null);
  const [newCustomWorktreeFile, setNewCustomWorktreeFile] = useState("");
  const [stepIdDrafts, setStepIdDrafts] = useState({});
  const [modelRuntimeTarget, setModelRuntimeTarget] = useState(null);
  const [showWorkflowSetup, setShowWorkflowSetup] = useState(false);
  const [showRuntimeSettings, setShowRuntimeSettings] = useState(false);
  const aiApiProfiles = useConfigStore((s) => s.aiApiProfiles);
  const workflowConfig = useConfigStore((s) => s.workflowConfig);
  const loadWorkflowConfig = useConfigStore((s) => s.loadWorkflowConfig);
  const loadWorkflows = useConfigStore((s) => s.loadWorkflows);
  const showToast = useWorkflowStore((s) => s.showToast);
  const fallbackWorkflow = useMemo(() => createDefaultWorkflow({ includeStartStep: !filename }), [filename]);
  const workflow = storedWorkflow || fallbackWorkflow;
  const isNew = !currentFilename;
  const selected = selectedIdx !== null ? workflow.steps[selectedIdx] : null;
  const worktreeFiles = Array.isArray(workflow.worktree?.files) ? workflow.worktree.files : [];
  const customWorktreeFiles = Array.isArray(workflow.worktree?.customFiles) ? workflow.worktree.customFiles : [];
  const displayedWorktreeFiles = useMemo(() => Array.from(new Set([
    ...COMMON_WORKTREE_FILES,
    ...customWorktreeFiles,
    ...worktreeFiles.filter((file) => !COMMON_WORKTREE_FILES.includes(file)),
  ])), [customWorktreeFiles, worktreeFiles]);
  const dslPreview = useMemo(() => JSON.stringify(relinkSteps(workflow), null, 2), [workflow]);
  const flowNodes = useMemo(() => getWorkflowNodes(workflow, selectedIdx, setSelectedIdx), [workflow, selectedIdx]);
  const [liveNodes, setLiveNodes, onLiveNodesChange] = useNodesState(flowNodes);
  const flowEdges = useMemo(() => getWorkflowEdges(workflow), [workflow]);
  const canvasViewportRef = useRef(null);
  const selectedNodePanelRef = useRef(null);
  const [flowInstance, setFlowInstance] = useState(null);

  useEffect(() => {
    if (workflowConfig) return;
    loadWorkflowConfig();
  }, [workflowConfig, loadWorkflowConfig]);

  function closeEditor() {
    resetEditor();
    onClose();
  }

  useEffect(() => {
    setLiveNodes((currentNodes) => {
      const currentPositions = new Map(currentNodes.map((node) => [node.id, node.position]));
      return flowNodes.map((node) => ({
        ...node,
        position: currentPositions.get(node.id) || node.position,
      }));
    });
  }, [flowNodes, setLiveNodes]);

  useEffect(() => {
    if (!flowInstance || !selected?.id) return;

    const frame = window.requestAnimationFrame(() => {
      const canvasRect = canvasViewportRef.current?.getBoundingClientRect();
      if (!canvasRect?.width || !canvasRect?.height) return;

      const node = flowInstance.getNode(selected.id) || liveNodes.find((item) => item.id === selected.id);
      if (!node?.position) return;

      const panelRect = selectedNodePanelRef.current?.getBoundingClientRect();
      const panelWidth = panelRect?.width || NODE_PANEL_FALLBACK_WIDTH;
      const visibleWidth = Math.max(240, canvasRect.width - panelWidth - NODE_PANEL_GAP);
      const viewport = flowInstance.getViewport();
      const nodeWidth = node.measured?.width || node.width || NODE_WIDTH;
      const nodeHeight = node.measured?.height || node.height || NODE_HEIGHT;
      const nodeCenterX = node.position.x + nodeWidth / 2;
      const nodeCenterY = node.position.y + nodeHeight / 2;

      flowInstance.setViewport({
        x: visibleWidth / 2 - nodeCenterX * viewport.zoom,
        y: canvasRect.height / 2 - nodeCenterY * viewport.zoom,
        zoom: viewport.zoom,
      }, { duration: 220 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [flowInstance, selected?.id]);

  useEffect(() => {
    const nextEditorKey = getWorkflowEditorKey(filename);
    if (editorKey === nextEditorKey && storedWorkflow) return;

    if (!filename) {
      const next = createDefaultWorkflow();
      initializeEditor({
        filename: null,
        workflow: next,
        selectedIdx: next.steps.length > 0 ? 0 : null,
      });
      return;
    }

    appApi.getWorkflow(filename)
      .then((data) => {
        const next = normalizeWorkflow(data);
        initializeEditor({
          filename,
          workflow: next,
          selectedIdx: next.steps.length > 0 ? 0 : null,
        });
      })
      .catch(() => setError(t("editor.loadWorkflowFailed")));
  }, [filename, editorKey, storedWorkflow, initializeEditor, setError, t]);

  function updateWorkflow(patch) {
    setWorkflow((prev) => relinkSteps({ ...prev, ...patch }));
    setDirty(true);
  }

  function updateWorktree(patch) {
    updateWorkflow({ worktree: { ...workflow.worktree, ...patch } });
  }

  function toggleWorktreeFile(file) {
    const nextFiles = worktreeFiles.includes(file)
      ? worktreeFiles.filter((item) => item !== file)
      : [...worktreeFiles, file];
    updateWorktree({ files: Array.from(new Set(nextFiles)) });
  }

  function addCustomWorktreeFile() {
    const value = newCustomWorktreeFile.trim();
    if (!value) return;
    const nextCustomFiles = normalizeCustomWorktreeFiles([...customWorktreeFiles, value]);
    const nextFiles = Array.from(new Set([...worktreeFiles, value]));
    updateWorktree({ files: nextFiles, customFiles: nextCustomFiles });
    setNewCustomWorktreeFile("");
  }

  function removeCustomWorktreeFile(file) {
    updateWorktree({
      files: worktreeFiles.filter((item) => item !== file),
      customFiles: customWorktreeFiles.filter((item) => item !== file),
    });
  }

  function updateStep(index, patch) {
    setWorkflow((prev) => relinkSteps({
      ...prev,
      steps: prev.steps.map((step, idx) => idx === index ? { ...step, ...patch } : step),
    }));
    setDirty(true);
  }

  function updateStepWith(fn) {
    if (selectedIdx === null) return;
    setWorkflow((prev) => relinkSteps({
      ...prev,
      steps: prev.steps.map((step, idx) => idx === selectedIdx ? fn(step) : step),
    }));
    setDirty(true);
  }

  function renameStep(index, nextStepId) {
    const currentId = String(workflow.steps[index]?.id || "").trim();
    const newId = String(nextStepId || "").trim();
    if (!currentId || !newId || currentId === newId) return;
    if (workflow.steps.some((step, idx) => idx !== index && step.id === newId)) {
      setError(`Step ID "${newId}" already exists.`);
      return;
    }

    setWorkflow((prev) => relinkSteps({
      ...prev,
      steps: prev.steps.map((step, idx) => (
        idx === index
          ? { ...replaceStepReferences(step, currentId, newId), id: newId }
          : replaceStepReferences(step, currentId, newId)
      )),
      ui: {
        ...(prev.ui || {}),
        layout: WORKFLOW_CANVAS_LAYOUT,
        nodePositions: Object.fromEntries(
          Object.entries(prev.ui?.nodePositions || {}).map(([stepId, position]) => [
            stepId === currentId ? newId : stepId,
            position,
          ])
        ),
      },
    }));
    setStepIdDrafts((prev) => {
      const nextDrafts = { ...prev };
      delete nextDrafts[currentId];
      return nextDrafts;
    });
    setDirty(true);
    setError("");
  }

  function getDefaultForwardRoute(step) {
    if (!step) return "";
    if (step.type === "checkpoint") return step.approve || "";
    if (step.type === "condition") return step.passTo || "";
    return step.next || "";
  }

  function addAgentStep() {
    const previousStep = workflow.steps[workflow.steps.length - 1];
    const previousNext = getDefaultForwardRoute(previousStep);
    const next = {
      ...createAgentStep(workflow.steps.length + 1),
      id: createStepId(workflow, "agent"),
      label: `Agent ${workflow.steps.length + 1}`,
      next: previousNext || "",
    };
    setWorkflow((prev) => relinkSteps({
      ...prev,
      steps: [
        ...prev.steps.map((step, idx) => {
          if (idx !== prev.steps.length - 1) return step;
          if (step.type === "checkpoint") return { ...step, approve: next.id };
          if (step.type === "condition") return { ...step, passTo: next.id };
          return { ...step, next: next.id };
        }),
        next,
      ],
    }));
    setSelectedIdx(workflow.steps.length);
    setDirty(true);
  }

  function addCheckpointStep() {
    const previousStep = workflow.steps[workflow.steps.length - 1];
    const previousNext = getDefaultForwardRoute(previousStep);
    const next = {
      ...createCheckpointStep(workflow.steps.length + 1, previousStep?.id || "", previousNext || ""),
      id: createStepId(workflow, "checkpoint"),
      label: `Checkpoint ${workflow.steps.length + 1}`,
    };
    setWorkflow((prev) => relinkSteps({
      ...prev,
      steps: [
        ...prev.steps.map((step, idx) => {
          if (idx !== prev.steps.length - 1) return step;
          if (step.type === "checkpoint") return { ...step, approve: next.id };
          if (step.type === "condition") return { ...step, passTo: next.id };
          return { ...step, next: next.id };
        }),
        next,
      ],
    }));
    setSelectedIdx(workflow.steps.length);
    setDirty(true);
  }

  function addConditionStep() {
    const previousStep = workflow.steps[workflow.steps.length - 1];
    const previousNext = getDefaultForwardRoute(previousStep);
    const failStepId = workflow.steps[workflow.steps.length - 2]?.id || previousStep?.id || "";
    const next = {
      ...createConditionStep(workflow.steps.length + 1, previousStep?.id || "", previousNext || "", failStepId),
      id: createStepId(workflow, "condition"),
      label: `Conditional Gate ${workflow.steps.length + 1}`,
    };
    setWorkflow((prev) => relinkSteps({
      ...prev,
      steps: [
        ...prev.steps.map((step, idx) => {
          if (idx !== prev.steps.length - 1) return step;
          if (step.type === "checkpoint") return { ...step, approve: next.id };
          if (step.type === "condition") return { ...step, passTo: next.id };
          return { ...step, next: next.id };
        }),
        next,
      ],
    }));
    setSelectedIdx(workflow.steps.length);
    setDirty(true);
  }

  function addStepFromCanvas(type) {
    if (type === "checkpoint") {
      addCheckpointStep();
      return;
    }
    if (type === "condition") {
      addConditionStep();
      return;
    }
    addAgentStep();
  }

  function changeSelectedStepType(type) {
    if (selectedIdx === null || !selected) return;
    const template = type === "checkpoint"
      ? createCheckpointStep(selectedIdx + 1, workflow.steps[selectedIdx - 1]?.id || "", workflow.steps[selectedIdx + 1]?.id || "")
      : type === "condition"
        ? createConditionStep(
            selectedIdx + 1,
            workflow.steps[selectedIdx - 1]?.id || "",
            workflow.steps[selectedIdx + 1]?.id || "",
            workflow.steps[selectedIdx - 2]?.id || workflow.steps[selectedIdx - 1]?.id || ""
          )
        : createAgentStep(selectedIdx + 1);
    updateStep(selectedIdx, {
      ...template,
      id: selected.id,
      label: selected.label || template.label,
      inputs: selected.inputs || template.inputs,
      outputs: selected.outputs || template.outputs,
    });
  }

  function removeStep(index) {
    setWorkflow((prev) => relinkSteps({ ...prev, steps: prev.steps.filter((_, idx) => idx !== index) }));
    setSelectedIdx((current) => {
      if (current === index) return workflow.steps.length > 1 ? Math.min(index, workflow.steps.length - 2) : null;
      if (current > index) return current - 1;
      return current;
    });
    setDirty(true);
  }

  function updateRoute(sourceId, sourceHandle, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setWorkflow((prev) => relinkSteps({
      ...prev,
      steps: prev.steps.map((step) => {
        if (step.id !== sourceId) return step;
        if (step.type === "checkpoint") {
          if (sourceHandle === "reject") {
            return {
              ...step,
              rejectTo: targetId,
              rejectTargets: [targetId],
            };
          }
          return {
            ...step,
            approve: targetId,
          };
        }
        if (step.type === "condition") {
          if (sourceHandle === "fail") {
            return {
              ...step,
              failTo: targetId,
            };
          }
          return {
            ...step,
            passTo: targetId,
          };
        }
        return {
          ...step,
          next: targetId,
        };
      }),
    }));
    setDirty(true);
  }

  function removeRoute(sourceId, sourceHandle, targetId) {
    setWorkflow((prev) => relinkSteps({
      ...prev,
      steps: prev.steps.map((step) => {
        if (step.id !== sourceId) return step;
        if (step.type === "checkpoint") {
          if (sourceHandle === "reject" && step.rejectTo === targetId) {
            return { ...step, rejectTo: "", rejectTargets: [] };
          }
          if (sourceHandle === "approve" && step.approve === targetId) {
            return { ...step, approve: "" };
          }
          return step;
        }
        if (step.type === "condition") {
          if (sourceHandle === "fail" && step.failTo === targetId) {
            return { ...step, failTo: "" };
          }
          if (sourceHandle === "pass" && step.passTo === targetId) {
            return { ...step, passTo: "" };
          }
          return step;
        }
        return step.next === targetId ? { ...step, next: "" } : step;
      }),
    }));
    setDirty(true);
  }

  function reconnectRoute(edge, connection) {
    if (!edge?.source || !edge?.target || !connection?.source || !connection?.target) return;
    if (connection.source === connection.target) return;

    setWorkflow((prev) => relinkSteps({
      ...prev,
      steps: prev.steps.map((step) => {
        let nextStep = step;
        if (step.id === edge.source) {
          if (step.type === "checkpoint") {
            if (edge.sourceHandle === "reject" && step.rejectTo === edge.target) {
              nextStep = { ...nextStep, rejectTo: "", rejectTargets: [] };
            }
            if (edge.sourceHandle === "approve" && step.approve === edge.target) {
              nextStep = { ...nextStep, approve: "" };
            }
          } else if (step.type === "condition") {
            if (edge.sourceHandle === "fail" && step.failTo === edge.target) {
              nextStep = { ...nextStep, failTo: "" };
            }
            if (edge.sourceHandle === "pass" && step.passTo === edge.target) {
              nextStep = { ...nextStep, passTo: "" };
            }
          } else if (step.next === edge.target) {
            nextStep = { ...nextStep, next: "" };
          }
        }

        if (nextStep.id !== connection.source) return nextStep;
        if (nextStep.type === "checkpoint") {
          if (connection.sourceHandle === "reject") {
            return {
              ...nextStep,
              rejectTo: connection.target,
              rejectTargets: [connection.target],
            };
          }
          return {
            ...nextStep,
            approve: connection.target,
          };
        }
        if (nextStep.type === "condition") {
          if (connection.sourceHandle === "fail") {
            return {
              ...nextStep,
              failTo: connection.target,
            };
          }
          return {
            ...nextStep,
            passTo: connection.target,
          };
        }
        return {
          ...nextStep,
          next: connection.target,
        };
      }),
    }));
    setDirty(true);
  }

  function saveNodePosition(node) {
    const position = normalizeNodePosition(node?.position);
    if (!node?.id || !position) return;

    setWorkflow((prev) => relinkSteps({
      ...prev,
      ui: {
        ...(prev.ui || {}),
        layout: WORKFLOW_CANVAS_LAYOUT,
        nodePositions: {
          ...(prev.ui?.nodePositions || {}),
          [node.id]: position,
        },
      },
    }));
    setDirty(true);
  }

  function addInput() {
    const previousStep = workflow.steps[selectedIdx - 1];
    const outputKeys = getStepOutputKeys(previousStep);
    updateStepWith((step) => ({
      ...step,
      inputs: [
        ...(step.inputs || []),
        {
          name: "input",
          sourceType: previousStep && outputKeys.length > 0 ? "step_output" : "task_input",
          inputLabel: "Input",
          inputPlaceholder: "",
          stepId: previousStep && outputKeys.length > 0 ? previousStep.id : "",
          outputKey: outputKeys[0] || "",
          required: true,
        },
      ],
    }));
  }

  function updateInput(inputIndex, patch) {
    updateStepWith((step) => ({
      ...step,
      inputs: (step.inputs || []).map((input, idx) => idx === inputIndex ? { ...input, ...patch } : input),
    }));
  }

  function removeInput(inputIndex) {
    updateStepWith((step) => ({
      ...step,
      inputs: (step.inputs || []).filter((_, idx) => idx !== inputIndex),
    }));
  }

  function addOutput() {
    updateStepWith((step) => ({
      ...step,
      outputs: [
        ...(step.outputs || []),
        {
          key: "result",
          kind: "markdown",
          filename: `${step.id || "step"}.md`,
        },
      ],
    }));
  }

  function updateOutput(outputIndex, patch) {
    updateStepWith((step) => ({
      ...step,
      outputs: (step.outputs || []).map((output, idx) => idx === outputIndex ? { ...output, ...patch } : output),
    }));
  }

  function removeOutput(outputIndex) {
    updateStepWith((step) => ({
      ...step,
      outputs: (step.outputs || []).filter((_, idx) => idx !== outputIndex),
    }));
  }

  function updateRuntime(patch) {
    updateWorkflow({
      runtime: {
        ...workflow.runtime,
        ...patch,
      },
    });
  }

  function updateRuntimeReasoning(modelReasoningEffort) {
    updateRuntime({
      options: {
        ...(workflow.runtime?.options || {}),
        thread: {
          ...(workflow.runtime?.options?.thread || {}),
          modelReasoningEffort,
        },
      },
    });
  }

  function updateSelectedStepReasoning(modelReasoningEffort) {
    updateStepWith((step) => ({
      ...step,
      options: {
        ...(step.options || {}),
        thread: {
          ...(step.options?.thread || {}),
          modelReasoningEffort,
        },
      },
    }));
  }

  function updateRuntimeTargetModel(model) {
    if (modelRuntimeTarget === "workflow") {
      updateRuntime({ model });
      return;
    }
    if (modelRuntimeTarget === "step") {
      updateStepWith((step) => ({ ...step, model }));
    }
  }

  function updateRuntimeTargetReasoning(modelReasoningEffort) {
    if (modelRuntimeTarget === "workflow") {
      updateRuntimeReasoning(modelReasoningEffort);
      return;
    }
    if (modelRuntimeTarget === "step") {
      updateSelectedStepReasoning(modelReasoningEffort);
    }
  }

  async function handleSave(shouldClose = false, { draft = false } = {}) {
    const dsl = relinkSteps(workflow);
    if (!dsl.name.trim()) {
      setError(t("editor.workflowNameRequired"));
      return;
    }
    if (!draft && dsl.steps.length === 0) {
      setError(t("editor.phaseRequired"));
      return;
    }
    if (dsl.worktree?.enabled && dsl.worktree?.useCustomSetupScript && !String(dsl.worktree.setupScript || "").trim()) {
      setError("Setup script is required when custom setup is enabled.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      let savedFilename = currentFilename;
      if (isNew) {
        const created = draft
          ? await appApi.createWorkflowDraft(dsl)
          : await appApi.createWorkflow(dsl);
        savedFilename = created.filename;
        setCurrentFilename(created.filename);
      } else {
        if (draft) {
          await appApi.updateWorkflowDraft(currentFilename, dsl);
        } else {
          await appApi.updateWorkflow(currentFilename, dsl);
        }
      }
      setDirty(false);
      showToast(t(draft ? "settings.workflowDraftSaved" : "settings.workflowSaved"));
      loadWorkflowConfig();
      loadWorkflows();
      if (shouldClose) {
        resetEditor();
        onSaved(savedFilename);
      }
    } catch (err) {
      setError(err.message || t("editor.saveWorkflowFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b border-border bg-card px-8 py-5">
        <BackButton onClick={() => dirty ? setShowBackConfirm(true) : closeEditor()} label={t("editor.back")} className="-ml-2" />
        <Input
          value={workflow.name}
          onChange={(event) => {
            const name = event.target.value;
            updateWorkflow({ name, id: slugify(name, workflow.id || "workflow") });
          }}
          placeholder={t("editor.workflowName")}
          className="max-w-xs"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => setShowWorkflowSetup(true)}>
          Workflow Setup
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowRuntimeSettings(true)}>
          Runtime
        </Button>
        <div className="flex-1" />
        {error && <span className="max-w-md truncate text-xs text-destructive">{error}</span>}
        <Button type="button" size="sm" variant="outline" onClick={() => handleSave(false, { draft: true })} disabled={saving || !dirty}>
          {saving ? t("editor.saving") : t("editor.saveAsDraft")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => handleSave(true)} disabled={saving || !dirty}>
          {saving ? t("editor.saving") : t("editor.saveAndExit")}
        </Button>
        <Button type="button" size="sm" onClick={() => handleSave(false)} disabled={saving || !dirty}>
          {saving ? t("editor.saving") : t("editor.save")}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 bg-background p-4">
        {showWorkflowSetup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6 py-6" onClick={() => setShowWorkflowSetup(false)}>
            <div className="flex max-h-[84vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-foreground">Workflow Setup</h2>
                  <span className="text-xs text-muted-foreground">Runtime, worktree, node library, and canvas route guide.</span>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-8 w-8 px-0" onClick={() => setShowWorkflowSetup(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="min-h-0 overflow-y-auto p-5">
          <section className="mb-4 rounded-md border border-border bg-card p-3">
            <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <GitBranch className="h-3.5 w-3.5" />
                Git worktree
              </span>
              <input
                type="checkbox"
                checked={workflow.worktree.enabled}
                onChange={(event) => updateWorktree({ enabled: event.target.checked })}
              />
            </label>
            {workflow.worktree.enabled && (
              <div className="mt-3 grid gap-2 rounded-md border border-border bg-background/70 p-2">
                <div>
                  <label className="mb-1.5 block text-[10px] text-muted-foreground">Name generator</label>
                  <Select
                    value={workflow.worktree.namingProvider || "ai_api"}
                    onChange={(event) => updateWorktree({ namingProvider: event.target.value })}
                    className="h-8 text-xs"
                  >
                    <option value="ai_api">AI API</option>
                    <option value="ai_backend">Workflow Backend</option>
                  </Select>
                </div>
                {(workflow.worktree.namingProvider || "ai_api") === "ai_api" && (
                  <div>
                    <label className="mb-1.5 block text-[10px] text-muted-foreground">AI API Client</label>
                    <Select
                      value={workflow.worktree.namingAiApiProfileId || ""}
                      onChange={(event) => updateWorktree({ namingAiApiProfileId: event.target.value })}
                      className="h-8 text-xs"
                    >
                      <option value="" disabled>Select AI API client</option>
                      {aiApiProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
            )}
            {workflow.worktree.enabled && (
              <label className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>Remove on complete</span>
                <input
                  type="checkbox"
                  checked={workflow.worktree.removeOnComplete}
                  onChange={(event) => updateWorktree({ removeOnComplete: event.target.checked })}
                />
              </label>
            )}
            {workflow.worktree.enabled && (
              <div className="mt-3">
                <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>Use custom setup script</span>
                  <input
                    type="checkbox"
                    checked={workflow.worktree.useCustomSetupScript === true}
                    onChange={(event) => updateWorktree({ useCustomSetupScript: event.target.checked })}
                  />
                </label>
              </div>
            )}
            {workflow.worktree.enabled && workflow.worktree.useCustomSetupScript !== true && (
              <div className="mt-3 space-y-2 rounded-md border border-border bg-background/70 p-2">
                {displayedWorktreeFiles.map((file) => (
                  <label key={file} className="flex items-center gap-2 text-[11px] text-foreground">
                    <input
                      type="checkbox"
                      checked={worktreeFiles.includes(file)}
                      onChange={() => toggleWorktreeFile(file)}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono">{file}</span>
                    {!COMMON_WORKTREE_FILES.includes(file) && (
                      <button
                        type="button"
                        className="rounded px-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={(event) => {
                          event.preventDefault();
                          removeCustomWorktreeFile(file);
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </label>
                ))}
              </div>
            )}
            {workflow.worktree.enabled && workflow.worktree.useCustomSetupScript !== true && (
              <div className="mt-3">
                <label className="mb-1.5 block text-[10px] text-muted-foreground">Extra files or folders</label>
                <div className="flex gap-2">
                  <Input
                    value={newCustomWorktreeFile}
                    onChange={(event) => setNewCustomWorktreeFile(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addCustomWorktreeFile();
                      }
                    }}
                    placeholder="relative/path"
                    className="h-8 text-xs"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={addCustomWorktreeFile}>Add</Button>
                </div>
              </div>
            )}
            {workflow.worktree.enabled && workflow.worktree.useCustomSetupScript === true && (
                  <div>
                    <textarea
                      value={workflow.worktree.setupScript || ""}
                      onChange={(event) => updateWorktree({ setupScript: event.target.value })}
                      placeholder="pnpm install"
                      rows={3}
                      className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                    />
                  </div>
            )}
          </section>

          <section className="rounded-md border border-border bg-card p-3">
            <h2 className="mb-3 text-xs font-semibold text-foreground">Node Library</h2>
            <div className="space-y-2">
              <button
                type="button"
                className="w-full rounded-md border border-border bg-background/70 px-3 py-3 text-left hover:border-ring hover:bg-accent"
                onClick={() => addStepFromCanvas("agent")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">Agent</span>
                  <Badge variant="info" className="text-[10px]">agent</Badge>
                </div>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">Run Claude Code or Codex with prompt, inputs, and outputs.</p>
              </button>
              <button
                type="button"
                className="w-full rounded-md border border-border bg-background/70 px-3 py-3 text-left hover:border-ring hover:bg-accent"
                onClick={() => addStepFromCanvas("checkpoint")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">Checkpoint</span>
                  <Badge variant="warning" className="text-[10px]">gate</Badge>
                </div>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">Human approve/reject gate with explicit graph routes.</p>
              </button>
              <button
                type="button"
                className="w-full rounded-md border border-border bg-background/70 px-3 py-3 text-left hover:border-ring hover:bg-accent"
                onClick={() => addStepFromCanvas("condition")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">Conditional Gate</span>
                  <Badge variant="success" className="text-[10px]">ai gate</Badge>
                </div>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">Run an AI decision and route automatically through pass or fail.</p>
              </button>
            </div>
          </section>

          <section className="mt-4 rounded-md border border-border bg-card p-3">
            <h2 className="mb-2 text-xs font-semibold text-foreground">Canvas Routes</h2>
            <div className="space-y-2 text-[11px] leading-4 text-muted-foreground">
	              <p>Drag from a node handle to another node to create a route.</p>
	              <p>Agent: blue handle writes <span className="font-mono">next</span>.</p>
	              <p>Checkpoint: green writes <span className="font-mono">approve</span>, amber writes <span className="font-mono">rejectTo</span>.</p>
	              <p>Conditional Gate: green writes <span className="font-mono">passTo</span>, amber writes <span className="font-mono">failTo</span>.</p>
	            </div>
          </section>
              </div>
            </div>
          </div>
        )}

        <main className="h-full min-h-0 overflow-hidden">
          <div className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Workflow Canvas</h2>
                <p className="text-xs text-muted-foreground">Add nodes, connect routes, then click a node to edit it in the canvas panel.</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => addStepFromCanvas("agent")}>Agent</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => addStepFromCanvas("condition")}>Conditional Gate</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => addStepFromCanvas("checkpoint")}>Gate</Button>
              </div>
            </div>
            <div ref={canvasViewportRef} className="relative min-h-0 flex-1">
              <ReactFlow
                nodes={liveNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onInit={setFlowInstance}
                onNodeClick={(event, node) => {
                  event.stopPropagation();
                  setSelectedIdx(workflow.steps.findIndex((step) => step.id === node.id));
                }}
                onPaneClick={() => setSelectedIdx(null)}
                onConnect={(connection) => updateRoute(connection.source, connection.sourceHandle, connection.target)}
                onReconnect={reconnectRoute}
                onEdgesDelete={(edges) => edges.forEach((edge) => removeRoute(edge.source, edge.sourceHandle, edge.target))}
                onNodesChange={onLiveNodesChange}
                onNodeDragStop={(_event, node) => saveNodePosition(node)}
                fitView
                fitViewOptions={{ padding: 0.25 }}
                nodesDraggable
                nodesConnectable
                edgesReconnectable
                reconnectRadius={16}
                elementsSelectable
                deleteKeyCode={["Backspace", "Delete"]}
              >
                <Background color="var(--border-color)" gap={18} />
                <Controls />
                <MiniMap pannable zoomable nodeStrokeWidth={3} />
              </ReactFlow>
              {selected && (
                <section
                  ref={selectedNodePanelRef}
                  className="absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-[20rem] max-w-[calc(100%-1.5rem)] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-xl"
                  onClick={(event) => event.stopPropagation()}
                >
              <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card px-3 py-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xs font-semibold text-foreground">Selected Node</h2>
                  <p className="truncate text-[10px] text-muted-foreground">{selected.label || selected.id}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRemoveIdx(selectedIdx)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setSelectedIdx(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto py-3 pl-3 pr-5 [scrollbar-gutter:stable]">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Type</label>
                    <Select
                      value={selected.type}
                      onChange={(event) => changeSelectedStepType(event.target.value)}
                    >
                      <option value="agent">agent</option>
                      <option value="condition">conditional gate</option>
                      <option value="checkpoint">checkpoint</option>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Step ID</label>
                    <Input
                      value={stepIdDrafts[selected.id] ?? selected.id ?? ""}
                      onChange={(event) => {
                        setError("");
                        const value = event.target.value;
                        setStepIdDrafts((prev) => ({ ...prev, [selected.id]: value }));
                      }}
                      onBlur={() => {
                        const draft = stepIdDrafts[selected.id] ?? selected.id;
                        const nextId = draft.trim();
                        if (!nextId || nextId === selected.id) {
                          setStepIdDrafts((prev) => {
                            const nextDrafts = { ...prev };
                            delete nextDrafts[selected.id];
                            return nextDrafts;
                          });
                          return;
                        }
                        renameStep(selectedIdx, nextId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setStepIdDrafts((prev) => {
                            const nextDrafts = { ...prev };
                            delete nextDrafts[selected.id];
                            return nextDrafts;
                          });
                        }
                      }}
                      className="font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Label</label>
                  <Input value={selected.label || ""} onChange={(event) => updateStep(selectedIdx, { label: event.target.value })} />
                </div>

                {(selected.type === "agent" || selected.type === "condition") && (
                  <>
                    <div className="grid gap-2">
                      <div className="min-w-0">
                        <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Backend</label>
                        <Select
                          value={selected.backend || ""}
                          onChange={(event) => {
                            const backend = event.target.value;
                            const models = backend ? getModelOptions(backend).map((model) => model.value) : [];
                            updateStep(selectedIdx, {
                              backend,
                              model: backend && models.includes(selected.model) ? selected.model : "",
                              aiApiProfileId: backend === "ai_api" ? selected.aiApiProfileId || aiApiProfiles[0]?.id || "" : selected.aiApiProfileId,
                            });
                          }}
                        >
                          <option value="">Workflow runtime</option>
                          <option value="claude">claude</option>
                          <option value="codex">codex</option>
                          <option value="ai_api">AI API</option>
                        </Select>
                      </div>
                      {selected.backend === "ai_api" ? (
                        <div className="min-w-0">
                          <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">AI API Client</label>
                          <Select
                            value={selected.aiApiProfileId || ""}
                            onChange={(event) => updateStep(selectedIdx, { aiApiProfileId: event.target.value })}
                          >
                            <option value="">Select AI API client</option>
                            {aiApiProfiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>
                            ))}
                          </Select>
                        </div>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Model</label>
                            <Button type="button" variant="outline" className="h-auto w-full justify-start px-3 py-2 text-left" onClick={() => setModelRuntimeTarget("step")}>
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-foreground">{selected.model ? getModelLabel(selected.backend || workflow.runtime.backend, selected.model) : "Workflow model"}</span>
                                {(selected.backend || workflow.runtime.backend) === "codex" && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{getReasoningLabel(getCodexReasoning(selected))}</span>}
                              </span>
                            </Button>
                          </div>
                          <div className="min-w-0">
                            <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
                              <span>Codebase Access</span>
                              <Tooltip content={CODEBASE_ACCESS_TOOLTIP} side="top" align="center">
                                <button
                                  type="button"
                                  aria-label="Explain codebase access"
                                  className="inline-flex cursor-help text-muted-foreground/80 hover:text-foreground"
                                >
                                  <CircleHelp className="h-3.5 w-3.5" />
                                </button>
                              </Tooltip>
                            </label>
                            <Select value={selected.workspaceAccess || ""} onChange={(event) => updateStep(selectedIdx, { workspaceAccess: event.target.value })}>
                              <option value="">Workflow runtime</option>
                              <option value="read">Read-only</option>
                              <option value="write">Can edit project files</option>
                            </Select>
                          </div>
                        </>
                      )}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Step Prompt</label>
                      <textarea
                        value={selected.prompt || ""}
                        onChange={(event) => updateStep(selectedIdx, { prompt: event.target.value })}
                        className="min-h-32 w-full resize-y rounded-md border border-input bg-secondary px-3 py-3 font-mono text-xs text-foreground outline-none focus:border-ring"
                      />
                    </div>
                    {selected.type === "condition" && (
                      <div className="rounded-md border border-success/25 bg-success/5 p-3">
                        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold text-success">
                          <Braces className="h-3.5 w-3.5" />
                          <span>{t("editor.conditionDecisionOutput")}</span>
                        </div>
                        <div className="grid gap-2 text-[11px] leading-4 text-muted-foreground">
                          <div className="rounded border border-border bg-background/70 px-2 py-1.5">
                            <code className="font-mono text-foreground">{"{\"passed\": true, \"reason\": \"...\"}"}</code>
                            <span className="ml-2">{t("editor.conditionPassRoute")}</span>
                          </div>
                          <div className="rounded border border-border bg-background/70 px-2 py-1.5">
                            <code className="font-mono text-foreground">{"{\"passed\": false, \"reason\": \"...\"}"}</code>
                            <span className="ml-2">{t("editor.conditionFailRoute")}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {selected.type === "agent" ? (
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Next Route</label>
                        <Select value={selected.next || ""} onChange={(event) => updateStep(selectedIdx, { next: event.target.value })}>
                          <option value="">End</option>
                          {workflow.steps.filter((step) => step.id !== selected.id).map((step) => (
                            <option key={step.id} value={step.id}>{step.label || step.id}</option>
                          ))}
                        </Select>
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        <div>
                          <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Pass To</label>
                          <Select value={selected.passTo || ""} onChange={(event) => updateStep(selectedIdx, { passTo: event.target.value })}>
                            <option value="">End</option>
                            {workflow.steps.filter((step) => step.id !== selected.id).map((step) => (
                              <option key={step.id} value={step.id}>{step.label || step.id}</option>
                            ))}
                          </Select>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Fail To</label>
                          <Select value={selected.failTo || ""} onChange={(event) => updateStep(selectedIdx, { failTo: event.target.value })}>
                            <option value="">End</option>
                            {workflow.steps.filter((step) => step.id !== selected.id).map((step) => (
                              <option key={step.id} value={step.id}>{step.label || step.id}</option>
                            ))}
                          </Select>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {selected.type === "checkpoint" && (
                  <>
                    <div className="grid gap-2">
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Approve To</label>
                        <Select value={selected.approve || ""} onChange={(event) => updateStep(selectedIdx, { approve: event.target.value })}>
                          <option value="">End</option>
                          {workflow.steps.filter((step) => step.id !== selected.id).map((step) => (
                            <option key={step.id} value={step.id}>{step.label || step.id}</option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Reject To</label>
                        <Select value={selected.rejectTo || ""} onChange={(event) => updateStep(selectedIdx, { rejectTo: event.target.value, rejectTargets: [event.target.value].filter(Boolean) })}>
                          <option value="">Select step</option>
                          {workflow.steps.filter((step) => step.id !== selected.id).map((step) => (
                            <option key={step.id} value={step.id}>{step.label || step.id}</option>
                          ))}
                        </Select>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Question</label>
                      <Input value={selected.question || ""} onChange={(event) => updateStep(selectedIdx, { question: event.target.value })} />
                    </div>
                  </>
                )}

                <div className="border-t border-border pt-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-[11px] font-semibold text-foreground">Inputs</h3>
                    <Button type="button" size="sm" variant="outline" onClick={addInput}>Add</Button>
                  </div>
                  <div className="min-w-0 space-y-2">
                    {(selected.inputs || []).map((input, inputIndex) => (
                      <div key={inputIndex} className="min-w-0 rounded-md border border-border bg-background/70 p-2">
                        <div className="mb-2 grid grid-cols-[1fr_auto] items-end gap-2">
                          <div className="min-w-0">
                            <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Name</label>
                            <Input value={input.name || ""} onChange={(event) => updateInput(inputIndex, { name: event.target.value })} />
                          </div>
                          <Button type="button" size="sm" variant="outline" onClick={() => removeInput(inputIndex)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="mb-2">
                          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Source</label>
                          <Select
                            value={input.sourceType || "task_input"}
                            onChange={(event) => {
                              const sourceType = event.target.value;
                              if (sourceType === "step_output") {
                                const previousStep = workflow.steps[selectedIdx - 1];
                                const outputKeys = getStepOutputKeys(previousStep);
                                updateInput(inputIndex, {
                                  sourceType,
                                  stepId: input.stepId || previousStep?.id || "",
                                  outputKey: input.outputKey || outputKeys[0] || "",
                                });
                                return;
                              }
                              updateInput(inputIndex, { sourceType, stepId: "", outputKey: "" });
                            }}
                          >
                            <option value="task_input">task input</option>
                            <option value="step_output">output</option>
                          </Select>
                        </div>
                        {input.sourceType === "step_output" ? (
                          <div className="grid gap-2">
                            <div>
                              <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Step</label>
                              <Select
                                value={input.stepId || ""}
                                onChange={(event) => {
                                  const stepId = event.target.value;
                                  const sourceStep = workflow.steps.find((step) => step.id === stepId);
                                  updateInput(inputIndex, { stepId, outputKey: getStepOutputKeys(sourceStep)[0] || "" });
                                }}
                              >
                                <option value="">Source step</option>
                                {workflow.steps.filter((step) => step.id !== selected.id).map((step) => (
                                  <option key={step.id} value={step.id}>{step.label || step.id}</option>
                                ))}
                              </Select>
                            </div>
                            <div>
                              <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Output</label>
                              <Select
                                value={input.outputKey || ""}
                                onChange={(event) => updateInput(inputIndex, { outputKey: event.target.value })}
                                disabled={!input.stepId || getStepOutputKeys(workflow.steps.find((step) => step.id === input.stepId)).length === 0}
                              >
                                <option value="">Select output</option>
                                {getStepOutputKeys(workflow.steps.find((step) => step.id === input.stepId)).map((outputKey) => (
                                  <option key={outputKey} value={outputKey}>{outputKey}</option>
                                ))}
                              </Select>
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-2">
                            <div>
                              <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Label</label>
                              <Input value={input.inputLabel || ""} onChange={(event) => updateInput(inputIndex, { inputLabel: event.target.value })} />
                            </div>
                            <div>
                              <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Placeholder</label>
                              <Input value={input.inputPlaceholder || ""} onChange={(event) => updateInput(inputIndex, { inputPlaceholder: event.target.value })} />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {(selected.inputs || []).length === 0 && <div className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">No inputs.</div>}
                  </div>
                </div>

                <div className="border-t border-border pt-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-[11px] font-semibold text-foreground">Outputs</h3>
                    <Button type="button" size="sm" variant="outline" onClick={addOutput}>Add</Button>
                  </div>
                  <div className="min-w-0 space-y-2">
                    {(selected.outputs || []).map((output, outputIndex) => (
                      <div key={outputIndex} className="min-w-0 rounded-md border border-border bg-background/70 p-2">
                        <div className="mb-2 grid grid-cols-[1fr_auto] items-end gap-2">
                          <div className="min-w-0">
                            <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Key</label>
                            <Input value={output.key || ""} onChange={(event) => updateOutput(outputIndex, { key: event.target.value })} />
                          </div>
                          <Button type="button" size="sm" variant="outline" onClick={() => removeOutput(outputIndex)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="grid gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Kind</label>
                            <Select value={output.kind || "markdown"} onChange={(event) => updateOutput(outputIndex, { kind: event.target.value })}>
                              <option value="markdown">md</option>
                            </Select>
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Filename</label>
                            <Input value={output.filename || ""} onChange={(event) => updateOutput(outputIndex, { filename: event.target.value })} />
                          </div>
                        </div>
                      </div>
                    ))}
                    {(selected.outputs || []).length === 0 && <div className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">No outputs.</div>}
                  </div>
                </div>
              </div>
                </section>
              )}
            </div>
          </div>
        </main>

      {showRuntimeSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6 py-6" onClick={() => setShowRuntimeSettings(false)}>
          <div className="flex max-h-[84vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-foreground">Runtime</h2>
                <span className="text-xs text-muted-foreground">Configure the default backend, model, access, and JSON DSL.</span>
              </div>
              <Button type="button" variant="outline" size="sm" className="h-8 w-8 px-0" onClick={() => setShowRuntimeSettings(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] gap-4 overflow-y-auto p-5">
              <div className="min-w-0">
                <section className="rounded-md border border-border bg-card p-3">
                  <h2 className="mb-3 text-xs font-semibold text-foreground">Default Runtime</h2>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Backend</label>
                      <Select
                        value={workflow.runtime.backend || "codex"}
                        onChange={(event) => {
                          const backend = event.target.value;
                          const models = getModelOptions(backend).map((model) => model.value);
                          updateRuntime({ backend, model: models.includes(workflow.runtime.model) ? workflow.runtime.model : "" });
                        }}
                      >
                        <option value="claude">claude</option>
                        <option value="codex">codex</option>
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
                        <span>Codebase Access</span>
                        <Tooltip content={CODEBASE_ACCESS_TOOLTIP} side="top" align="center">
                          <button
                            type="button"
                            aria-label="Explain codebase access"
                            className="inline-flex cursor-help text-muted-foreground/80 hover:text-foreground"
                          >
                            <CircleHelp className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                      </label>
                      <Select value={workflow.runtime.workspaceAccess || "read"} onChange={(event) => updateRuntime({ workspaceAccess: event.target.value })}>
                        <option value="read">Read-only</option>
                        <option value="write">Can edit project files</option>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-2">
                    <label className="mb-1.5 block text-[10px] font-semibold text-muted-foreground">Model</label>
                    <Button type="button" variant="outline" className="h-auto w-full justify-start px-3 py-2 text-left" onClick={() => setModelRuntimeTarget("workflow")}>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-foreground">{getModelLabel(workflow.runtime.backend || "codex", workflow.runtime.model)}</span>
                        {workflow.runtime.backend === "codex" && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{getReasoningLabel(getCodexReasoning(workflow.runtime))}</span>}
                      </span>
                    </Button>
                  </div>
                </section>
              </div>

              <section className="min-w-0 rounded-md border border-border bg-card p-3">
                <h2 className="mb-3 text-xs font-semibold text-foreground">JSON DSL Preview</h2>
                <pre className="max-h-[34rem] overflow-auto rounded-md border border-border bg-secondary/40 p-3 text-[10px] leading-5 text-foreground">
                  {dslPreview}
                </pre>
              </section>
            </div>
          </div>
        </div>
      )}

      {modelRuntimeTarget && (modelRuntimeTarget === "workflow" || selected) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6 py-6" onClick={() => setModelRuntimeTarget(null)}>
          <div className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-foreground">Select Model</h2>
                <span className="text-xs text-muted-foreground">
                  {modelRuntimeTarget === "workflow" ? "workflow runtime" : selected?.label || selected?.id}
                </span>
              </div>
              <Button type="button" variant="outline" size="sm" className="h-8 w-8 px-0" onClick={() => setModelRuntimeTarget(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 overflow-y-auto p-5">
              {(() => {
                const targetRuntime = modelRuntimeTarget === "workflow" ? workflow.runtime : selected || {};
                const backend = targetRuntime.backend || workflow.runtime.backend || "codex";
                const model = targetRuntime.model || "";
                return (
                  <>
                    <div className="space-y-2">
                      <button
                        type="button"
                        className={cn(
                          "w-full rounded-md border px-4 py-3 text-left transition-colors",
                          !model ? "border-ring bg-primary/15" : "border-border bg-background/70 hover:bg-accent"
                        )}
                        onClick={() => updateRuntimeTargetModel("")}
                      >
                        <div className="text-sm font-semibold text-foreground">{modelRuntimeTarget === "workflow" ? "Default model" : "Workflow model"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">Use the default model for this runtime.</div>
                      </button>
                      {getModelOptions(backend).map((modelOption) => (
                        <button
                          key={modelOption.value}
                          type="button"
                          className={cn(
                            "w-full rounded-md border px-4 py-3 text-left transition-colors",
                            model === modelOption.value ? "border-ring bg-primary/15" : "border-border bg-background/70 hover:bg-accent"
                          )}
                          onClick={() => updateRuntimeTargetModel(modelOption.value)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">{modelOption.label}</span>
                            {modelOption.badge && <Badge variant="outline" className="text-[10px]">{modelOption.badge}</Badge>}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{modelOption.description}</div>
                        </button>
                      ))}
                    </div>

                    {backend === "codex" && (
                      <div className="mt-5 border-t border-border pt-5">
                        <h3 className="mb-3 text-xs font-semibold text-foreground">Reasoning Level</h3>
                        <div className="grid grid-cols-2 gap-2">
                          {CODEX_REASONING_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={cn(
                                "rounded-md border px-3 py-3 text-left transition-colors",
                                getCodexReasoning(targetRuntime) === option.value ? "border-ring bg-primary/15" : "border-border bg-background/70 hover:bg-accent"
                              )}
                              onClick={() => updateRuntimeTargetReasoning(option.value)}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-foreground">{option.label}</span>
                                {option.badge && <Badge variant="outline" className="text-[10px]">{option.badge}</Badge>}
                              </div>
                              <div className="mt-1 text-xs leading-4 text-muted-foreground">{option.description}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="flex justify-end border-t border-border px-5 py-4">
              <Button type="button" size="sm" onClick={() => setModelRuntimeTarget(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}

	      {showBackConfirm && (
	        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowBackConfirm(false)}>
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg" onClick={(event) => event.stopPropagation()}>
            <h3 className="mb-2 text-sm font-semibold text-foreground">{t("editor.unsavedChanges")}</h3>
            <p className="mb-4 text-sm text-muted-foreground">{t("editor.unsavedChangesConfirm")}</p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowBackConfirm(false)}>{t("common.cancel")}</Button>
              <Button variant="destructive" size="sm" onClick={() => { setShowBackConfirm(false); closeEditor(); }}>{t("editor.discard")}</Button>
            </div>
          </div>
        </div>
      )}

      {confirmRemoveIdx !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmRemoveIdx(null)}>
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg" onClick={(event) => event.stopPropagation()}>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Remove step</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Remove {workflow.steps[confirmRemoveIdx]?.label || workflow.steps[confirmRemoveIdx]?.id}?
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setConfirmRemoveIdx(null)}>{t("common.cancel")}</Button>
              <Button variant="destructive" size="sm" onClick={() => { removeStep(confirmRemoveIdx); setConfirmRemoveIdx(null); }}>{t("common.remove")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
