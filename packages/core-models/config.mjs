import { join, dirname } from "path";
import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
let runtimeBaseDir = "";
let runtimeStorageDir = "";

export const CONFIG_FILE = join(PROJECT_ROOT, "config.json");
export const DEFAULT_BASE_DIR = join(PROJECT_ROOT, ".do-a-ticket-task");
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

export async function readConfig() {
  try { return JSON.parse(await readFile(CONFIG_FILE, "utf-8")); } catch { return {}; }
}

export async function saveConfig(config) {
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
  return runtimeStorageDir || DEFAULT_BASE_DIR;
}

export async function getBaseDir() {
  return runtimeBaseDir || join(getDefaultDesktopUserDataDir(), "tasks");
}

export function getSkillsDir() {
  return join(getStorageDir(), "skills");
}

export function getWorkfoldersFile(baseDir) {
  return join(baseDir, "workfolders.json");
}
