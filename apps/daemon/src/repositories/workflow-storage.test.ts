import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let homeDir = "";
let originalDevWorkflowHome;
let originalHome;
let originalAppData;
let originalXdgConfigHome;

async function loadModules() {
  vi.resetModules();
  const config = await import("./config");
  const workflow = await import("./workflow");
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
    originalDevWorkflowHome = process.env.DEV_WORKFLOW_HOME;
    originalHome = process.env.HOME;
    originalAppData = process.env.APPDATA;
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    homeDir = await mkdtemp(join(tmpdir(), "dev-workflow-home-"));
    delete process.env.DEV_WORKFLOW_HOME;
    process.env.HOME = homeDir;
    process.env.APPDATA = join(homeDir, "AppData", "Roaming");
    process.env.XDG_CONFIG_HOME = join(homeDir, ".config");
  });

  afterEach(async () => {
    if (originalDevWorkflowHome === undefined) {
      delete process.env.DEV_WORKFLOW_HOME;
    } else {
      process.env.DEV_WORKFLOW_HOME = originalDevWorkflowHome;
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
    if (homeDir) await rm(homeDir, { recursive: true, force: true });
    homeDir = "";
  });

  test("uses the shared workflow directory", async () => {
    const { config, workflow } = await loadModules();

    expect(config.getSystemWorkflowDir()).toBe(config.getWorkflowDir());

    await writeWorkflow(config.getWorkflowDir(), "default.json", "User Default");

    expect(workflow.getWorkflowFilePath("default.json")).toBe(join(config.getWorkflowDir(), "default.json"));
    expect(workflow.readWorkflowFileSync("default.json").name).toBe("User Default");
  });
});
