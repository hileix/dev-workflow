import { basename, dirname, join, resolve } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readFileSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
let runtimeBaseDir = "";
let runtimeStorageDir = "";

function getPlatformUserDataDir() {
  switch (process.platform) {
    case "darwin":
      return join(os.homedir(), "Library", "Application Support", "dev-Workflow");
    case "win32":
      return join(process.env.APPDATA || join(os.homedir(), "AppData", "Roaming"), "dev-Workflow");
    default:
      return join(
        process.env.XDG_CONFIG_HOME || join(os.homedir(), ".config"),
        "dev-Workflow"
      );
  }
}

export function getSharedDesktopUserDataDir() {
  return getPlatformUserDataDir();
}

function isDevelopmentCheckout() {
  return (
    existsSync(join(PROJECT_ROOT, "package.json")) &&
    existsSync(join(PROJECT_ROOT, "apps", "desktop", "electron", "main.ts"))
  );
}

function getWorktreeScopedUserDataDir(baseDir, projectRoot = PROJECT_ROOT) {
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 8);
  return join(baseDir, "worktrees", `${basename(projectRoot)}-${hash}`);
}

function getCommonGitDir() {
  const gitPath = join(PROJECT_ROOT, ".git");
  try {
    if (statSync(gitPath).isDirectory()) return gitPath;
  } catch {
    return "";
  }

  const match = readFileSync(gitPath, "utf-8").match(/^gitdir:\s*(.+)\s*$/m);
  if (!match) return "";
  const gitDir = resolve(PROJECT_ROOT, match[1]);

  try {
    const rawCommonDir = readFileSync(join(gitDir, "commondir"), "utf-8").trim();
    if (rawCommonDir) return resolve(gitDir, rawCommonDir);
  } catch {}

  return resolve(gitDir, "..", "..");
}

function getSystemDevelopmentCheckoutDir(baseDir) {
  const commonGitDir = getCommonGitDir();
  const mainProjectRoot = basename(commonGitDir) === ".git" ? dirname(commonGitDir) : PROJECT_ROOT;
  return getWorktreeScopedUserDataDir(baseDir, mainProjectRoot);
}

export function getDefaultDesktopUserDataDir() {
  if (process.env.DEV_WORKFLOW_USER_DATA_DIR) {
    return process.env.DEV_WORKFLOW_USER_DATA_DIR;
  }

  const baseDir = getPlatformUserDataDir();
  return isDevelopmentCheckout() ? getWorktreeScopedUserDataDir(baseDir) : baseDir;
}

export function getSystemDesktopUserDataDir() {
  const baseDir = getSharedDesktopUserDataDir();
  return isDevelopmentCheckout() ? getSystemDevelopmentCheckoutDir(baseDir) : baseDir;
}

export const SYSTEM_CONFIG_FILE = join(getSystemDesktopUserDataDir(), "config.json");
export const CONFIG_FILE = join(getDefaultDesktopUserDataDir(), "config.json");

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readJsonFileSync(path) {
  try {
    return parseJson(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

async function readJsonFile(path) {
  try {
    return parseJson(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function mergeAiApiProfiles(systemProfiles = [], userProfiles = [], deletedProfileIds = []) {
  const deleted = new Set((Array.isArray(deletedProfileIds) ? deletedProfileIds : []).map((id) => slugifyConfigId(id, "")));
  const merged = normalizeAiApiProfiles(systemProfiles).filter((profile) => !deleted.has(profile.id));
  const byId = new Map(merged.map((profile, index) => [profile.id, index]));

  for (const profile of normalizeAiApiProfiles(userProfiles)) {
    const index = byId.get(profile.id);
    if (index === undefined) {
      byId.set(profile.id, merged.length);
      merged.push(profile);
    } else {
      merged[index] = profile;
    }
  }

  return merged;
}

function mergeConfigLayers(systemConfig = {}, userConfig = {}) {
  const merged = {
    ...systemConfig,
    ...userConfig,
  };
  merged.aiApiProfiles = mergeAiApiProfiles(
    systemConfig.aiApiProfiles,
    userConfig.aiApiProfiles,
    userConfig.deletedAiApiProfileIds
  );
  return merged;
}

function sameAiApiProfile(a, b) {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.baseUrl === b.baseUrl &&
    a.apiKey === b.apiKey &&
    a.model === b.model
  );
}

function buildUserConfig(config, systemConfig) {
  const userConfig = {};
  const systemProfiles = normalizeAiApiProfiles(systemConfig.aiApiProfiles);
  const nextProfiles = normalizeAiApiProfiles(config.aiApiProfiles);
  const nextProfileIds = new Set(nextProfiles.map((profile) => profile.id));
  const systemProfileById = new Map(systemProfiles.map((profile) => [profile.id, profile]));
  const userProfiles = nextProfiles.filter((profile) => {
    const systemProfile = systemProfileById.get(profile.id);
    return !systemProfile || !sameAiApiProfile(profile, systemProfile);
  });
  const deletedAiApiProfileIds = systemProfiles
    .filter((profile) => !nextProfileIds.has(profile.id))
    .map((profile) => profile.id);

  for (const key of ["activeWorkflow", "mobileAccessEnabled", "aiBackendOverride"]) {
    if (hasOwn(config, key) && config[key] !== systemConfig[key]) {
      userConfig[key] = config[key];
    }
  }
  if (Array.isArray(config.deletedWorkflowFiles) && config.deletedWorkflowFiles.length > 0) {
    userConfig.deletedWorkflowFiles = config.deletedWorkflowFiles;
  }
  if (userProfiles.length > 0) userConfig.aiApiProfiles = userProfiles;
  if (deletedAiApiProfileIds.length > 0) userConfig.deletedAiApiProfileIds = deletedAiApiProfileIds;
  return userConfig;
}

async function ensureConfigDir() {
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
}

export function readSystemConfigSync() {
  return readJsonFileSync(SYSTEM_CONFIG_FILE) || {};
}

export async function readSystemConfig() {
  return (await readJsonFile(SYSTEM_CONFIG_FILE)) || {};
}

export function readUserConfigSync() {
  return readJsonFileSync(CONFIG_FILE) || {};
}

export async function readUserConfig() {
  return (await readJsonFile(CONFIG_FILE)) || {};
}

export function readConfigSync() {
  return mergeConfigLayers(readSystemConfigSync(), readUserConfigSync());
}

export async function readConfig() {
  return mergeConfigLayers(await readSystemConfig(), await readUserConfig());
}

export async function saveConfig(config) {
  const systemConfig = await readSystemConfig();
  const userConfig = buildUserConfig(config || {}, systemConfig);
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(userConfig, null, 2));
}

export async function readMobileAccessEnabled() {
  const config = await readConfig();
  return config.mobileAccessEnabled === true;
}

export async function saveMobileAccessEnabled(enabled) {
  const config = await readConfig();
  config.mobileAccessEnabled = enabled === true;
  await saveConfig(config);
  return config.mobileAccessEnabled;
}

export function normalizeAiBackendOverride(value) {
  const backend = String(value || "").trim();
  return backend === "codex" ? "codex" : "claude";
}

export function readAiBackendOverrideSync() {
  const config = readConfigSync();
  return normalizeAiBackendOverride(config.aiBackendOverride);
}

export async function readAiBackendOverride() {
  const config = await readConfig();
  return normalizeAiBackendOverride(config.aiBackendOverride);
}

export async function saveAiBackendOverride(backend) {
  const config = await readConfig();
  config.aiBackendOverride = normalizeAiBackendOverride(backend);
  await saveConfig(config);
  return config.aiBackendOverride;
}

const DEFAULT_AI_API_BASE_URL = "https://api.openai.com/v1";

function slugifyConfigId(value, fallback = "ai-api") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
}

function normalizeAiApiProfile(profile, existingProfile = null) {
  const name = String(profile?.name || "").trim();
  const id = slugifyConfigId(profile?.id || name || existingProfile?.id);
  const apiKey = String(profile?.apiKey || "").trim() || existingProfile?.apiKey || "";
  return {
    id,
    name: name || existingProfile?.name || id,
    baseUrl: String(profile?.baseUrl || existingProfile?.baseUrl || DEFAULT_AI_API_BASE_URL).trim() || DEFAULT_AI_API_BASE_URL,
    apiKey,
    model: String(profile?.model || existingProfile?.model || "").trim(),
  };
}

function normalizeAiApiProfiles(profiles = []) {
  if (!Array.isArray(profiles)) return [];
  const seen = new Set();
  const result = [];
  for (const profile of profiles) {
    const normalized = normalizeAiApiProfile(profile);
    if (!normalized.id || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    result.push(normalized);
  }
  return result;
}

function redactAiApiProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    hasApiKey: Boolean(profile.apiKey),
  };
}

export function readAiApiProfilesSync() {
  const config = readConfigSync();
  return normalizeAiApiProfiles(config.aiApiProfiles);
}

export function readAiApiProfileSync(id) {
  const profileId = slugifyConfigId(id, "");
  if (!profileId) return null;
  return readAiApiProfilesSync().find((profile) => profile.id === profileId) || null;
}

export async function readAiApiProfiles() {
  const config = await readConfig();
  return normalizeAiApiProfiles(config.aiApiProfiles);
}

export async function readAiApiProfilesForUi() {
  return (await readAiApiProfiles()).map(redactAiApiProfile);
}

export async function saveAiApiProfile(profile) {
  const config = await readConfig();
  const profiles = normalizeAiApiProfiles(config.aiApiProfiles);
  const id = slugifyConfigId(profile?.id || profile?.name, "");
  const existing = profiles.find((item) => item.id === id) || null;
  if (!String(profile?.name || existing?.name || "").trim()) throw new Error("AI API name is required");
  const normalized = normalizeAiApiProfile(profile, existing);
  if (!normalized.model) throw new Error("AI API model is required");
  if (!normalized.apiKey) throw new Error("AI API key is required");

  const nextProfiles = profiles.filter((item) => item.id !== normalized.id);
  nextProfiles.push(normalized);
  config.aiApiProfiles = nextProfiles;
  await saveConfig(config);
  return readAiApiProfilesForUi();
}

export async function deleteAiApiProfile(id) {
  const profileId = slugifyConfigId(id, "");
  if (!profileId) throw new Error("AI API profile id is required");
  const config = await readConfig();
  config.aiApiProfiles = normalizeAiApiProfiles(config.aiApiProfiles).filter((profile) => profile.id !== profileId);
  await saveConfig(config);
  return readAiApiProfilesForUi();
}

export function setRuntimeBaseDir(baseDir) {
  runtimeBaseDir = baseDir || "";
}

export function setRuntimeStorageDir(storageDir) {
  runtimeStorageDir = storageDir || "";
}

export function getStorageDir() {
  return runtimeStorageDir || getDefaultDesktopUserDataDir();
}

export async function getBaseDir() {
  return runtimeBaseDir || join(getStorageDir(), "tasks");
}

export function getSystemBaseDir() {
  return join(getSystemDesktopUserDataDir(), "tasks");
}

export function getSkillsDir() {
  return join(getStorageDir(), "skills");
}

export function getSystemSkillsDir() {
  return join(getSystemDesktopUserDataDir(), "skills");
}

export function getSkillsDirs() {
  const userDir = getSkillsDir();
  const systemDir = getSystemSkillsDir();
  return userDir === systemDir ? [userDir] : [userDir, systemDir];
}

export function getWorkflowDir() {
  return join(getStorageDir(), "workflows");
}

export function getSystemWorkflowDir() {
  return join(getSystemDesktopUserDataDir(), "workflows");
}

export function getWorkflowDirs() {
  const userDir = getWorkflowDir();
  const systemDir = getSystemWorkflowDir();
  return userDir === systemDir ? [userDir] : [userDir, systemDir];
}

export function getWorkfoldersFile(baseDir) {
  return join(baseDir, "workfolders.json");
}
