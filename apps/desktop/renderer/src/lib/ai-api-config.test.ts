import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let configDir = "";
let originalUserDataDir;

async function loadConfigModule() {
  vi.resetModules();
  return import("../../../../../packages/core-models/config");
}

describe("AI API config", () => {
  beforeEach(async () => {
    originalUserDataDir = process.env.DEV_WORKFLOW_USER_DATA_DIR;
    configDir = await mkdtemp(join(tmpdir(), "dev-workflow-config-"));
    process.env.DEV_WORKFLOW_USER_DATA_DIR = configDir;
  });

  afterEach(async () => {
    if (originalUserDataDir === undefined) {
      delete process.env.DEV_WORKFLOW_USER_DATA_DIR;
    } else {
      process.env.DEV_WORKFLOW_USER_DATA_DIR = originalUserDataDir;
    }
    if (configDir) await rm(configDir, { recursive: true, force: true });
    configDir = "";
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
});
