import { basename, join, dirname } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
let runtimeBaseDir = "";
let runtimeStorageDir = "";
export const LEGACY_WORKFLOW_DIR = join(PROJECT_ROOT, "workflows");

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

function getWorktreeScopedUserDataDir(baseDir) {
  const hash = createHash("sha256").update(PROJECT_ROOT).digest("hex").slice(0, 8);
  return join(baseDir, "worktrees", `${basename(PROJECT_ROOT)}-${hash}`);
}

export function getDefaultDesktopUserDataDir() {
  if (process.env.DEV_WORKFLOW_USER_DATA_DIR) {
    return process.env.DEV_WORKFLOW_USER_DATA_DIR;
  }

  const baseDir = getPlatformUserDataDir();
  return isDevelopmentCheckout() ? getWorktreeScopedUserDataDir(baseDir) : baseDir;
}

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

async function ensureConfigDir() {
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
}

export function readConfigSync() {
  return readJsonFileSync(CONFIG_FILE) || {};
}

export async function readConfig() {
  return (await readJsonFile(CONFIG_FILE)) || {};
}

export async function saveConfig(config) {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
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
  return nextProfiles.map(redactAiApiProfile);
}

export async function deleteAiApiProfile(id) {
  const profileId = slugifyConfigId(id, "");
  if (!profileId) throw new Error("AI API profile id is required");
  const config = await readConfig();
  config.aiApiProfiles = normalizeAiApiProfiles(config.aiApiProfiles).filter((profile) => profile.id !== profileId);
  await saveConfig(config);
  return config.aiApiProfiles.map(redactAiApiProfile);
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

export function getSkillsDir() {
  return join(getStorageDir(), "skills");
}

export function getWorkflowDir() {
  return join(getSharedDesktopUserDataDir(), "workflows");
}

export function getWorkfoldersFile(baseDir) {
  return join(baseDir, "workfolders.json");
}
