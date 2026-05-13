import { Annotation, Command, END, MemorySaver, START, StateGraph, interrupt } from "@langchain/langgraph";
import { normalizeStepOutputMetadata, hasStepOutputResult } from "./artifacts";

const WorkflowRuntimeState = Annotation.Root({
  taskId: Annotation({ default: () => "" }),
  runId: Annotation({ default: () => "" }),
  workFolder: Annotation({ default: () => "" }),
  taskDir: Annotation({ default: () => "" }),
  currentStep: Annotation({ default: () => "" }),
  overallStatus: Annotation({ default: () => "pending" }),
  contextValues: Annotation({ default: () => ({}) }),
  sessionMap: Annotation({ default: () => ({}) }),
  stepOutputs: Annotation({ default: () => ({}) }),
  stepArtifacts: Annotation({ default: () => ({}) }),
  stepDecisions: Annotation({ default: () => ({}) }),
  pendingMessages: Annotation({ default: () => ({}) }),
  pendingImagePaths: Annotation({ default: () => ({}) }),
  logs: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

function getAgentForStep(dsl, step) {
  return dsl.agents[step.agent];
}

function getSessionKey(step, dsl) {
  if (!step.contextGroup) return step.id;
  const group = (dsl.contextGroups || []).find((item) => item.id === step.contextGroup);
  return group?.sharedSession === false ? step.id : step.contextGroup;
}

function getNextStepId(step) {
  if (!step) return "";
  if (step.type === "condition") return step.passTo || step.failTo || "";
  if (step.type === "checkpoint") return step.approve || step.rejectTo || "";
  return step.next || "";
}

async function runAgentStep(step, dsl, adapters, state) {
  const agent = getAgentForStep(dsl, step);
  const sessionKey = getSessionKey(step, dsl);
  const currentSessionId = state.sessionMap?.[sessionKey] || "";
  const result = await adapters.runAgent({
    step,
    agent,
    state,
    sessionId: currentSessionId,
  });

  const nextSessionMap = { ...(state.sessionMap || {}) };
  if (result?.sessionId) nextSessionMap[sessionKey] = result.sessionId;

  const nextOutputs = { ...(state.stepOutputs || {}) };
  const nextArtifacts = { ...(state.stepArtifacts || {}) };
  if (hasStepOutputResult(result)) nextOutputs[step.id] = normalizeStepOutputMetadata(result);
  if (result?.artifactPath) nextArtifacts[step.id] = result.artifactPath;
  const nextPendingMessages = { ...(state.pendingMessages || {}) };
  const nextPendingImagePaths = { ...(state.pendingImagePaths || {}) };
  nextPendingMessages[step.id] = "";
  nextPendingImagePaths[step.id] = [];

  return {
    result,
    update: {
      currentStep: getNextStepId(step) || step.id,
      overallStatus: step.next ? "in_progress" : "completed",
      sessionMap: nextSessionMap,
      stepOutputs: nextOutputs,
      stepArtifacts: nextArtifacts,
      pendingMessages: nextPendingMessages,
      pendingImagePaths: nextPendingImagePaths,
      logs: [`agent:${step.id}:${agent.backend}`],
    },
  };
}

function createAgentNode(step, dsl, adapters) {
  return async (state) => {
    const { update } = await runAgentStep(step, dsl, adapters, state);
    return update;
  };
}

function parseConditionDecision(content) {
  const raw = String(content || "").trim();
  if (!raw) return { passed: false, reason: "" };

  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch?.[1]?.trim() || objectMatch?.[0]?.trim() || raw;
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed === "boolean") return { passed: parsed, reason: "" };
    if (parsed && typeof parsed === "object") {
      const value = parsed.passed ?? parsed.pass ?? parsed.approved ?? parsed.ok ?? parsed.result;
      const passed = typeof value === "boolean"
        ? value
        : ["pass", "passed", "approve", "approved", "ok", "true", "yes"].includes(String(value || "").toLowerCase());
      return {
        passed,
        reason: String(parsed.reason || parsed.summary || parsed.notes || ""),
      };
    }
  } catch {}

  const normalized = raw.toLowerCase();
  return {
    passed: /\b(pass|passed|approve|approved|ok|true|yes)\b/.test(normalized)
      && !/\b(fail|failed|reject|rejected|false|no)\b/.test(normalized),
    reason: raw,
  };
}

function createConditionNode(step, dsl, adapters) {
  return async (state) => {
    const { result, update } = await runAgentStep(step, dsl, adapters, state);
    const decision = parseConditionDecision(result.content || update.stepOutputs?.[step.id]?.contentPreview || "");
    return {
      ...update,
      currentStep: decision.passed ? step.passTo || step.id : step.failTo || step.id,
      overallStatus: decision.passed ? (step.passTo ? "in_progress" : "completed") : (step.failTo ? "in_progress" : "completed"),
      stepDecisions: {
        ...(state.stepDecisions || {}),
        [step.id]: {
          passed: decision.passed,
          reason: decision.reason,
          passTo: decision.passed ? step.passTo || "" : "",
          failTo: decision.passed ? "" : step.failTo || "",
        },
      },
      logs: [
        ...(update.logs || []),
        `condition:${step.id}:${decision.passed ? "pass" : "fail"}`,
      ],
    };
  };
}

function createCheckpointNode(step, adapters) {
  return async (state) => {
    const decision = interrupt({
      stepId: step.id,
      type: "checkpoint",
      question: step.question,
      state: {
        taskId: state.taskId,
        runId: state.runId,
        currentStep: state.currentStep,
        stepOutputs: state.stepOutputs,
        stepArtifacts: state.stepArtifacts,
      },
    });

    const approved = Boolean(decision?.approved);
    const requestedRejectTo = decision?.rejectTo || step.rejectTo;
    const rejectTo = (step.rejectTargets || []).includes(requestedRejectTo) ? requestedRejectTo : step.rejectTo;
    const pendingMessages = { ...(state.pendingMessages || {}) };
    const pendingImagePaths = { ...(state.pendingImagePaths || {}) };
    if (!approved && decision?.notes) pendingMessages[rejectTo] = decision.notes;
    const published = adapters.publishCheckpoint
      ? await adapters.publishCheckpoint({
          step,
          state,
          action: approved ? "approve" : "reject",
          decision,
        })
      : {};
    const nextOutputs = {
      ...(state.stepOutputs || {}),
      ...(published.stepOutputs || {}),
    };
    const nextArtifacts = {
      ...(state.stepArtifacts || {}),
      ...(published.stepArtifacts || {}),
    };
    const update = {
      currentStep: approved ? step.approve || step.id : rejectTo || step.id,
      overallStatus: approved ? "in_progress" : "awaiting_input",
      stepOutputs: nextOutputs,
      stepArtifacts: nextArtifacts,
      pendingMessages,
      pendingImagePaths,
      stepDecisions: {
        ...(state.stepDecisions || {}),
        [step.id]: {
          approved,
          notes: decision?.notes || "",
          rejectTo: approved ? "" : rejectTo,
        },
      },
      logs: [
        `checkpoint:${step.id}:${approved ? "approved" : "rejected"}`,
        ...(published.logs || []),
      ],
    };
    return approved && !step.approve
      ? new Command({
          update: {
            ...update,
            currentStep: step.id,
            overallStatus: "completed",
          },
          goto: END,
        })
      : update;
  };
}

function createEndNode(step) {
  return async (state) => ({
    currentStep: step.id,
    overallStatus: "completed",
    sessionMap: state.sessionMap || {},
    stepOutputs: state.stepOutputs || {},
    stepArtifacts: state.stepArtifacts || {},
    stepDecisions: state.stepDecisions || {},
    pendingMessages: state.pendingMessages || {},
    pendingImagePaths: state.pendingImagePaths || {},
    logs: [`end:${step.id}`],
  });
}

function createNode(step, dsl, adapters) {
  if (step.type === "agent") return createAgentNode(step, dsl, adapters);
  if (step.type === "condition") return createConditionNode(step, dsl, adapters);
  if (step.type === "checkpoint") return createCheckpointNode(step, adapters);
  if (step.type === "end") return createEndNode(step);
  throw new Error(`unsupported step type ${step.type}`);
}

function createCheckpointRouter(step) {
  return (state) => {
    const decision = state.stepDecisions?.[step.id];
    return decision?.approved ? step.approve || END : decision?.rejectTo || step.rejectTo;
  };
}

function createConditionRouter(step) {
  return (state) => {
    const decision = state.stepDecisions?.[step.id];
    return decision?.passed ? step.passTo || END : step.failTo || END;
  };
}

export function createMemoryCheckpointer() {
  return new MemorySaver();
}

export function buildWorkflowGraphFromDsl(dsl, adapters, options = {}) {
  if (!adapters?.runAgent) throw new Error("adapters.runAgent is required");
  const builder = new StateGraph(WorkflowRuntimeState);

  for (const step of dsl.steps) {
    builder.addNode(step.id, createNode(step, dsl, adapters));
  }

  builder.addEdge(START, dsl.steps[0].id);

  for (const step of dsl.steps) {
    if (step.type === "checkpoint") {
      builder.addConditionalEdges(step.id, createCheckpointRouter(step), [step.approve || END, ...(step.rejectTargets || [step.rejectTo])]);
      continue;
    }

    if (step.type === "condition") {
      builder.addConditionalEdges(step.id, createConditionRouter(step), [step.passTo || END, step.failTo || END]);
      continue;
    }

    if (step.type === "end" || !step.next) {
      builder.addEdge(step.id, END);
    } else {
      builder.addEdge(step.id, step.next);
    }
  }

  return builder.compile({
    checkpointer: options.checkpointer || createMemoryCheckpointer(),
  });
}
