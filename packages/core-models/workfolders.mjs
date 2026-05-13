import { dirname, join } from "path";
import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { getBaseDir, getWorkfoldersFile } from "./config.mjs";
import { assertSafeRunId, readState, getTaskRunId, writeState } from "./state.mjs";
import { removeWorktree } from "../core-lib/worktree.mjs";

function getStoredTaskId(task) {
  return task?.taskId || task?.ticketId || "";
}

function normalizeTask(task) {
  const taskId = getStoredTaskId(task);
  if (!taskId) return task;
  return {
    ...task,
    taskId,
    runId: task.runId || taskId,
  };
}

function normalizeWorkfolders(folders) {
  return (folders || []).map((folder) => ({
    ...folder,
    tasks: (folder.tasks || []).map(normalizeTask),
  }));
}

export async function readWorkfolders() {
  const baseDir = await getBaseDir();
  const file = getWorkfoldersFile(baseDir);
  try { return normalizeWorkfolders(JSON.parse(await readFile(file, "utf-8"))); } catch { return []; }
}

export async function saveWorkfolders(folders) {
  const baseDir = await getBaseDir();
  const file = getWorkfoldersFile(baseDir);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(folders, null, 2));
}

export async function upsertTask(workFolder, taskId, status, runId = "", options = {}) {
  const folders = await readWorkfolders();
  const folder = folders.find((f) => f.path === workFolder);
  if (!folder) return;
  if (!folder.tasks) folder.tasks = [];
  const requestedRunId = assertSafeRunId(runId);
  const existing = folder.tasks.find((task) => {
    const storedTaskId = getStoredTaskId(task);
    const storedRunId = task.runId || storedTaskId;
    return storedTaskId === taskId && (!requestedRunId || storedRunId === requestedRunId);
  });
  if (!existing && options.create === false) return;
  const taskRunId = requestedRunId || existing?.runId || await getTaskRunId(taskId);
  if (existing) {
    existing.status = status;
    if (taskRunId) existing.runId = taskRunId;
  } else {
    folder.tasks.push({ taskId, status, runId: taskRunId });
  }
  await saveWorkfolders(folders);
}

export async function deleteTask(taskId, runId = "", options = {}) {
  const requestedRunId = assertSafeRunId(runId);
  const shouldRemoveWorktree = Boolean(options?.removeWorktree);
  let state = null;
  try {
    state = await readState(taskId, requestedRunId);
  } catch (error) {
    if (requestedRunId) throw error;
  }

  if (shouldRemoveWorktree && state?.worktree?.enabled) {
    await removeWorktree(state.worktree, { force: true }).catch(() => {});
  }

  const targetRunId = state?.runId || requestedRunId || await getTaskRunId(taskId);
  const folders = await readWorkfolders();
  for (const folder of folders) {
    if (!folder.tasks) continue;
    folder.tasks = folder.tasks.filter((task) => {
      const storedTaskId = getStoredTaskId(task);
      const storedRunId = task.runId || storedTaskId;
      if (targetRunId) return !(storedTaskId === taskId && storedRunId === targetRunId);
      return storedTaskId !== taskId && storedRunId !== taskId;
    });
  }
  await saveWorkfolders(folders);
  const baseDir = await getBaseDir();
  if (targetRunId) {
    await rm(join(baseDir, targetRunId), { recursive: true, force: true });
  }
}

export async function removeTaskWorktree(taskId, runId = "") {
  const requestedRunId = assertSafeRunId(runId);
  const state = await readState(taskId, requestedRunId);
  if (!state?.worktree?.enabled) return { ok: true, removed: false, state };

  await removeWorktree(state.worktree, { force: true });
  const nextState = {
    ...state,
    worktree: {
      ...state.worktree,
      enabled: false,
      cleaned: true,
      cleanedAt: new Date().toISOString(),
    },
  };
  await writeState(taskId, nextState);
  return { ok: true, removed: true, state: nextState };
}
