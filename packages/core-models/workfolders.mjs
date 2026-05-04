import { dirname, join } from "path";
import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { getBaseDir, getWorkfoldersFile } from "./config.mjs";
import { readState, getTaskRunId } from "./state.mjs";
import { removeWorktree } from "../core-lib/worktree.mjs";

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

export async function upsertTask(workFolder, taskId, status, runId = "") {
  const folders = await readWorkfolders();
  const folder = folders.find((f) => f.path === workFolder);
  if (!folder) return;
  if (!folder.tasks) folder.tasks = [];
  const existing = folder.tasks.find((t) => t.taskId === taskId);
  const taskRunId = runId || existing?.runId || await getTaskRunId(taskId);
  if (existing) {
    existing.status = status;
    if (taskRunId) existing.runId = taskRunId;
  } else {
    folder.tasks.push({ taskId, status, runId: taskRunId });
  }
  await saveWorkfolders(folders);
}

export async function deleteTask(taskId) {
  let state = null;
  try {
    state = await readState(taskId);
  } catch {}

  if (state?.worktree?.enabled) {
    await removeWorktree(state.worktree, { force: true }).catch(() => {});
  }

  const folders = await readWorkfolders();
  for (const folder of folders) {
    if (!folder.tasks) continue;
    folder.tasks = folder.tasks.filter((t) => t.taskId !== taskId);
  }
  await saveWorkfolders(folders);
  const baseDir = await getBaseDir();
  const runId = state?.runId || await getTaskRunId(taskId);
  if (runId) {
    await rm(join(baseDir, runId), { recursive: true, force: true });
  }
}
