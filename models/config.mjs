import { join, dirname } from "path";
import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

export const CONFIG_FILE = join(PROJECT_ROOT, "config.json");
export const DEFAULT_BASE_DIR = join(PROJECT_ROOT, ".do-a-ticket-task");
export const WORKFLOW_DIR = join(PROJECT_ROOT, "workflows");

export async function readConfig() {
  try { return JSON.parse(await readFile(CONFIG_FILE, "utf-8")); } catch { return {}; }
}

export async function saveConfig(config) {
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function getBaseDir() {
  const config = await readConfig();
  return config.taskStoragePath || DEFAULT_BASE_DIR;
}

export function getWorkfoldersFile(baseDir) {
  return join(baseDir, "workfolders.json");
}
