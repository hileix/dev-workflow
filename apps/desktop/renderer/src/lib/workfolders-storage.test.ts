import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let homeDir = "";
let originalUserDataDir;
let originalHome;
let originalAppData;
let originalXdgConfigHome;

async function loadModules() {
  vi.resetModules();
  const config = await import("../../../../../packages/core-models/config");
  const workfolders = await import("../../../../../packages/core-models/workfolders");
  return { config, workfolders };
}

async function writeWorkfolders(file, folders) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(folders, null, 2));
}

describe("workfolders storage", () => {
  beforeEach(async () => {
    originalUserDataDir = process.env.DEV_WORKFLOW_USER_DATA_DIR;
    originalHome = process.env.HOME;
    originalAppData = process.env.APPDATA;
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    homeDir = await mkdtemp(join(tmpdir(), "dev-workflow-home-"));
    delete process.env.DEV_WORKFLOW_USER_DATA_DIR;
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
    if (homeDir) await rm(homeDir, { recursive: true, force: true });
    homeDir = "";
  });

  test("reads workfolders from the shared storage directory", async () => {
    const { config, workfolders } = await loadModules();
    const userBaseDir = await config.getBaseDir();
    const systemBaseDir = config.getSystemBaseDir();

    expect(systemBaseDir).toBe(userBaseDir);

    await writeWorkfolders(config.getWorkfoldersFile(userBaseDir), [
      { name: "Shared User", path: "/tmp/shared", tasks: [{ taskId: "user-task", status: "done" }] },
      { name: "User", path: "/tmp/user", tasks: [] },
    ]);

    expect(await workfolders.readWorkfolders()).toEqual([
      { name: "Shared User", path: "/tmp/shared", tasks: [{ taskId: "user-task", runId: "user-task", status: "done" }] },
      { name: "User", path: "/tmp/user", tasks: [] },
    ]);
  });

  test("removes workfolders directly from the shared storage file", async () => {
    const { config, workfolders } = await loadModules();
    const userBaseDir = await config.getBaseDir();
    await writeWorkfolders(config.getWorkfoldersFile(userBaseDir), [
      { name: "System", path: "/tmp/system", tasks: [] },
    ]);

    expect(await workfolders.removeWorkfolder("/tmp/system")).toEqual([]);

    await workfolders.saveWorkfolders([
      { name: "User", path: "/tmp/user", tasks: [] },
    ]);

    expect(await workfolders.readWorkfolders()).toEqual([
      { name: "User", path: "/tmp/user", tasks: [] },
    ]);
  });
});
