import { dirname, join } from "path";
import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { getBaseDir, getWorkfoldersFile } from "./config.mjs";

export async function readWorkfolders() {
  const baseDir = await getBaseDir();
  const file = getWorkfoldersFile(baseDir);
  try { return JSON.parse(await readFile(file, "utf-8")); } catch { return []; }
}

export async function saveWorkfolders(folders) {
  const baseDir = await getBaseDir();
  const file = getWorkfoldersFile(baseDir);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(folders, null, 2));
}

export async function upsertTask(workFolder, ticketId, status) {
  const folders = await readWorkfolders();
  const folder = folders.find((f) => f.path === workFolder);
  if (!folder) return;
  if (!folder.tasks) folder.tasks = [];
  const existing = folder.tasks.find((t) => t.ticketId === ticketId);
  if (existing) {
    existing.status = status;
  } else {
    folder.tasks.push({ ticketId, status });
  }
  await saveWorkfolders(folders);
}

export async function deleteTask(ticketId) {
  const folders = await readWorkfolders();
  for (const folder of folders) {
    if (!folder.tasks) continue;
    folder.tasks = folder.tasks.filter((t) => t.ticketId !== ticketId);
  }
  await saveWorkfolders(folders);
  const baseDir = await getBaseDir();
  await rm(join(baseDir, ticketId), { recursive: true, force: true });
}
