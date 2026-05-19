import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let userDataDir = "";
let homeDir = "";
let originalUserDataDir;
let originalHome;
let originalAppData;

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
    userDataDir = await mkdtemp(join(tmpdir(), "dev-workflow-user-data-"));
    homeDir = await mkdtemp(join(tmpdir(), "dev-workflow-home-"));
    process.env.DEV_WORKFLOW_USER_DATA_DIR = userDataDir;
    process.env.HOME = homeDir;
    process.env.APPDATA = join(homeDir, "AppData", "Roaming");
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
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
    if (homeDir) await rm(homeDir, { recursive: true, force: true });
    userDataDir = "";
    homeDir = "";
  });

  test("merges system workfolders with user folders", async () => {
    const { config, workfolders } = await loadModules();
    const userBaseDir = await config.getBaseDir();
    const systemBaseDir = config.getSystemBaseDir();
    await writeWorkfolders(config.getWorkfoldersFile(systemBaseDir), [
      { name: "System", path: "/tmp/system", tasks: [{ taskId: "system-task", status: "running" }] },
      { name: "Shared", path: "/tmp/shared", tasks: [] },
    ]);
    await writeWorkfolders(config.getWorkfoldersFile(userBaseDir), [
      { name: "Shared User", path: "/tmp/shared", tasks: [{ taskId: "user-task", status: "done" }] },
      { name: "User", path: "/tmp/user", tasks: [] },
    ]);

    expect(await workfolders.readWorkfolders()).toEqual([
      { name: "System", path: "/tmp/system", tasks: [] },
      { name: "Shared User", path: "/tmp/shared", tasks: [{ taskId: "user-task", runId: "user-task", status: "done" }] },
      { name: "User", path: "/tmp/user", tasks: [] },
    ]);
  });

  test("stores user deletion markers for system workfolders", async () => {
    const { config, workfolders } = await loadModules();
    const userBaseDir = await config.getBaseDir();
    const systemBaseDir = config.getSystemBaseDir();
    await writeWorkfolders(config.getWorkfoldersFile(systemBaseDir), [
      { name: "System", path: "/tmp/system", tasks: [] },
    ]);

    expect(await workfolders.removeWorkfolder("/tmp/system")).toEqual([]);
    expect(JSON.parse(await readFile(config.getWorkfoldersFile(userBaseDir), "utf-8"))).toEqual([
      { name: "System", path: "/tmp/system", tasks: [], deleted: true },
    ]);

    await workfolders.saveWorkfolders([
      { name: "User", path: "/tmp/user", tasks: [] },
    ]);

    expect(await workfolders.readWorkfolders()).toEqual([
      { name: "User", path: "/tmp/user", tasks: [] },
    ]);
    expect(JSON.parse(await readFile(config.getWorkfoldersFile(userBaseDir), "utf-8"))).toEqual([
      { name: "System", path: "/tmp/system", tasks: [], deleted: true },
      { name: "User", path: "/tmp/user", tasks: [] },
    ]);
  });
});
