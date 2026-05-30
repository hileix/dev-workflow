import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let testHomeDir = "";
let originalDevWorkflowHome;
let originalHome;
let originalAppData;
let originalXdgConfigHome;

async function loadConfigModule() {
  vi.resetModules();
  return import("./config");
}

describe("AI API config", () => {
  beforeEach(async () => {
    originalDevWorkflowHome = process.env.DEV_WORKFLOW_HOME;
    originalHome = process.env.HOME;
    originalAppData = process.env.APPDATA;
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    testHomeDir = await mkdtemp(join(tmpdir(), "dev-workflow-home-"));
    delete process.env.DEV_WORKFLOW_HOME;
    process.env.HOME = testHomeDir;
    process.env.APPDATA = join(testHomeDir, "AppData", "Roaming");
    process.env.XDG_CONFIG_HOME = join(testHomeDir, ".config");
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
    if (testHomeDir) await rm(testHomeDir, { recursive: true, force: true });
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

  test("uses one shared config file for user and system settings", async () => {
    const { CONFIG_FILE, SYSTEM_CONFIG_FILE, getDefaultDaemonDataDir, getSystemDaemonDataDir } = await loadConfigModule();

    expect(getSystemDaemonDataDir()).toBe(getDefaultDaemonDataDir());
    expect(SYSTEM_CONFIG_FILE).toBe(CONFIG_FILE);
  });
});
