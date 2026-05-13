import { basename, join, resolve } from "path";
import { readFile, writeFile, readdir, stat, unlink, mkdir } from "fs/promises";
import { dialog } from "electron";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  readConfig,
  saveConfig,
  getBaseDir,
  getWorkflowDir,
  readAiBackendOverride,
  readMobileAccessEnabled,
  saveAiBackendOverride,
  saveMobileAccessEnabled,
} from "../../../packages/core-models/config";
import {
  assertSafeWorkflowFilename,
  getWorkflow,
  getActiveWorkflowFile,
  setActiveWorkflowFile,
  deriveTaskInputFields,
  getWorkflowConfigShape,
  loadWorkflow,
  unloadWorkflow,
} from "../../../packages/core-models/workflow";
import { validateWorkflowDsl } from "../../../packages/core-lib/langgraph-runtime/index";
import { readWorkfolders, saveWorkfolders, deleteTask, removeTaskWorktree } from "../../../packages/core-models/workfolders";
import { assertSafeRunId, readState, getTaskRunId, readPhaseInteractions } from "../../../packages/core-models/state";
import { deleteManagedSkill, importManagedSkills, listManagedSkills, saveManagedSkill } from "../../../packages/core-models/skills";
import { getPhaseContent, getPhaseOutputArtifactPath, readPhaseOutputArtifacts, stopActiveWorkflow } from "../../../packages/core-lib/claude";

function buildEmptyWorkflowConfig(mobileAccessEnabled, aiBackendOverride = "") {
  return {
    ...getWorkflowConfigShape(null),
    mobileAccessEnabled,
    aiBackendOverride,
  };
}

async function ensureWorkflowDir() {
  const workflowDir = getWorkflowDir();
  await mkdir(workflowDir, { recursive: true });
  return workflowDir;
}

export async function pickFolder(browserWindow) {
  const result = await dialog.showOpenDialog(browserWindow, {
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true };
  }
  return { cancelled: false, path: result.filePaths[0] };
}

export async function getWorkflowConfig() {
  const workflow = getWorkflow();
  const mobileAccessEnabled = await readMobileAccessEnabled();
  const aiBackendOverride = await readAiBackendOverride();
  if (!workflow) {
    return buildEmptyWorkflowConfig(mobileAccessEnabled, aiBackendOverride);
  }
  return {
    ...getWorkflowConfigShape(workflow),
    mobileAccessEnabled,
    aiBackendOverride,
  };
}

export async function setMobileAccessEnabled(enabled) {
  await saveMobileAccessEnabled(enabled);
  return getWorkflowConfig();
}

export async function setAiBackendOverride(backend) {
  await saveAiBackendOverride(backend);
  return getWorkflowConfig();
}

export async function listWorkflows() {
  const workflowDir = await ensureWorkflowDir();
  try {
    const files = await readdir(workflowDir);
    const workflows = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(await readFile(join(workflowDir, file), "utf-8"));
        const workflowConfig = getWorkflowConfigShape(raw);
        workflows.push({
          filename: file,
          name: raw.name || file,
          visible: raw.visible !== false,
          phaseCount: workflowConfig.phaseOrder.length,
          phaseOrder: workflowConfig.phaseOrder,
          groups: workflowConfig.groups,
          workflowConfig,
          taskInputFields: deriveTaskInputFields(raw),
          worktree: raw.worktree || { enabled: false, files: [], customFiles: [], removeOnComplete: false, useCustomSetupScript: false, setupScript: "" },
        });
      } catch {}
    }
    return { workflows, activeWorkflow: getActiveWorkflowFile() };
  } catch {
    return { workflows: [], activeWorkflow: getActiveWorkflowFile() };
  }
}

export async function getWorkflowByFilename(filename) {
  const safeFilename = assertSafeWorkflowFilename(filename);
  const raw = await readFile(join(await ensureWorkflowDir(), safeFilename), "utf-8");
  return JSON.parse(raw);
}

export async function setWorkflowVisible(filename, visible) {
  const safeFilename = assertSafeWorkflowFilename(filename);
  const workflowDir = await ensureWorkflowDir();
  const filepath = join(workflowDir, safeFilename);
  const raw = JSON.parse(await readFile(filepath, "utf-8"));
  raw.visible = visible === true;
  await writeFile(filepath, JSON.stringify(raw, null, 2));
  if (safeFilename === getActiveWorkflowFile()) loadWorkflow(filepath);
  return { filename: safeFilename, visible: raw.visible };
}

export async function createWorkflow(workflow) {
  return createWorkflowFile(workflow, false);
}

export async function createWorkflowDraft(workflow) {
  return createWorkflowFile(workflow, true);
}

async function createWorkflowFile(workflow, isDraft) {
  const data = isDraft ? workflow : validateWorkflowDsl(workflow);
  if (!String(data.name || "").trim()) throw new Error("workflow name is required");
  const filename = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".json";
  const workflowDir = await ensureWorkflowDir();
  const filepath = join(workflowDir, filename);
  const existing = await stat(filepath).catch(() => null);
  if (existing) throw new Error("workflow with this name already exists");
  await writeFile(filepath, JSON.stringify(data, null, 2));
  if (!isDraft && !getWorkflow()) {
    loadWorkflow(filepath);
    setActiveWorkflowFile(filename);
    const config = await readConfig();
    config.activeWorkflow = filename;
    await saveConfig(config);
  }
  return { filename, name: data.name };
}

export async function generateSkill({ label, id, prompt, description }) {
  if (!label) throw new Error("label is required");

  const context = [
    `Phase label: ${label}`,
    id ? `Phase ID: ${id}` : "",
    prompt ? `Current prompt: ${prompt}` : "",
    description ? `User description: ${description}` : "",
  ].filter(Boolean).join("\n");

  const metaPrompt = `You are generating a skill instruction for a workflow automation phase. The skill will guide an AI assistant (Claude) on how to execute this phase.

Based on the following phase context, generate a concise, actionable skill instruction. The skill should describe what the AI should do, any constraints or best practices, and expected output format.

${context}

The output MUST start with YAML frontmatter containing name and description fields, followed by the skill body. Use this format:

---
name: <short kebab-case name derived from the phase label>
description: "<one-line description of what this skill does and when to use it>"
---

<skill instruction body>

Keep the skill body concise and actionable (under 500 words). No extra explanations outside the format above.`;

  let skill = "";
  for await (const message of query({
    prompt: metaPrompt,
    options: {
      cwd: process.cwd(),
      permissionMode: "default",
      maxTurns: 1,
    },
  })) {
    if (message.type === "result") {
      if (message.subtype !== "success") {
        throw new Error(message.errors?.join("; ") || message.result || "Failed to generate skill");
      }
      skill = message.result?.trim() || "";
    }
  }

  if (!skill) throw new Error("Failed to generate skill");
  return { skill };
}

export async function listSkills() {
  return { skills: await listManagedSkills() };
}

export async function saveSkill(skill) {
  await saveManagedSkill(skill);
  return listSkills();
}

export async function deleteSkill(slug) {
  await deleteManagedSkill(slug);
  return listSkills();
}

export async function importSkills(browserWindow) {
  const result = await dialog.showOpenDialog(browserWindow, {
    properties: ["openFile", "openDirectory", "multiSelections"],
    filters: [{ name: "Skills", extensions: ["md"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true, skills: await listManagedSkills() };
  }

  for (const filePath of result.filePaths) {
    await importManagedSkills(filePath);
  }
  return { cancelled: false, skills: await listManagedSkills() };
}

export async function updateWorkflow(filename, workflow) {
  return updateWorkflowFile(filename, workflow, false);
}

export async function updateWorkflowDraft(filename, workflow) {
  return updateWorkflowFile(filename, workflow, true);
}

async function updateWorkflowFile(filename, workflow, isDraft) {
  const safeFilename = assertSafeWorkflowFilename(filename);
  const data = isDraft ? workflow : validateWorkflowDsl(workflow);
  if (!String(data.name || "").trim()) throw new Error("workflow name is required");
  const workflowDir = await ensureWorkflowDir();
  await writeFile(join(workflowDir, safeFilename), JSON.stringify(data, null, 2));
  if (!isDraft && safeFilename === getActiveWorkflowFile()) {
    loadWorkflow(join(workflowDir, safeFilename));
  }
  return { filename: safeFilename, name: data.name };
}

export async function removeWorkflow(filename) {
  const safeFilename = assertSafeWorkflowFilename(filename);
  const workflowDir = await ensureWorkflowDir();
  const files = (await readdir(workflowDir)).filter((file) => file.endsWith(".json"));
  if (!files.includes(safeFilename)) throw new Error("workflow not found");

  await unlink(join(workflowDir, safeFilename));
  if (getActiveWorkflowFile() === safeFilename) {
    const remaining = files.filter((file) => file !== safeFilename).sort();
    const config = await readConfig();
    if (remaining.length > 0) {
      const nextWorkflow = remaining[0];
      setActiveWorkflowFile(nextWorkflow);
      loadWorkflow(join(workflowDir, nextWorkflow));
      config.activeWorkflow = nextWorkflow;
    } else {
      unloadWorkflow();
      delete config.activeWorkflow;
    }
    await saveConfig(config);
  }
  return { ok: true };
}

export async function activateWorkflow(filename) {
  const safeFilename = assertSafeWorkflowFilename(filename);
  const workflowDir = await ensureWorkflowDir();
  loadWorkflow(join(workflowDir, safeFilename));
  setActiveWorkflowFile(safeFilename);
  const config = await readConfig();
  config.activeWorkflow = safeFilename;
  await saveConfig(config);
  return { activeWorkflow: safeFilename };
}

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
  let folders = await readWorkfolders();
  folders = folders.filter((folder) => folder.path !== folderPath);
  await saveWorkfolders(folders);
  return folders;
}

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
