import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let userDataDir = "";
let homeDir = "";
let originalUserDataDir;
let originalHome;
let originalAppData;
let originalXdgConfigHome;

async function loadModules() {
  vi.resetModules();
  const config = await import("../../../../../packages/core-models/config");
  const workflow = await import("../../../../../packages/core-models/workflow");
  return { config, workflow };
}

function buildWorkflow(name) {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    version: 1,
    runtime: {
      engine: "langgraph",
      backend: "claude",
      workspaceAccess: "read",
      options: {},
    },
    steps: [
      {
        id: "done",
        type: "end",
        label: "Done",
      },
    ],
  };
}

async function writeWorkflow(dir, filename, name) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), JSON.stringify(buildWorkflow(name), null, 2));
}

describe("workflow storage", () => {
  beforeEach(async () => {
    originalUserDataDir = process.env.DEV_WORKFLOW_USER_DATA_DIR;
    originalHome = process.env.HOME;
    originalAppData = process.env.APPDATA;
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    userDataDir = await mkdtemp(join(tmpdir(), "dev-workflow-user-data-"));
    homeDir = await mkdtemp(join(tmpdir(), "dev-workflow-home-"));
    process.env.DEV_WORKFLOW_USER_DATA_DIR = userDataDir;
    process.env.HOME = homeDir;
    process.env.APPDATA = join(homeDir, "AppData", "Roaming");
    process.env.XDG_CONFIG_HOME = join(homeDir, ".config");
  });

  afterEach(async () => {
    if (originalUserDataDir === undefined) {
      delete process.env.DEV_WORKFLOW_USER_DATA_DIR;
    } else {
      process.env.DEV_WORKFLOW_USER_DATA_DIR = originalUserDataDir;
    }
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
    if (homeDir) await rm(homeDir, { recursive: true, force: true });
    userDataDir = "";
    homeDir = "";
  });

  test("uses user workflows before system workflows", async () => {
    const { config, workflow } = await loadModules();
    await writeWorkflow(config.getSystemWorkflowDir(), "default.json", "System Default");
    await writeWorkflow(config.getWorkflowDir(), "default.json", "User Default");
    await writeWorkflow(config.getSystemWorkflowDir(), "system-only.json", "System Only");

    expect(workflow.getWorkflowFilePath("default.json")).toBe(join(config.getWorkflowDir(), "default.json"));
    expect(workflow.getWorkflowFilePath("system-only.json")).toBe(join(config.getSystemWorkflowDir(), "system-only.json"));
    expect(workflow.readWorkflowFileSync("default.json").name).toBe("User Default");
  });
});
