import { basename, join, resolve } from "path";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import os from "os";
import {
  CONFIG_FILE,
  getBaseDir,
  getDaemonStorageDir,
  getSkillsDir,
  getWorkflowDir,
  getWorkfoldersFile,
} from "./config";

async function pathExists(path) {
  return Boolean(await stat(path).catch(() => null));
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return fallback;
  }
}

async function writeJsonIfChanged(path, value) {
  const next = JSON.stringify(value, null, 2);
  const current = await readFile(path, "utf-8").catch(() => "");
  if (current.trim() === next.trim()) return false;
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${next}\n`);
  return true;
}

function uniquePaths(paths) {
  const seen = new Set();
  return paths.filter((path) => {
    const key = resolve(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getLegacyDesktopDataDirs() {
  const names = ["dev-Workflow", "dev-workflow"];
  if (process.platform === "darwin") {
    return uniquePaths(names.map((name) => join(os.homedir(), "Library", "Application Support", name)));
  }
  if (process.platform === "win32") {
    const baseDir = process.env.APPDATA || join(os.homedir(), "AppData", "Roaming");
    return uniquePaths(names.map((name) => join(baseDir, name)));
  }
  const baseDir = process.env.XDG_CONFIG_HOME || join(os.homedir(), ".config");
  return uniquePaths(names.map((name) => join(baseDir, name)));
}

function isSamePath(a, b) {
  return resolve(a) === resolve(b);
}

function mergeConfig(targetConfig, legacyConfig) {
  const nextConfig = { ...targetConfig };
  if (!nextConfig.activeWorkflow && legacyConfig.activeWorkflow) {
    nextConfig.activeWorkflow = legacyConfig.activeWorkflow;
  }

  const profilesById = new Map();
  for (const profile of Array.isArray(legacyConfig.aiApiProfiles) ? legacyConfig.aiApiProfiles : []) {
    if (profile?.id) profilesById.set(profile.id, profile);
  }
  for (const profile of Array.isArray(targetConfig.aiApiProfiles) ? targetConfig.aiApiProfiles : []) {
    if (profile?.id) profilesById.set(profile.id, profile);
  }
  if (profilesById.size > 0) nextConfig.aiApiProfiles = Array.from(profilesById.values());

  const deletedWorkflowFiles = new Set([
    ...(Array.isArray(legacyConfig.deletedWorkflowFiles) ? legacyConfig.deletedWorkflowFiles : []),
    ...(Array.isArray(targetConfig.deletedWorkflowFiles) ? targetConfig.deletedWorkflowFiles : []),
  ]);
  if (deletedWorkflowFiles.size > 0) nextConfig.deletedWorkflowFiles = Array.from(deletedWorkflowFiles);

  delete nextConfig.mobileAccessEnabled;
  return nextConfig;
}

function mergeWorkfolders(targetFolders, legacyFolders) {
  const foldersByPath = new Map();
  for (const folder of Array.isArray(legacyFolders) ? legacyFolders : []) {
    if (folder?.path) foldersByPath.set(folder.path, folder);
  }
  for (const folder of Array.isArray(targetFolders) ? targetFolders : []) {
    if (folder?.path) foldersByPath.set(folder.path, folder);
  }
  return Array.from(foldersByPath.values());
}

async function copyDirectoryEntries(sourceDir, targetDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true }).catch(() => []);
  let copied = 0;
  await mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (await pathExists(targetPath)) continue;
    await cp(sourcePath, targetPath, { recursive: entry.isDirectory() });
    copied += 1;
  }
  return copied;
}

async function migrateConfig(legacyDir) {
  const legacyConfigFile = join(legacyDir, "config.json");
  if (!(await pathExists(legacyConfigFile))) return false;
  const legacyConfig = await readJson(legacyConfigFile, {});
  const targetConfig = await readJson(CONFIG_FILE, {});
  return writeJsonIfChanged(CONFIG_FILE, mergeConfig(targetConfig, legacyConfig));
}

async function migrateWorkfolders(legacyDir) {
  const legacyFile = join(legacyDir, "tasks", "workfolders.json");
  if (!(await pathExists(legacyFile))) return false;
  const targetFile = getWorkfoldersFile(await getBaseDir());
  const legacyFolders = await readJson(legacyFile, []);
  const targetFolders = await readJson(targetFile, []);
  return writeJsonIfChanged(targetFile, mergeWorkfolders(targetFolders, legacyFolders));
}

async function migrateWorkflows(legacyDir) {
  return copyDirectoryEntries(join(legacyDir, "workflows"), getWorkflowDir());
}

async function migrateSkills(legacyDir) {
  const copied = await copyDirectoryEntries(join(legacyDir, "skills"), getSkillsDir());
  return copied > 0;
}

export async function migrateLegacyDesktopData() {
  const targetDir = getDaemonStorageDir();
  const result = {
    migrated: false,
    sources: [],
  };

  for (const legacyDir of getLegacyDesktopDataDirs()) {
    if (isSamePath(legacyDir, targetDir) || !(await pathExists(legacyDir))) continue;
    const source = {
      path: legacyDir,
      config: await migrateConfig(legacyDir),
      workfolders: await migrateWorkfolders(legacyDir),
      workflows: (await migrateWorkflows(legacyDir)) > 0,
      skills: await migrateSkills(legacyDir),
    };
    source.migrated = source.config || source.workfolders || source.workflows || source.skills;
    if (source.migrated) result.migrated = true;
    result.sources.push(source);
  }

  return result;
}
