import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import {
  buildWorkflowGraphFromDsl,
  createContentPreview,
  createContentSummary,
  formatStepOutputForPrompt,
  validateWorkflowDsl,
} from "../../packages/core-lib/langgraph-runtime/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dslPath = join(__dirname, "dev-workflow.dsl.json");
const taskDir = join(__dirname, "task-output");

function print(title, value) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(value, null, 2));
}

async function writeMarkdownArtifact(step, content) {
  if (!step.output?.filename || content === undefined) return "";
  const artifactPath = join(taskDir, step.output.filename);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, content, "utf-8");
  return artifactPath;
}

const adapters = {
  async runAgent({ step, agent, state, sessionId }) {
    const nextSessionId = sessionId || `${agent.backend}-session-${Date.now()}`;
    const previous = Object.entries(state.stepOutputs || {})
      .map(([stepId, output]) => formatStepOutputForPrompt(stepId, output))
      .filter(Boolean)
      .join("\n");
    const content = [
      `# ${step.id}`,
      "",
      `Agent backend: ${agent.backend}`,
      `Skill: ${agent.skill || "none"}`,
      `Session ID: ${nextSessionId}`,
      `Task: ${state.contextValues?.task || ""}`,
      previous ? `\n${previous}` : "",
    ].join("\n");

    return {
      sessionId: nextSessionId,
      content,
      summary: createContentSummary(content),
      contentPreview: createContentPreview(content),
      artifactPath: await writeMarkdownArtifact(step, content),
    };
  },
};

const dsl = validateWorkflowDsl(JSON.parse(await readFile(dslPath, "utf-8")));
const graph = buildWorkflowGraphFromDsl(dsl, adapters);
const config = {
  configurable: {
    thread_id: "langgraph-runtime-demo",
  },
};

const first = await graph.invoke(
  {
    taskId: "TASK-001",
    runId: "RUN-001",
    taskDir,
    currentStep: "plan",
    overallStatus: "in_progress",
    contextValues: {
      task: "Create a LangGraph JSON DSL runtime demo",
    },
  },
  config,
);

print("Paused at checkpoint", first);

if (!isInterrupted(first)) {
  throw new Error("Expected workflow to pause at checkpoint");
}

print("Checkpoint payload", first[INTERRUPT][0].value);

const approved = await graph.invoke(
  new Command({
    resume: {
      approved: true,
      notes: "Approved for demo run.",
    },
  }),
  config,
);

print("Completed after approve", approved);

const rejectConfig = {
  configurable: {
    thread_id: "langgraph-runtime-demo-reject",
  },
};

const rejectFirst = await graph.invoke(
  {
    taskId: "TASK-002",
    runId: "RUN-002",
    taskDir,
    currentStep: "plan",
    overallStatus: "in_progress",
    contextValues: {
      task: "Demonstrate reject and loop back to plan",
    },
  },
  rejectConfig,
);

if (!isInterrupted(rejectFirst)) {
  throw new Error("Expected rejected workflow to pause at checkpoint");
}

const rejected = await graph.invoke(
  new Command({
    resume: {
      approved: false,
      notes: "Reject once and return to planning.",
    },
  }),
  rejectConfig,
);

print("Paused again after reject loop", rejected);

if (!isInterrupted(rejected)) {
  throw new Error("Expected workflow to loop back and pause at checkpoint again");
}
