import { basename, join, resolve } from "path";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { getBaseDir } from "../repositories/config";
import { assertSafeRunId, readPhaseInteractions, readState } from "../repositories/state";
import { deleteTask, removeTaskWorktree } from "../repositories/workfolders";
import { getPhaseContent, getPhaseOutputArtifactPath, readPhaseOutputArtifacts, stopActiveWorkflow } from "../runtime/claude";
import { openPath } from "./systemService";

export async function getTaskState(taskId, runId = "") {
  const state = await readState(taskId, runId);
  const stateRunId = state.runId || runId;
  const messages = {};
  const outputArtifacts = {};
  const interactions = {};
  for (const phase of state.phases) {
    const content = await getPhaseContent(taskId, phase.id, stateRunId);
    if (content) messages[phase.id] = content;
    const phaseInteractions = await readPhaseInteractions(taskId, phase.id, stateRunId);
    if (phaseInteractions.length > 0) interactions[phase.id] = phaseInteractions;
    if (phase.status !== "pending") {
      const phaseOutputArtifacts = await readPhaseOutputArtifacts(taskId, phase.id, stateRunId);
      if (Object.keys(phaseOutputArtifacts).length > 0) {
        outputArtifacts[phase.id] = phaseOutputArtifacts;
      }
    }
  }
  return { state, messages, outputArtifacts, interactions };
}

export async function getTaskOutputPath(taskId, runId = "", phaseId = "", outputKey = "") {
  if (!taskId || !phaseId || !outputKey) throw new Error("document path required");
  const outputPath = await getPhaseOutputArtifactPath(taskId, phaseId, outputKey, runId);
  if (!outputPath) throw new Error("document path not found");
  return outputPath;
}

export async function openTaskOutput(taskId, runId = "", phaseId = "", outputKey = "", editor = "code") {
  return openPath(await getTaskOutputPath(taskId, runId, phaseId, outputKey), editor);
}

export async function removeTask(taskId, runId = "", options = {}) {
  if (!taskId) throw new Error("taskId required");
  const safeRunId = assertSafeRunId(runId);
  stopActiveWorkflow(taskId, safeRunId);
  await deleteTask(taskId, safeRunId, { removeWorktree: Boolean(options?.removeWorktree) });
  return { ok: true };
}

export async function removeTaskWorktreeOnly(taskId, runId = "") {
  if (!taskId) throw new Error("taskId required");
  const safeRunId = assertSafeRunId(runId);
  stopActiveWorkflow(taskId, safeRunId);
  return removeTaskWorktree(taskId, safeRunId);
}

export async function saveTaskUploads(runId, filePaths) {
  const safeRunId = assertSafeRunId(runId);
  if (!safeRunId) throw new Error("runId required");
  if (!Array.isArray(filePaths)) return { paths: [] };

  const baseDir = await getBaseDir();
  const uploadDir = join(baseDir, safeRunId, "uploads");
  await mkdir(uploadDir, { recursive: true });

  const savedPaths = [];
  for (const fileEntry of filePaths) {
    if (typeof fileEntry === "string") {
      const resolvedPath = resolve(fileEntry);
      const fileStat = await stat(resolvedPath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) continue;
      const filename = `${Date.now()}-${basename(resolvedPath)}`;
      const target = join(uploadDir, filename);
      await writeFile(target, await readFile(resolvedPath));
      savedPaths.push(target);
      continue;
    }

    if (!fileEntry || typeof fileEntry !== "object" || !fileEntry.name || !fileEntry.data) continue;
    const target = join(uploadDir, `${Date.now()}-${basename(fileEntry.name)}`);
    await writeFile(target, Buffer.from(fileEntry.data));
    savedPaths.push(target);
  }

  return { paths: savedPaths };
}
