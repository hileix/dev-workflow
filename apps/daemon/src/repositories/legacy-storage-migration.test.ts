import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let homeDir = "";
let originalDevWorkflowHome;
let originalHome;
let originalAppData;
let originalXdgConfigHome;

async function loadModules() {
  vi.resetModules();
  const config = await import("./config");
  const migration = await import("./migration");
  return { config, migration };
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2));
}

async function writeText(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, value);
}

describe("legacy storage migration", () => {
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

  test("migrates config, workfolders, skills, and workflows into daemon storage", async () => {
    const { config, migration } = await loadModules();
    const legacyDir = migration.getLegacyDesktopDataDirs()[0];

    await writeJson(join(legacyDir, "config.json"), {
      mobileAccessEnabled: true,
      activeWorkflow: "legacy.json",
      aiApiProfiles: [{
        id: "deepseek",
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        apiKey: "sk-test",
        model: "deepseek-chat",
      }],
      deletedWorkflowFiles: ["deleted.json"],
    });
    await writeJson(join(legacyDir, "tasks", "workfolders.json"), [
      { name: "Legacy", path: "/tmp/legacy", tasks: [] },
    ]);
    await writeJson(join(legacyDir, "workflows", "legacy.json"), {
      id: "legacy",
      name: "Legacy",
      version: 1,
      runtime: { engine: "langgraph", backend: "claude", workspaceAccess: "read", options: {} },
      steps: [{ id: "done", type: "end", label: "Done" }],
    });
    await writeText(join(legacyDir, "skills", "review", "SKILL.md"), [
      "---",
      "name: review",
      "description: Review code",
      "---",
      "",
      "Review the change.",
      "",
    ].join("\n"));

    const result = await migration.migrateLegacyDesktopData();

    expect(result.migrated).toBe(true);
    const migratedConfig = JSON.parse(await readFile(config.CONFIG_FILE, "utf-8"));
    expect(migratedConfig).toMatchObject({
      activeWorkflow: "legacy.json",
      deletedWorkflowFiles: ["deleted.json"],
    });
    expect(migratedConfig.aiBackendOverride).toBeUndefined();
    expect(migratedConfig.mobileAccessEnabled).toBeUndefined();
    expect(migratedConfig.aiApiProfiles).toHaveLength(1);
    expect(migratedConfig.aiApiProfiles[0].id).toBe("deepseek");

    expect(JSON.parse(await readFile(config.getWorkfoldersFile(await config.getBaseDir()), "utf-8"))).toEqual([
      { name: "Legacy", path: "/tmp/legacy", tasks: [] },
    ]);
    expect(await readFile(join(config.getWorkflowDir(), "legacy.json"), "utf-8")).toContain('"name": "Legacy"');
    expect(await readFile(join(config.getSkillsDir(), "review", "SKILL.md"), "utf-8")).toContain("Review the change.");

    await migration.migrateLegacyDesktopData();
    const secondConfig = JSON.parse(await readFile(config.CONFIG_FILE, "utf-8"));
    expect(secondConfig.aiApiProfiles).toHaveLength(1);
  });
});
