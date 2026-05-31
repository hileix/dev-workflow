import { basename, resolve } from "path";
import { stat } from "fs/promises";
import { assertSafeRunId, getTaskRunId, readState } from "../repositories/state";
import { readWorkfolders, removeWorkfolder, saveWorkfolders } from "../repositories/workfolders";

export async function listWorkFolders() {
  const folders = await readWorkfolders();
  for (const folder of folders) {
    if (!folder.tasks) continue;
    for (const task of folder.tasks) {
      try {
        const runId = assertSafeRunId(task.runId || await getTaskRunId(task.taskId));
        if (!runId) throw new Error("task not found");
        const state = await readState(task.taskId, runId);
        task.status = state.overallStatus || task.status;
        task.phases = state.phases || [];
        task.runId = state.runId || runId;
        task.workflowConfig = state.workflowConfig || null;
      } catch {
        task.phases = [];
      }
    }
  }
  return folders;
}

export async function addWorkFolder(folderPath) {
  if (!folderPath) throw new Error("path required");
  const absPath = resolve(folderPath);
  const fileStat = await stat(absPath).catch(() => null);
  if (!fileStat) throw new Error("path does not exist");
  if (!fileStat.isDirectory()) throw new Error("not a directory");
  const folders = await readWorkfolders();
  if (folders.some((folder) => folder.path === absPath)) throw new Error("folder already added");
  folders.push({ name: basename(absPath), path: absPath, tasks: [] });
  await saveWorkfolders(folders);
  return folders;
}

export async function removeWorkFolder(folderPath) {
  if (!folderPath) throw new Error("path required");
  return removeWorkfolder(folderPath);
}
