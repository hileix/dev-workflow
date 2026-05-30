import { dirname, join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { readFileSync } from "fs";
import os from "os";

let runtimeBaseDir = "";
let runtimeStorageDir = "";

export function getDaemonStorageDir() {
  return process.env.DEV_WORKFLOW_HOME || join(os.homedir(), ".dev-workflow");
}

export function getSharedDaemonDataDir() {
  return getDaemonStorageDir();
}

export function getDefaultDaemonDataDir() {
  return getDaemonStorageDir();
}

export function getSystemDaemonDataDir() {
  return getDefaultDaemonDataDir();
}

export const SYSTEM_CONFIG_FILE = join(getSystemDaemonDataDir(), "config.json");
export const CONFIG_FILE = join(getDefaultDaemonDataDir(), "config.json");

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
  return readUserConfigSync();
}

export async function readConfig() {
  return readUserConfig();
}

export async function saveConfig(config) {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(config || {}, null, 2));
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
  return runtimeStorageDir || getDefaultDaemonDataDir();
}

export async function getBaseDir() {
  return runtimeBaseDir || join(getStorageDir(), "tasks");
}

export function getSystemBaseDir() {
  return join(getSystemDaemonDataDir(), "tasks");
}

export function getSkillsDir() {
  return join(getStorageDir(), "skills");
}

export function getSystemSkillsDir() {
  return join(getSystemDaemonDataDir(), "skills");
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
  return join(getSystemDaemonDataDir(), "workflows");
}

export function getWorkflowDirs() {
  const userDir = getWorkflowDir();
  const systemDir = getSystemWorkflowDir();
  return userDir === systemDir ? [userDir] : [userDir, systemDir];
}

export function getWorkfoldersFile(baseDir) {
  return join(baseDir, "workfolders.json");
}
