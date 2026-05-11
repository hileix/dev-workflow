const STEP_TYPES = new Set(["agent", "condition", "checkpoint", "end"]);
const RESERVED_STEP_IDS = new Set([
  "taskId",
  "runId",
  "workFolder",
  "taskDir",
  "currentStep",
  "overallStatus",
  "contextValues",
  "sessionMap",
  "stepOutputs",
  "stepArtifacts",
  "stepDecisions",
  "logs",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertObject(value, path) {
  if (!isObject(value)) throw new Error(`${path} must be an object`);
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value.trim();
}

function normalizeOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalStringArray(value, path) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item, index) => assertNonEmptyString(item, `${path}.${index}`));
}

function normalizeOptionalObjectArray(value, path, normalizeItem) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item, index) => normalizeItem(item, `${path}.${index}`));
}

function normalizeOptions(value, path) {
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`${path} must be an object`);
  return value;
}

function normalizeUi(rawUi) {
  if (rawUi === undefined) return { nodePositions: {} };
  if (!isObject(rawUi)) throw new Error("ui must be an object");

  const layout = normalizeOptionalString(rawUi.layout);
  const nodePositions = {};
  if (rawUi.nodePositions !== undefined) {
    if (!isObject(rawUi.nodePositions)) throw new Error("ui.nodePositions must be an object");
    for (const [stepId, position] of Object.entries(rawUi.nodePositions)) {
      if (!isObject(position)) throw new Error(`ui.nodePositions.${stepId} must be an object`);
      const x = Number(position.x);
      const y = Number(position.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`ui.nodePositions.${stepId} must define finite x and y`);
      }
      nodePositions[stepId] = { x, y };
    }
  }

  return {
    ...(layout ? { layout } : {}),
    nodePositions,
  };
}

function normalizeWorkspaceAccess(value, path) {
  const access = normalizeOptionalString(value);
  if (!access) return "";
  if (access !== "read" && access !== "write") throw new Error(`${path} must be read or write`);
  return access;
}

function normalizeAgents(rawAgents) {
  assertObject(rawAgents, "agents");

  const agents = {};
  for (const [agentId, rawAgent] of Object.entries(rawAgents)) {
    const id = assertNonEmptyString(agentId, `agents key`);
    assertObject(rawAgent, `agents.${id}`);
    agents[id] = {
      backend: assertNonEmptyString(rawAgent.backend, `agents.${id}.backend`),
      skill: normalizeOptionalString(rawAgent.skill),
      contextKey: normalizeOptionalString(rawAgent.contextKey),
      model: normalizeOptionalString(rawAgent.model),
      workspaceAccess: normalizeWorkspaceAccess(rawAgent.workspaceAccess, `agents.${id}.workspaceAccess`),
      options: normalizeOptions(rawAgent.options, `agents.${id}.options`),
    };
  }

  if (Object.keys(agents).length === 0) throw new Error("agents must contain at least one agent");
  return agents;
}

function normalizeWorktree(rawWorktree) {
  if (rawWorktree === undefined) {
    return {
      enabled: false,
      files: [],
      customFiles: [],
      removeOnComplete: false,
    };
  }
  if (!isObject(rawWorktree)) throw new Error("worktree must be an object");
  return {
    enabled: Boolean(rawWorktree.enabled),
    files: normalizeOptionalStringArray(rawWorktree.files, "worktree.files"),
    customFiles: normalizeOptionalStringArray(rawWorktree.customFiles, "worktree.customFiles"),
    removeOnComplete: rawWorktree.removeOnComplete === true,
  };
}

function normalizeContextGroups(rawGroups, agents) {
  if (rawGroups === undefined) return [];
  if (!Array.isArray(rawGroups)) throw new Error("contextGroups must be an array");

  const seen = new Set();
  return rawGroups.map((rawGroup, index) => {
    assertObject(rawGroup, `contextGroups.${index}`);
    const id = assertNonEmptyString(rawGroup.id, `contextGroups.${index}.id`);
    if (seen.has(id)) throw new Error(`contextGroups.${index}.id duplicates ${id}`);
    seen.add(id);

    const agent = assertNonEmptyString(rawGroup.agent, `contextGroups.${index}.agent`);
    if (!agents[agent]) throw new Error(`contextGroups.${id}.agent references unknown agent ${agent}`);

    return {
      id,
      label: normalizeOptionalString(rawGroup.label) || id,
      agent,
      sharedSession: rawGroup.sharedSession !== false,
    };
  });
}

function normalizeInput(rawInput, path) {
  assertObject(rawInput, path);
  const sourceType = normalizeOptionalString(rawInput.sourceType) || "workflow_context";
  if (sourceType !== "workflow_context" && sourceType !== "step_output") {
    throw new Error(`${path}.sourceType must be workflow_context or step_output`);
  }
  return {
    name: assertNonEmptyString(rawInput.name, `${path}.name`),
    sourceType,
    contextLabel: normalizeOptionalString(rawInput.contextLabel),
    contextPlaceholder: normalizeOptionalString(rawInput.contextPlaceholder),
    stepId: normalizeOptionalString(rawInput.stepId),
    outputKey: normalizeOptionalString(rawInput.outputKey),
    required: rawInput.required !== false,
  };
}

function normalizeOutput(rawOutput, path) {
  assertObject(rawOutput, path);
  return {
    key: assertNonEmptyString(rawOutput.key || rawOutput.filename, `${path}.key`),
    kind: normalizeOptionalString(rawOutput.kind) || "markdown",
    filename: assertNonEmptyString(rawOutput.filename, `${path}.filename`),
  };
}

function normalizePublishRule(rawRule, path) {
  assertObject(rawRule, path);
  const action = normalizeOptionalString(rawRule.action) || "approve";
  if (action !== "approve" && action !== "reject") throw new Error(`${path}.action must be approve or reject`);
  return {
    action,
    sourceName: assertNonEmptyString(rawRule.sourceName, `${path}.sourceName`),
    asOutputKey: assertNonEmptyString(rawRule.asOutputKey, `${path}.asOutputKey`),
    filename: assertNonEmptyString(rawRule.filename, `${path}.filename`),
  };
}

function normalizeStep(rawStep, index, agents, contextGroupsById) {
  assertObject(rawStep, `steps.${index}`);

  const id = assertNonEmptyString(rawStep.id, `steps.${index}.id`);
  const type = assertNonEmptyString(rawStep.type, `steps.${index}.type`);
  if (!STEP_TYPES.has(type)) throw new Error(`steps.${id}.type must be one of ${Array.from(STEP_TYPES).join(", ")}`);

  const step = {
    id,
    type,
    label: normalizeOptionalString(rawStep.label) || id,
    next: normalizeOptionalString(rawStep.next),
    inputs: normalizeOptionalObjectArray(rawStep.inputs, `steps.${id}.inputs`, normalizeInput),
    outputs: normalizeOptionalObjectArray(rawStep.outputs, `steps.${id}.outputs`, normalizeOutput),
  };

	  if (type === "agent" || type === "condition") {
    const contextGroup = normalizeOptionalString(rawStep.contextGroup);
    const agent = normalizeOptionalString(rawStep.agent);
    if (!agent && !contextGroup) throw new Error(`steps.${id} must define agent or contextGroup`);
    if (agent && !agents[agent]) throw new Error(`steps.${id}.agent references unknown agent ${agent}`);
    if (contextGroup && !contextGroupsById[contextGroup]) {
      throw new Error(`steps.${id}.contextGroup references unknown group ${contextGroup}`);
    }

    const resolvedAgent = contextGroup ? contextGroupsById[contextGroup].agent : agent;
    if (agent && contextGroup && agent !== resolvedAgent) {
      throw new Error(`steps.${id} uses contextGroup ${contextGroup} but agent ${agent} does not match ${resolvedAgent}`);
    }

    step.agent = resolvedAgent;
    step.contextGroup = contextGroup;
    step.skill = normalizeOptionalString(rawStep.skill);
    step.instructions = normalizeOptionalString(rawStep.instructions);
    step.prompt = normalizeOptionalString(rawStep.prompt);
    step.workspaceAccess = normalizeWorkspaceAccess(rawStep.workspaceAccess, `steps.${id}.workspaceAccess`);
    const primaryOutput = isObject(rawStep.output)
      ? normalizeOutput({
          key: rawStep.output.key || rawStep.output.filename || "output",
          kind: rawStep.output.kind || "markdown",
          filename: rawStep.output.filename,
        }, `steps.${id}.output`)
      : step.outputs[0] || null;
    step.output = primaryOutput
      ? {
          ...primaryOutput,
          optional: rawStep.output?.optional !== false,
        }
      : null;
  }

  if (type === "condition") {
    step.passTo = normalizeOptionalString(rawStep.passTo);
    step.failTo = normalizeOptionalString(rawStep.failTo);
    if (!step.passTo && !step.failTo) throw new Error(`steps.${id} must define passTo or failTo`);
  }

  if (type === "checkpoint") {
    step.question = normalizeOptionalString(rawStep.question) || `Approve ${id}?`;
    step.approve = normalizeOptionalString(rawStep.approve);
    const rejectTargets = normalizeOptionalStringArray(rawStep.rejectTargets, `steps.${id}.rejectTargets`);
    const rejectTo = normalizeOptionalString(rawStep.rejectTo) || rejectTargets[0] || "";
    if (!rejectTo) throw new Error(`steps.${id}.rejectTo or rejectTargets must be defined`);
    step.rejectTo = rejectTo;
    step.rejectTargets = rejectTargets.length > 0 ? rejectTargets : [rejectTo];
    step.publish = normalizeOptionalObjectArray(rawStep.publish, `steps.${id}.publish`, normalizePublishRule);
  }

  return step;
}

function assertStepTarget(stepIds, sourceId, targetId, path) {
  if (!targetId) return;
  if (!stepIds.has(targetId)) throw new Error(`${path} for step ${sourceId} references unknown step ${targetId}`);
}

export function validateWorkflowDsl(input) {
  assertObject(input, "workflow DSL");

  const id = assertNonEmptyString(input.id, "id");
  const name = assertNonEmptyString(input.name || input.id, "name");
  const version = Number.isInteger(input.version) ? input.version : 1;
  const runtime = normalizeOptionalString(input.runtime) || "langgraph";
  if (runtime !== "langgraph") throw new Error("runtime must be langgraph");
  const ui = normalizeUi(input.ui);
  const worktree = normalizeWorktree(input.worktree);
  const agents = normalizeAgents(input.agents);
  const contextGroups = normalizeContextGroups(input.contextGroups, agents);
  const contextGroupsById = Object.fromEntries(contextGroups.map((group) => [group.id, group]));

  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error("steps must be a non-empty array");
  }

  const steps = input.steps.map((step, index) => normalizeStep(step, index, agents, contextGroupsById));
  const stepIds = new Set();
  for (const step of steps) {
    if (stepIds.has(step.id)) throw new Error(`steps contains duplicate id ${step.id}`);
    if (RESERVED_STEP_IDS.has(step.id)) throw new Error(`steps.${step.id} uses a reserved runtime state key`);
    stepIds.add(step.id);
  }

  for (const step of steps) {
    assertStepTarget(stepIds, step.id, step.next, "next");
    if (step.type === "condition") {
      assertStepTarget(stepIds, step.id, step.passTo, "passTo");
      assertStepTarget(stepIds, step.id, step.failTo, "failTo");
    }
    if (step.type === "checkpoint") {
      assertStepTarget(stepIds, step.id, step.approve, "approve");
      assertStepTarget(stepIds, step.id, step.rejectTo, "rejectTo");
      for (const target of step.rejectTargets || []) {
        assertStepTarget(stepIds, step.id, target, "rejectTargets");
      }
    }
    for (const input of step.inputs || []) {
      assertStepTarget(stepIds, step.id, input.stepId, "inputs.stepId");
      if (input.sourceType === "step_output") {
        if (!input.stepId) throw new Error(`steps.${step.id}.inputs.${input.name}.stepId is required for step_output`);
        if (!input.outputKey) throw new Error(`steps.${step.id}.inputs.${input.name}.outputKey is required for step_output`);
        const sourceStep = steps.find((item) => item.id === input.stepId);
        const outputKeys = new Set((sourceStep?.outputs || []).map((output) => output.key));
        if (!outputKeys.has(input.outputKey)) {
          throw new Error(`steps.${step.id}.inputs.${input.name}.outputKey references unknown output ${input.stepId}.${input.outputKey}`);
        }
      }
    }
  }

  for (const stepId of Object.keys(ui.nodePositions)) {
    if (!stepIds.has(stepId)) delete ui.nodePositions[stepId];
  }

  return {
    id,
    name,
    version,
    runtime,
    ui,
    worktree,
    agents,
    contextGroups,
    steps,
  };
}
