import { join, dirname } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
let runtimeBaseDir = "";
let runtimeStorageDir = "";

export const WORKFLOW_DIR = join(PROJECT_ROOT, "workflows");

function getDefaultDesktopUserDataDir() {
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

export function getWorkfoldersFile(baseDir) {
  return join(baseDir, "workfolders.json");
}
