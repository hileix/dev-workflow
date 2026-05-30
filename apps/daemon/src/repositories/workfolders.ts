import { dirname, join } from "path";
import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { getBaseDir, getSystemBaseDir, getWorkfoldersFile } from "./config";
import { assertSafeRunId, readState, getTaskRunId, writeState } from "./state";
import { removeWorktree } from "../runtime/worktree";

function getStoredTaskId(task) {
  return task?.taskId || "";
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

async function readWorkfoldersFile(file) {
  try {
    return normalizeWorkfolders(JSON.parse(await readFile(file, "utf-8")));
  } catch {
    return null;
  }
}

function stripTasks(folders) {
  return folders.map((folder) => ({
    ...folder,
    tasks: [],
  }));
}

function mergeWorkfolders(systemFolders, userFolders) {
  const deletedPaths = new Set(
    userFolders
      .filter((folder) => folder?.deleted === true && folder.path)
      .map((folder) => folder.path)
  );
  const merged = [];
  const seen = new Set();

  for (const folder of stripTasks(systemFolders).filter((folder) => !deletedPaths.has(folder.path))) {
    if (!folder.path || seen.has(folder.path)) continue;
    seen.add(folder.path);
    merged.push(folder);
  }

  for (const folder of userFolders.filter((folder) => folder?.deleted !== true)) {
    if (!folder.path) continue;
    const index = merged.findIndex((item) => item.path === folder.path);
    if (index >= 0) {
      merged[index] = folder;
    } else {
      merged.push(folder);
    }
  }

  return merged;
}

function sameWorkfolder(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function readUserWorkfolders() {
  const baseDir = await getBaseDir();
  return await readWorkfoldersFile(getWorkfoldersFile(baseDir)) || [];
}

async function readSystemWorkfolders() {
  const userFile = getWorkfoldersFile(await getBaseDir());
  const systemFile = getWorkfoldersFile(getSystemBaseDir());
  if (userFile === systemFile) return [];
  return await readWorkfoldersFile(systemFile) || [];
}

export async function readWorkfolders() {
  const baseDir = await getBaseDir();
  const userFile = getWorkfoldersFile(baseDir);
  const systemFile = getWorkfoldersFile(getSystemBaseDir());
  const userFolders = await readUserWorkfolders();
  if (userFile === systemFile) return userFolders.filter((folder) => folder?.deleted !== true);

  const systemFolders = await readSystemWorkfolders();
  return mergeWorkfolders(systemFolders, userFolders);
}

export async function saveWorkfolders(folders) {
  const baseDir = await getBaseDir();
  const file = getWorkfoldersFile(baseDir);
  const existingUserFolders = await readUserWorkfolders();
  const systemFolders = stripTasks(await readSystemWorkfolders());
  const normalizedFolders = normalizeWorkfolders(folders);
  const deletedFolders = [
    ...existingUserFolders.filter((folder) => folder?.deleted === true && folder.path),
    ...normalizedFolders.filter((folder) => folder?.deleted === true && folder.path),
  ];
  const visibleFolders = normalizedFolders.filter((folder) => folder?.deleted !== true);
  const userFolders = visibleFolders.filter((folder) => {
    const systemFolder = systemFolders.find((item) => item.path === folder.path);
    return !systemFolder || !sameWorkfolder(folder, systemFolder);
  });
  const deletedByPath = new Map(deletedFolders.map((folder) => [folder.path, folder]));
  const nextFolders = [
    ...Array.from(deletedByPath.values()).filter((deleted) => !visibleFolders.some((folder) => folder.path === deleted.path)),
    ...userFolders,
  ];
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(nextFolders, null, 2));
}

export async function removeWorkfolder(folderPath) {
  const userFolders = await readUserWorkfolders();
  const systemFolder = (await readSystemWorkfolders()).find((folder) => folder.path === folderPath);
  const nextFolders = userFolders.filter((folder) => folder.path !== folderPath);
  if (systemFolder) {
    nextFolders.push({
      name: systemFolder.name,
      path: folderPath,
      tasks: [],
      deleted: true,
    });
  }
  await saveWorkfolders(nextFolders);
  return readWorkfolders();
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
  } catch {
    state = null;
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
