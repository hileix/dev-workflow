import { join } from "path";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "fs/promises";
import {
  readConfig,
  saveConfig,
  getWorkflowDir,
  getWorkflowDirs,
} from "../repositories/config";
import {
  assertSafeWorkflowFilename,
  getWorkflow,
  getActiveWorkflowFile,
  setActiveWorkflowFile,
  deriveTaskInputFields,
  getWorkflowConfigShape,
  getWorkflowFilePath,
  loadWorkflow,
  unloadWorkflow,
} from "../repositories/workflow";
import { validateWorkflowDsl } from "../runtime/langgraph-runtime/index";

async function ensureWorkflowDir() {
  const workflowDir = getWorkflowDir();
  await mkdir(workflowDir, { recursive: true });
  return workflowDir;
}

export async function listWorkflows() {
  await ensureWorkflowDir();
  try {
    const config = await readConfig();
    const deletedWorkflowFiles = new Set(Array.isArray(config.deletedWorkflowFiles) ? config.deletedWorkflowFiles : []);
    const files = Array.from(new Set((await Promise.all(
      getWorkflowDirs().map((dir) => readdir(dir).catch(() => []))
    )).flat())).filter((file) => !deletedWorkflowFiles.has(file)).sort();
    const workflows = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(await readFile(getWorkflowFilePath(file), "utf-8"));
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
  const raw = await readFile(getWorkflowFilePath(safeFilename), "utf-8");
  return JSON.parse(raw);
}

export async function setWorkflowVisible(filename, visible) {
  const safeFilename = assertSafeWorkflowFilename(filename);
  const workflowDir = await ensureWorkflowDir();
  const filepath = join(workflowDir, safeFilename);
  const raw = JSON.parse(await readFile(getWorkflowFilePath(safeFilename), "utf-8"));
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
  const config = await readConfig();
  const deletedWorkflowFiles = Array.isArray(config.deletedWorkflowFiles) ? config.deletedWorkflowFiles : [];
  const existing = await stat(getWorkflowFilePath(filename)).catch(() => null);
  if (existing && !deletedWorkflowFiles.includes(filename)) throw new Error("workflow with this name already exists");
  await writeFile(filepath, JSON.stringify(data, null, 2));
  config.deletedWorkflowFiles = deletedWorkflowFiles.filter((file) => file !== filename);
  if (!isDraft && !getWorkflow()) {
    loadWorkflow(filepath);
    setActiveWorkflowFile(filename);
    config.activeWorkflow = filename;
  }
  await saveConfig(config);
  return { filename, name: data.name };
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
  const config = await readConfig();
  config.deletedWorkflowFiles = (config.deletedWorkflowFiles || []).filter((file) => file !== safeFilename);
  await saveConfig(config);
  if (!isDraft && safeFilename === getActiveWorkflowFile()) {
    loadWorkflow(join(workflowDir, safeFilename));
  }
  return { filename: safeFilename, name: data.name };
}

export async function removeWorkflow(filename) {
  const safeFilename = assertSafeWorkflowFilename(filename);
  const workflowDir = await ensureWorkflowDir();
  const files = (await readdir(workflowDir)).filter((file) => file.endsWith(".json"));
  const userFileExists = files.includes(safeFilename);
  const targetExists = await stat(getWorkflowFilePath(safeFilename)).catch(() => null);
  const systemFileExists = await Promise.all(
    getWorkflowDirs().slice(1).map((dir) => stat(join(dir, safeFilename)).catch(() => null))
  ).then((stats) => stats.some(Boolean));
  if (!targetExists) throw new Error("workflow not found");

  if (userFileExists) {
    await unlink(join(workflowDir, safeFilename));
  }
  const config = await readConfig();
  if (!userFileExists || systemFileExists) {
    config.deletedWorkflowFiles = Array.from(new Set([...(config.deletedWorkflowFiles || []), safeFilename]));
  }
  if (getActiveWorkflowFile() === safeFilename) {
    const remaining = (await listWorkflows()).workflows.map((workflow) => workflow.filename).filter((file) => file !== safeFilename).sort();
    if (remaining.length > 0) {
      const nextWorkflow = remaining[0];
      setActiveWorkflowFile(nextWorkflow);
      loadWorkflow(getWorkflowFilePath(nextWorkflow));
      config.activeWorkflow = nextWorkflow;
    } else {
      unloadWorkflow();
      delete config.activeWorkflow;
    }
  }
  await saveConfig(config);
  return { ok: true };
}

export async function activateWorkflow(filename) {
  const safeFilename = assertSafeWorkflowFilename(filename);
  await ensureWorkflowDir();
  loadWorkflow(getWorkflowFilePath(safeFilename));
  setActiveWorkflowFile(safeFilename);
  const config = await readConfig();
  config.activeWorkflow = safeFilename;
  await saveConfig(config);
  return { activeWorkflow: safeFilename };
}
