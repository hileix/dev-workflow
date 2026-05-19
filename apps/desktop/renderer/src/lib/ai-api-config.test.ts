import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let configDir = "";
let testHomeDir = "";
let originalUserDataDir;
let originalHome;
let originalAppData;
let originalXdgConfigHome;

async function loadConfigModule() {
  vi.resetModules();
  return import("../../../../../packages/core-models/config");
}

function getTestAppDataDir(homeDir) {
  if (process.platform === "darwin") {
    return join(homeDir, "Library", "Application Support", "dev-Workflow");
  }
  if (process.platform === "win32") {
    return join(homeDir, "AppData", "Roaming", "dev-Workflow");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homeDir, ".config"), "dev-Workflow");
}

describe("AI API config", () => {
  beforeEach(async () => {
    originalUserDataDir = process.env.DEV_WORKFLOW_USER_DATA_DIR;
    originalHome = process.env.HOME;
    originalAppData = process.env.APPDATA;
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    configDir = await mkdtemp(join(tmpdir(), "dev-workflow-config-"));
    testHomeDir = await mkdtemp(join(tmpdir(), "dev-workflow-home-"));
    process.env.DEV_WORKFLOW_USER_DATA_DIR = configDir;
    process.env.HOME = testHomeDir;
    process.env.APPDATA = join(testHomeDir, "AppData", "Roaming");
    process.env.XDG_CONFIG_HOME = join(testHomeDir, ".config");
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
    if (configDir) await rm(configDir, { recursive: true, force: true });
    if (testHomeDir) await rm(testHomeDir, { recursive: true, force: true });
    configDir = "";
    testHomeDir = "";
  });

  test("saves AI API profiles with a default OpenAI-compatible base URL and redacts keys for UI", async () => {
    const { readAiApiProfiles, readAiApiProfilesForUi, saveAiApiProfile } = await loadConfigModule();

    const uiProfiles = await saveAiApiProfile({
      name: "OpenAI",
      apiKey: " sk-test ",
      model: " gpt-5.2 ",
    });

    expect(uiProfiles).toEqual([
      {
        id: "openai",
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.2",
        hasApiKey: true,
      },
    ]);
    expect(uiProfiles[0]).not.toHaveProperty("apiKey");

    const storedProfiles = await readAiApiProfiles();
    expect(storedProfiles[0].apiKey).toBe("sk-test");
    expect(await readAiApiProfilesForUi()).toEqual(uiProfiles);
  });

  test("keeps the existing key when editing a profile without entering a new key", async () => {
    const { readAiApiProfiles, saveAiApiProfile } = await loadConfigModule();

    await saveAiApiProfile({
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-original",
      model: "gpt-5.2",
    });
    await saveAiApiProfile({
      id: "openai",
      name: "OpenAI",
      baseUrl: "https://gateway.example/v1",
      apiKey: "",
      model: "gpt-5.3",
    });

    expect(await readAiApiProfiles()).toEqual([
      {
        id: "openai",
        name: "OpenAI",
        baseUrl: "https://gateway.example/v1",
        apiKey: "sk-original",
        model: "gpt-5.3",
      },
    ]);
  });

  test("deletes AI API profiles by normalized id", async () => {
    const { deleteAiApiProfile, readAiApiProfiles, saveAiApiProfile } = await loadConfigModule();

    await saveAiApiProfile({ name: "OpenAI", apiKey: "sk-openai", model: "gpt-5.2" });
    await saveAiApiProfile({ name: "Local Router", apiKey: "sk-local", model: "local-model" });

    const remainingProfiles = await deleteAiApiProfile("Local Router");

    expect(remainingProfiles.map((profile) => profile.id)).toEqual(["openai"]);
    expect(await readAiApiProfiles()).toHaveLength(1);
  });

  test("merges system AI API profiles with user overrides", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "dev-workflow-home-"));
    process.env.HOME = homeDir;
    process.env.APPDATA = join(homeDir, "AppData", "Roaming");
    delete process.env.DEV_WORKFLOW_USER_DATA_DIR;
    const appDataDir = getTestAppDataDir(homeDir);
    await mkdir(appDataDir, { recursive: true });
    await writeFile(
      join(appDataDir, "config.json"),
      JSON.stringify({
        aiBackendOverride: "codex",
        aiApiProfiles: [
          {
            id: "deepseek",
            name: "deepseek",
            baseUrl: "https://api.deepseek.com",
            apiKey: "sk-deepseek",
            model: "deepseek-v4-flash",
          },
        ],
      }, null, 2)
    );

    const { CONFIG_FILE, readAiApiProfilesForUi, readAiBackendOverride, saveAiApiProfile } = await loadConfigModule();

    expect(await readAiBackendOverride()).toBe("codex");
    expect(await readAiApiProfilesForUi()).toEqual([
      {
        id: "deepseek",
        name: "deepseek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        hasApiKey: true,
      },
    ]);

    await saveAiApiProfile({
      id: "deepseek",
      name: "deepseek",
      baseUrl: "https://gateway.example/v1",
      apiKey: "",
      model: "deepseek-chat",
    });

    expect(await readAiApiProfilesForUi()).toEqual([
      {
        id: "deepseek",
        name: "deepseek",
        baseUrl: "https://gateway.example/v1",
        model: "deepseek-chat",
        hasApiKey: true,
      },
    ]);
    expect(JSON.parse(await readFile(CONFIG_FILE, "utf-8")).aiApiProfiles).toHaveLength(1);

    await rm(homeDir, { recursive: true, force: true });
  });

  test("stores a user deletion marker for system AI API profiles", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "dev-workflow-home-"));
    process.env.HOME = homeDir;
    process.env.APPDATA = join(homeDir, "AppData", "Roaming");
    delete process.env.DEV_WORKFLOW_USER_DATA_DIR;
    const appDataDir = getTestAppDataDir(homeDir);
    await mkdir(appDataDir, { recursive: true });
    await writeFile(
      join(appDataDir, "config.json"),
      JSON.stringify({
        aiApiProfiles: [
          {
            id: "deepseek",
            name: "deepseek",
            baseUrl: "https://api.deepseek.com",
            apiKey: "sk-deepseek",
            model: "deepseek-v4-flash",
          },
        ],
      }, null, 2)
    );

    const { CONFIG_FILE, deleteAiApiProfile, readAiApiProfilesForUi } = await loadConfigModule();

    expect(await deleteAiApiProfile("deepseek")).toEqual([]);
    expect(await readAiApiProfilesForUi()).toEqual([]);
    expect(JSON.parse(await readFile(CONFIG_FILE, "utf-8")).deletedAiApiProfileIds).toEqual(["deepseek"]);

    await rm(homeDir, { recursive: true, force: true });
  });
});
