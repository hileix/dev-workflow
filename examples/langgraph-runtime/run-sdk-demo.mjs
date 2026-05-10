import { mkdir, readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import {
  buildWorkflowGraphFromDsl,
  createSdkAgentAdapter,
  validateWorkflowDsl,
} from "../../packages/core-lib/langgraph-runtime/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dslPath = join(__dirname, "dev-workflow.sdk.dsl.json");
const taskDir = join(__dirname, "sdk-task-output");
const workFolder = join(__dirname, "..", "..");

function print(title, value) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(value, null, 2));
}

if (process.env.RUN_SDK_DEMO !== "1") {
  console.log("Set RUN_SDK_DEMO=1 to run the real Claude/Codex SDK demo.");
  console.log("This script imports and wires the SDK adapter, but does not launch SDK processes by default.");
  process.exit(0);
}

await mkdir(taskDir, { recursive: true });

const dsl = validateWorkflowDsl(JSON.parse(await readFile(dslPath, "utf-8")));
const adapter = createSdkAgentAdapter({
  workFolder,
  taskDir,
  onEvent: (event) => {
    console.log(`[event] ${event.type} ${event.step || ""}`);
  },
});
const graph = buildWorkflowGraphFromDsl(dsl, adapter);
const config = {
  configurable: {
    thread_id: "langgraph-runtime-sdk-demo",
  },
};

const first = await graph.invoke(
  {
    taskId: "SDK-TASK-001",
    runId: "SDK-RUN-001",
    workFolder,
    taskDir,
    currentStep: "plan",
    overallStatus: "in_progress",
    contextValues: {
      task: "Create a short LangGraph runtime SDK smoke test artifact",
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
      notes: "Approved SDK demo run.",
    },
  }),
  config,
);

print("Completed after approve", approved);
