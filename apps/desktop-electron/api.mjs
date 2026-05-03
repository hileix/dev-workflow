import { basename, join, resolve } from "path";
import { readFile, writeFile, readdir, stat, unlink, mkdir } from "fs/promises";
import { dialog } from "electron";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readConfig, saveConfig, WORKFLOW_DIR, getBaseDir } from "../../packages/core-models/config.mjs";
import {
  getWorkflow,
  getActiveWorkflowFile,
  setActiveWorkflowFile,
  getPhaseOrder,
  loadWorkflow,
} from "../../packages/core-models/workflow.mjs";
import { readWorkfolders, saveWorkfolders, deleteTask } from "../../packages/core-models/workfolders.mjs";
import { readState } from "../../packages/core-models/state.mjs";
import { deleteManagedSkill, importManagedSkills, listManagedSkills, saveManagedSkill } from "../../packages/core-models/skills.mjs";
import { getPhaseContent, readArtifact } from "../../packages/core-lib/claude.mjs";

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
  const phaseOrder = getPhaseOrder();
  const groups = [];
  const seenGroups = new Set();
  const phaseLabels = {};
  const phaseTypes = {};
  const rejectTargets = {};

  for (const phase of workflow.phases) {
    phaseLabels[phase.id] = phase.label;
    phaseTypes[phase.id] = phase.type;
    if (phase.rejectTargets) rejectTargets[phase.id] = phase.rejectTargets;
    if (!seenGroups.has(phase.group)) {
      seenGroups.add(phase.group);
      groups.push({ key: phase.group, label: phase.groupLabel || phase.label, phases: [] });
    }
    groups.find((group) => group.key === phase.group).phases.push(phase.id);
  }

  return {
    name: workflow.name,
    activeWorkflow: getActiveWorkflowFile(),
    phaseOrder,
    groups,
    phaseLabels,
    phaseTypes,
    rejectTargets,
    prompts: workflow.prompts || [],
    worktree: workflow.worktree || { enabled: false, files: [] },
  };
}

export async function listWorkflows() {
  try {
    const files = await readdir(WORKFLOW_DIR);
    const workflows = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(await readFile(join(WORKFLOW_DIR, file), "utf-8"));
        workflows.push({
          filename: file,
          name: raw.name || file,
          phaseCount: raw.phases?.length || 0,
          prompts: raw.prompts || [],
          worktree: raw.worktree || { enabled: false, files: [] },
        });
      } catch {}
    }
    return { workflows, activeWorkflow: getActiveWorkflowFile() };
  } catch {
    return { workflows: [], activeWorkflow: getActiveWorkflowFile() };
  }
}

export async function getWorkflowByFilename(filename) {
  if (!filename.endsWith(".json")) throw new Error("invalid filename");
  const raw = await readFile(join(WORKFLOW_DIR, filename), "utf-8");
  return JSON.parse(raw);
}

export async function createWorkflow(workflow) {
  if (!workflow.name || !workflow.phases) throw new Error("name and phases required");
  const filename = workflow.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".json";
  const filepath = join(WORKFLOW_DIR, filename);
  const existing = await stat(filepath).catch(() => null);
  if (existing) throw new Error("workflow with this name already exists");
  await writeFile(filepath, JSON.stringify(workflow, null, 2));
  return { filename, name: workflow.name };
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
  if (!filename.endsWith(".json")) throw new Error("invalid filename");
  if (!workflow.name || !workflow.phases) throw new Error("name and phases required");
  await writeFile(join(WORKFLOW_DIR, filename), JSON.stringify(workflow, null, 2));
  if (filename === getActiveWorkflowFile()) {
    loadWorkflow(join(WORKFLOW_DIR, filename));
  }
  return { filename, name: workflow.name };
}

export async function removeWorkflow(filename) {
  if (!filename.endsWith(".json")) throw new Error("invalid filename");
  const files = (await readdir(WORKFLOW_DIR)).filter((file) => file.endsWith(".json"));
  if (!files.includes(filename)) throw new Error("workflow not found");
  if (files.length <= 1) throw new Error("at least one workflow must remain");

  await unlink(join(WORKFLOW_DIR, filename));
  if (getActiveWorkflowFile() === filename) {
    const remaining = files.filter((file) => file !== filename).sort();
    const nextWorkflow = remaining.includes("default.json") ? "default.json" : remaining[0];
    setActiveWorkflowFile(nextWorkflow);
    loadWorkflow(join(WORKFLOW_DIR, nextWorkflow));
    const config = await readConfig();
    config.activeWorkflow = nextWorkflow;
    await saveConfig(config);
  }
  return { ok: true };
}

export async function activateWorkflow(filename) {
  if (!filename.endsWith(".json")) throw new Error("invalid filename");
  loadWorkflow(join(WORKFLOW_DIR, filename));
  setActiveWorkflowFile(filename);
  const config = await readConfig();
  config.activeWorkflow = filename;
  await saveConfig(config);
  return { activeWorkflow: filename };
}

export async function listWorkFolders() {
  const folders = await readWorkfolders();
  const baseDir = await getBaseDir();
  for (const folder of folders) {
    if (!folder.tasks) continue;
    for (const task of folder.tasks) {
      try {
        const stateFile = join(baseDir, task.ticketId, "workflow-state.json");
        const state = JSON.parse(await readFile(stateFile, "utf-8"));
        task.status = state.overallStatus || task.status;
        task.phases = state.phases || [];
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

export async function getTaskState(ticketId) {
  const state = await readState(ticketId);
  const messages = {};
  const artifacts = {};
  for (const phase of state.phases) {
    const content = await getPhaseContent(ticketId, phase.id);
    if (content) messages[phase.id] = content;
    if (phase.status !== "pending") {
      const artifact = await readArtifact(ticketId, phase.id);
      if (artifact) artifacts[phase.id] = artifact;
    }
  }
  return { state, messages, artifacts };
}

export async function removeTask(ticketId) {
  if (!ticketId) throw new Error("ticketId required");
  await deleteTask(ticketId);
  return { ok: true };
}

export async function saveTaskUploads(ticketId, filePaths) {
  if (!ticketId) throw new Error("ticketId required");
  if (!Array.isArray(filePaths)) return { paths: [] };

  const baseDir = await getBaseDir();
  const uploadDir = join(baseDir, ticketId, "uploads");
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
