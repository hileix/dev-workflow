import OpenAI from "openai";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, relative, resolve } from "path";
import { readAiApiProfileSync, readAiApiProfilesSync } from "../../repositories/config";
import { appendPhaseInteraction, appendToPhaseFile, readPhaseInteractions, readState, taskDir, updatePhaseStatus, writeState } from "../../repositories/state";
import { createSdkAgentAdapter } from "./sdk-agent-adapter";
import { createContentPreview, createContentSummary, createStepOutputMetadata, formatStepOutputForPrompt } from "./artifacts";

function getOutputByPath(step, artifactPath) {
  const normalizedArtifactPath = resolve(artifactPath);
  for (const output of step.outputs || []) {
    if (!output?.filename) continue;
    if (normalizedArtifactPath.endsWith(output.filename)) return output;
  }
  return null;
}

function resolveOutputPath(taskRunDir, filename, taskInputs) {
  const rendered = String(filename || "").replace(/\{\{(\w+)\}\}/g, (_, key) => taskInputs?.[key] ?? "");
  if (!rendered) return "";
  const outputPath = resolve(taskRunDir, rendered);
  const rel = relative(resolve(taskRunDir), outputPath);
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\")) throw new Error("output filename escapes task directory");
  return outputPath;
}

async function ensureOutputArtifact(taskId, runId, step, content, taskInputs) {
  const output = step.outputs?.[0];
  if (!output?.filename || !content) return "";
  const taskRunDir = await taskDir(taskId, runId);
  const artifactPath = resolveOutputPath(taskRunDir, output.filename, taskInputs);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, content, "utf-8");
  return artifactPath;
}

function renderTemplate(template, state) {
  const vars = {
    taskId: state.taskId || "",
    runId: state.runId || "",
    workFolder: state.workFolder || "",
    taskDir: state.taskDir || "",
    ...(state.taskInputs || {}),
  };
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function renderAiApiPrompt(step, state, inputSections = []) {
  const parts = [];
  const pendingMessage = String(state.pendingMessages?.[step.id] || "").trim();
  if (pendingMessage) {
    parts.push(["# User feedback", "", pendingMessage].join("\n"));
  }
  if (step.instructions) parts.push(renderTemplate(step.instructions, state));
  if (step.prompt) parts.push(renderTemplate(step.prompt, state));
  if (inputSections.length > 0) parts.push(["# Declared inputs", "", inputSections.join("\n\n")].join("\n"));

  const previousOutputs = Object.entries(state.stepOutputs || {})
    .map(([stepId, output]) => formatStepOutputForPrompt(stepId, output))
    .filter(Boolean)
    .join("\n\n");

  parts.push([
    "# Runtime context",
    "",
    `Task ID: ${state.taskId || ""}`,
    `Run ID: ${state.runId || ""}`,
    `Current step: ${step.id}`,
    "",
    "## Task inputs",
    "",
    JSON.stringify(state.taskInputs || {}, null, 2),
    previousOutputs ? `\n## Previous step outputs\n\n${previousOutputs}` : "",
  ].filter(Boolean).join("\n"));

  return parts.filter(Boolean).join("\n\n");
}

function syncStepsFromPhases(state) {
  for (const step of state.steps || []) {
    const phase = state.phases.find((item) => item.id === step.id);
    if (phase) Object.assign(step, phase);
  }
}

function markRunningStepInState(state, phase) {
  const phaseIndex = (state.phases || []).findIndex((item) => item.id === phase);
  for (let i = 0; i < (state.phases || []).length; i += 1) {
    const item = state.phases[i];
    if (item.id === phase) {
      updatePhaseStatus(state, item.id, "in_progress", item.sessionId);
    } else if (phaseIndex >= 0 && i > phaseIndex) {
      updatePhaseStatus(state, item.id, "pending", item.sessionId);
    } else if (item.status === "in_progress" || item.status === "awaiting_input" || item.status === "paused") {
      updatePhaseStatus(state, item.id, "completed", item.sessionId);
    }
  }
  syncStepsFromPhases(state);
}

async function readInputContent(input, state) {
  if (!input) return "";
  if (input.sourceType === "task_input") return state.taskInputs?.[input.name] || "";
  if (input.sourceType !== "step_output" || !input.stepId || !input.outputKey) return "";

  const sourcePath = state.stepOutputs?.[input.stepId]?.outputs?.[input.outputKey]?.artifactPath
    || state.stepOutputs?.[input.stepId]?.artifactPath
    || state.stepArtifacts?.[input.stepId]?.[input.outputKey]
    || (typeof state.stepArtifacts?.[input.stepId] === "string" ? state.stepArtifacts[input.stepId] : "")
    || "";
  if (!sourcePath) return "";

  try {
    return await readFile(sourcePath, "utf-8");
  } catch {
    return "";
  }
}

async function publishCheckpointOutput({ taskId, runId, step, state, rule }) {
  const sourceInput = (step.inputs || []).find((input) => input.name === rule.sourceName);
  const content = await readInputContent(sourceInput, state);
  if (!content) return null;

  const artifactPath = resolveOutputPath(await taskDir(taskId, runId), rule.filename, state.taskInputs);
  if (!artifactPath) return null;

  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, content, "utf-8");

  return {
    key: rule.asOutputKey,
    content,
    artifactPath,
    metadata: createStepOutputMetadata({
      kind: "markdown",
      summary: createContentSummary(content),
      contentPreview: createContentPreview(content),
      artifactPath,
    }),
  };
}

export function createAppSdkAgentAdapter({ taskId, runId, send, workFolder, taskRunDir, imagePaths = [], abortController }) {
  async function markStepRunning(phase) {
    if (!phase) return;
    const state = await readState(taskId, runId);
    state.currentPhase = phase;
    state.currentStep = phase;
    state.overallStatus = "in_progress";

    markRunningStepInState(state, phase);

    await writeState(taskId, state);
  }

  async function appendPhaseStart(phase, backend) {
    try {
      const existingInteractions = await readPhaseInteractions(taskId, phase, runId);
      const startIndexes = existingInteractions
        .filter((item) => item?.type === "phase_start")
        .map((item) => Number(item.runIndex) || 0);
      const lastRunIndex = Math.max(0, ...startIndexes);
      const hasEarlierConversation = existingInteractions.some((item) => item?.type !== "phase_start");
      const runIndex = lastRunIndex > 0 ? lastRunIndex + 1 : hasEarlierConversation ? 2 : 1;
      const interaction = await appendPhaseInteraction(taskId, phase, {
        role: "system",
        type: "phase_start",
        text: "",
        backend,
        runIndex,
      }, runId);
      if (interaction) send({ type: "phase_interaction", phase, interaction });
    } catch {}
  }

  const adapter = createSdkAgentAdapter({
    workFolder,
    taskDir: taskRunDir,
    imagePaths,
    abortController,
    onEvent: async (event) => {
      const phase = event.phase || event.step;
      if (!phase) return;

      if (event.type === "text_delta") {
        send({ type: "text_delta", phase, text: event.text, backend: event.backend });
        await appendPhaseInteraction(taskId, phase, {
          role: "assistant",
          type: "assistant_delta",
          text: event.text,
          backend: event.backend,
        }, runId);
        await appendToPhaseFile(taskId, phase, event.text, runId);
      } else if (event.type === "tool_use") {
        send({ type: "tool_use", phase, name: event.backend, log: event.log });
        await appendPhaseInteraction(taskId, phase, {
          role: "tool",
          type: "tool_use",
          text: event.log,
          backend: event.backend,
        }, runId);
        await appendToPhaseFile(taskId, phase, `\n\n*${event.log || event.backend}*\n\n`, runId);
      } else if (event.type === "session_attached") {
        send({ type: "session_attached", phase, backend: event.backend, sessionId: event.sessionId });
        try {
          const state = await readState(taskId, runId);
          const current = state.phases.find((item) => item.id === phase);
          updatePhaseStatus(state, phase, current?.status || "in_progress", event.sessionId);
          state.sessionMap = {
            ...(state.sessionMap || {}),
            [event.sessionKey || phase]: event.sessionId,
          };
          await writeState(taskId, state);
        } catch {}
      }
    },
  });

  async function runAiApiStep({ step, state }) {
    const profile = step.aiApiProfileId ? readAiApiProfileSync(step.aiApiProfileId) : readAiApiProfilesSync()[0] || null;
    if (!profile) throw new Error(`AI API profile not found: ${step.aiApiProfileId || "none"}`);
    if (!profile.apiKey) throw new Error(`AI API profile ${profile.name} is missing an API key`);
    if (!profile.model) throw new Error(`AI API profile ${profile.name} is missing a model`);

    const backend = `ai-api:${profile.name || profile.id}`;
    await markStepRunning(step.id);
    await appendPhaseStart(step.id, backend);
    send({ type: "backend_selected", phase: step.id, backend, mode: "workflow" });
    const inputSections = [];
    for (const input of step.inputs || []) {
      const content = await readInputContent(input, state);
      if (content) inputSections.push(`## ${input.name}\n\n${content}`);
    }
    const prompt = renderAiApiPrompt(step, state, inputSections);
    const client = new OpenAI({
      apiKey: profile.apiKey,
      baseURL: profile.baseUrl || undefined,
    });
    const completionOptions = abortController?.signal ? { signal: abortController.signal } : {};
    const completion = await client.chat.completions.create({
      model: profile.model,
      messages: [
        {
          role: "system",
          content: step.type === "condition"
            ? "You are a workflow routing node. Return concise output that follows the user's requested format."
            : "You are a workflow agent. Return concise output that follows the user's requested format.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }, completionOptions);
    const content = completion.choices?.[0]?.message?.content || "";
    send({ type: "text_delta", phase: step.id, backend, text: content });
    await appendPhaseInteraction(taskId, step.id, {
      role: "assistant",
      type: "assistant_delta",
      text: content,
      backend,
    }, runId);
    await appendToPhaseFile(taskId, step.id, content, runId);

    const artifactPath = await ensureOutputArtifact(taskId, runId, step, content, state.taskInputs);
    if (artifactPath) {
      const output = getOutputByPath(step, artifactPath) || step.outputs?.[0];
      if (output?.key) send({ type: "phase_artifact", phase: step.id, outputKey: output.key, content });
    }
    const summary = createContentSummary(content);
    const contentPreview = createContentPreview(content);
    const outputs = {};
    for (const output of step.outputs || []) {
      if (!output?.key) continue;
      outputs[output.key] = {
        kind: output.kind || "markdown",
        summary,
        contentPreview,
        artifactPath,
        status: artifactPath ? "ready" : "pending",
      };
    }

    return {
      content,
      summary,
      contentPreview,
      artifactPath,
      outputs,
    };
  }

  return {
    async publishCheckpoint({ step, state, action }) {
      const rules = (step.publish || []).filter((rule) => rule.action === action);
      if (rules.length === 0) return {};

      const stepOutput = {
        kind: "markdown",
        outputs: {},
        status: "ready",
      };
      const stepArtifacts = {};
      const logs = [];

      for (const rule of rules) {
        const published = await publishCheckpointOutput({ taskId, runId, step, state, rule });
        if (!published) continue;
        stepOutput.outputs[published.key] = published.metadata;
        stepArtifacts[published.key] = published.artifactPath;
        send({ type: "phase_artifact", phase: step.id, outputKey: published.key, content: published.content });
        logs.push(`publish:${step.id}:${published.key}`);
      }

      if (Object.keys(stepOutput.outputs).length === 0) return {};
      const firstOutput = Object.values(stepOutput.outputs)[0];
      return {
        stepOutputs: {
          [step.id]: {
            ...stepOutput,
            summary: firstOutput.summary,
            contentPreview: firstOutput.contentPreview,
            artifactPath: firstOutput.artifactPath,
          },
        },
        stepArtifacts: {
          [step.id]: stepArtifacts,
        },
        logs,
      };
    },

    async runAgent({ step, agent, state, sessionId, sessionKey }) {
      const runtimeSessionKey = sessionKey || step.id;
      if (agent.backend === "ai_api") return runAiApiStep({ step, state });
      await markStepRunning(step.id);
      await appendPhaseStart(step.id, agent.backend);
      send({ type: "backend_selected", phase: step.id, backend: agent.backend, mode: "workflow" });
      const result = await adapter.runAgent({
        step,
        agent,
        state,
        sessionId,
        sessionKey: runtimeSessionKey,
      });
      const artifactPath = result.artifactPath || "";
      if (artifactPath) {
        const output = getOutputByPath(step, artifactPath) || step.outputs?.[0];
        if (output?.key) {
          let content = "";
          try {
            content = await readFile(artifactPath, "utf-8");
          } catch {}
          if (!content) content = result.content || "";
          send({ type: "phase_artifact", phase: step.id, outputKey: output.key, content });
        }
      }

      return {
        ...result,
        artifactPath,
      };
    },

    async runAiApi({ step, state }) {
      return runAiApiStep({ step, state });
    },
  };
}
