import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, relative, resolve } from "path";
import { readManagedSkillContentSync } from "../../core-models/skills.mjs";
import { appendPhaseInteraction, appendToPhaseFile, readState, taskDir, updatePhaseStatus, writeState } from "../../core-models/state.mjs";
import { createSdkAgentAdapter } from "./sdk-agent-adapter.mjs";
import { createContentPreview, createContentSummary, createStepOutputMetadata } from "./artifacts.mjs";

function getOutputByPath(step, artifactPath) {
  const normalizedArtifactPath = resolve(artifactPath);
  for (const output of step.outputs || []) {
    if (!output?.filename) continue;
    if (normalizedArtifactPath.endsWith(output.filename)) return output;
  }
  return null;
}

function resolveOutputPath(taskRunDir, filename, contextValues) {
  const rendered = String(filename || "").replace(/\{\{(\w+)\}\}/g, (_, key) => contextValues?.[key] ?? "");
  if (!rendered) return "";
  const outputPath = resolve(taskRunDir, rendered);
  const rel = relative(resolve(taskRunDir), outputPath);
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\")) throw new Error("output filename escapes task directory");
  return outputPath;
}

function getSessionKey(step) {
  return step.contextGroup || step.id;
}

async function ensureOutputArtifact(taskId, runId, step, content, contextValues) {
  const output = step.outputs?.[0];
  if (!output?.filename || !content) return "";
  const taskRunDir = await taskDir(taskId, runId);
  const artifactPath = resolveOutputPath(taskRunDir, output.filename, contextValues);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, content, "utf-8");
  return artifactPath;
}

async function readInputContent(input, state) {
  if (!input) return "";
  if (input.sourceType === "workflow_context") return state.contextValues?.[input.name] || "";
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

  const artifactPath = resolveOutputPath(await taskDir(taskId, runId), rule.filename, state.contextValues);
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

export function createAppSdkAgentAdapter({ taskId, runId, send, workFolder, taskRunDir, imagePaths = [], abortController, aiBackendOverride = "" }) {
  const adapter = createSdkAgentAdapter({
    workFolder,
    taskDir: taskRunDir,
    imagePaths,
    abortController,
    readSkillContentSync: readManagedSkillContentSync,
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
      const runtimeSessionKey = sessionKey || getSessionKey(step);
      const runtimeAgent = aiBackendOverride ? { ...agent, backend: aiBackendOverride, model: "" } : agent;
      send({ type: "backend_selected", phase: step.id, backend: runtimeAgent.backend, mode: aiBackendOverride ? "app" : "workflow" });
      const result = await adapter.runAgent({
        step,
        agent: runtimeAgent,
        state,
        sessionId,
        sessionKey: runtimeSessionKey,
      });
      const artifactPath = result.artifactPath || await ensureOutputArtifact(taskId, runId, step, result.content, state.contextValues);
      if (artifactPath) {
        const output = getOutputByPath(step, artifactPath) || step.outputs?.[0];
        if (output?.key) {
          let content = result.content || "";
          if (!content) {
            try {
              content = await readFile(artifactPath, "utf-8");
            } catch {}
          }
          send({ type: "phase_artifact", phase: step.id, outputKey: output.key, content });
        }
      }

      return {
        ...result,
        artifactPath,
      };
    },
  };
}
