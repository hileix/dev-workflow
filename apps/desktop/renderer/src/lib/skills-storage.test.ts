import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
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
  const skills = await import("../../../../../packages/core-models/skills");
  return { config, skills };
}

async function writeSkill(root, slug, name, description, body) {
  const dir = join(root, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    [
      "---",
      `name: "${name}"`,
      `description: "${description}"`,
      "---",
      "",
      body,
      "",
    ].join("\n")
  );
}

describe("managed skills storage", () => {
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

  test("merges system skills with user overrides", async () => {
    const { config, skills } = await loadModules();
    await writeSkill(config.getSystemSkillsDir(), "review", "review", "System review", "system body");
    await writeSkill(config.getSkillsDir(), "review", "review", "User review", "user body");
    await writeSkill(config.getSkillsDir(), "local", "local", "Local only", "local body");

    const managedSkills = await skills.listManagedSkills();
    const review = managedSkills.find((skill) => skill.slug === "review");
    const local = managedSkills.find((skill) => skill.slug === "local");

    expect(review).toMatchObject({ name: "review", description: "User review", body: "user body" });
    expect(local).toMatchObject({ name: "local", description: "Local only", body: "local body" });
    expect(skills.readManagedSkillContentSync("review")).toContain("user body");
  });

  test("stores user deletion markers for system skills", async () => {
    const { config, skills } = await loadModules();
    await writeSkill(config.getSystemSkillsDir(), "review", "review", "System review", "system body");

    await skills.deleteManagedSkill("review");

    expect((await skills.listManagedSkills()).some((skill) => skill.slug === "review")).toBe(false);
    await expect(stat(join(config.getSystemSkillsDir(), "review", "SKILL.md"))).resolves.toBeTruthy();
    expect(await readFile(join(config.getSkillsDir(), "review", ".deleted"), "utf-8")).toBe("");

    await skills.saveManagedSkill({
      name: "review",
      description: "Restored",
      body: "restored body",
    });

    expect(skills.readManagedSkillContentSync("review")).toContain("restored body");
    await expect(stat(join(config.getSkillsDir(), "review", ".deleted"))).rejects.toBeTruthy();
  });
});
