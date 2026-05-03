import { Router } from "express";
import { join } from "path";
import { readFile, writeFile, readdir, stat, unlink } from "fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  readConfig,
  saveConfig,
  WORKFLOW_DIR,
  readMobileAccessEnabled,
  saveMobileAccessEnabled,
} from "../../../packages/core-models/config.mjs";
import { deleteManagedSkill, importManagedSkills, listManagedSkills, saveManagedSkill } from "../../../packages/core-models/skills.mjs";
import {
  getWorkflow, getActiveWorkflowFile, setActiveWorkflowFile,
  getPhaseOrder, loadWorkflow,
} from "../../../packages/core-models/workflow.mjs";

const router = Router();

// --- AI skill generation ---

router.post("/generate-skill", async (req, res) => {
  const { label, id, prompt, description } = req.body;
  if (!label) return res.status(400).json({ error: "label is required" });

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

  try {
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
          return res.status(500).json({ error: message.errors?.join("; ") || message.result || "Failed to generate skill" });
        }
        skill = message.result?.trim() || "";
      }
    }
    if (!skill) return res.status(500).json({ error: "Failed to generate skill" });
    res.json({ skill });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to generate skill" });
  }
});

// --- App-managed skills ---

router.get("/skills", async (_req, res) => {
  res.json({ skills: await listManagedSkills() });
});

router.post("/skills", async (req, res) => {
  try {
    await saveManagedSkill(req.body);
    res.json({ skills: await listManagedSkills() });
  } catch (err) {
    res.status(400).json({ error: err.message || "failed to save skill" });
  }
});

router.post("/skills/import", async (req, res) => {
  try {
    const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    for (const path of paths) {
      await importManagedSkills(path);
    }
    res.json({ skills: await listManagedSkills() });
  } catch (err) {
    res.status(400).json({ error: err.message || "failed to import skills" });
  }
});

router.delete("/skills/:slug", async (req, res) => {
  try {
    await deleteManagedSkill(req.params.slug);
    res.json({ skills: await listManagedSkills() });
  } catch (err) {
    res.status(400).json({ error: err.message || "failed to delete skill" });
  }
});

// --- Workflow metadata ---

router.get("/workflow", async (req, res) => {
  const WORKFLOW = getWorkflow();
  const PHASE_ORDER = getPhaseOrder();
  const mobileAccessEnabled = await readMobileAccessEnabled();
  const groups = [];
  const seenGroups = new Set();
  const phaseLabels = {};
  const phaseTypes = {};
  const rejectTargets = {};

  for (const p of WORKFLOW.phases) {
    phaseLabels[p.id] = p.label;
    phaseTypes[p.id] = p.type;
    if (p.rejectTargets) rejectTargets[p.id] = p.rejectTargets;
    if (!seenGroups.has(p.group)) {
      seenGroups.add(p.group);
      groups.push({ key: p.group, label: p.groupLabel || p.label, phases: [] });
    }
    groups.find((g) => g.key === p.group).phases.push(p.id);
  }

  res.json({
    name: WORKFLOW.name,
    activeWorkflow: getActiveWorkflowFile(),
    phaseOrder: PHASE_ORDER,
    groups,
    phaseLabels,
    phaseTypes,
    rejectTargets,
    prompts: WORKFLOW.prompts || [],
    worktree: WORKFLOW.worktree || { enabled: false, files: [] },
    mobileAccessEnabled,
  });
});

router.put("/settings/mobile-access", async (req, res) => {
  try {
    await saveMobileAccessEnabled(req.body?.enabled);
    const WORKFLOW = getWorkflow();
    const PHASE_ORDER = getPhaseOrder();
    const groups = [];
    const seenGroups = new Set();
    const phaseLabels = {};
    const phaseTypes = {};
    const rejectTargets = {};

    for (const p of WORKFLOW.phases) {
      phaseLabels[p.id] = p.label;
      phaseTypes[p.id] = p.type;
      if (p.rejectTargets) rejectTargets[p.id] = p.rejectTargets;
      if (!seenGroups.has(p.group)) {
        seenGroups.add(p.group);
        groups.push({ key: p.group, label: p.groupLabel || p.label, phases: [] });
      }
      groups.find((g) => g.key === p.group).phases.push(p.id);
    }

    res.json({
      name: WORKFLOW.name,
      activeWorkflow: getActiveWorkflowFile(),
      phaseOrder: PHASE_ORDER,
      groups,
      phaseLabels,
      phaseTypes,
      rejectTargets,
      prompts: WORKFLOW.prompts || [],
      worktree: WORKFLOW.worktree || { enabled: false, files: [] },
      mobileAccessEnabled: await readMobileAccessEnabled(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "failed to update mobile access" });
  }
});

// --- Workflow CRUD ---

router.get("/workflows", async (req, res) => {
  try {
    const files = await readdir(WORKFLOW_DIR);
    const workflows = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(await readFile(join(WORKFLOW_DIR, f), "utf-8"));
        workflows.push({
          filename: f,
          name: raw.name || f,
          phaseCount: raw.phases?.length || 0,
          prompts: raw.prompts || [],
          worktree: raw.worktree || { enabled: false, files: [] },
        });
      } catch {}
    }
    res.json({ workflows, activeWorkflow: getActiveWorkflowFile() });
  } catch {
    res.json({ workflows: [], activeWorkflow: getActiveWorkflowFile() });
  }
});

router.get("/workflows/:filename", async (req, res) => {
  const { filename } = req.params;
  if (!filename.endsWith(".json")) return res.status(400).json({ error: "invalid filename" });
  try {
    const raw = await readFile(join(WORKFLOW_DIR, filename), "utf-8");
    res.json(JSON.parse(raw));
  } catch {
    res.status(404).json({ error: "workflow not found" });
  }
});

router.post("/workflows", async (req, res) => {
  const workflow = req.body;
  if (!workflow.name || !workflow.phases) return res.status(400).json({ error: "name and phases required" });
  const filename = workflow.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".json";
  const filepath = join(WORKFLOW_DIR, filename);
  try {
    await stat(filepath);
    return res.status(409).json({ error: "workflow with this name already exists" });
  } catch {}
  await writeFile(filepath, JSON.stringify(workflow, null, 2));
  res.json({ filename, name: workflow.name });
});

router.put("/workflows/:filename", async (req, res) => {
  const { filename } = req.params;
  if (!filename.endsWith(".json")) return res.status(400).json({ error: "invalid filename" });
  const workflow = req.body;
  if (!workflow.name || !workflow.phases) return res.status(400).json({ error: "name and phases required" });
  await writeFile(join(WORKFLOW_DIR, filename), JSON.stringify(workflow, null, 2));
  if (filename === getActiveWorkflowFile()) {
    loadWorkflow(join(WORKFLOW_DIR, filename));
  }
  res.json({ filename, name: workflow.name });
});

router.delete("/workflows/:filename", async (req, res) => {
  const { filename } = req.params;
  if (!filename.endsWith(".json")) return res.status(400).json({ error: "invalid filename" });
  try {
    const files = (await readdir(WORKFLOW_DIR)).filter((file) => file.endsWith(".json"));
    if (!files.includes(filename)) return res.status(404).json({ error: "workflow not found" });
    if (files.length <= 1) return res.status(400).json({ error: "at least one workflow must remain" });

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
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "workflow not found" });
  }
});

router.put("/workflows/:filename/activate", async (req, res) => {
  const { filename } = req.params;
  if (!filename.endsWith(".json")) return res.status(400).json({ error: "invalid filename" });
  try {
    loadWorkflow(join(WORKFLOW_DIR, filename));
    setActiveWorkflowFile(filename);
    const config = await readConfig();
    config.activeWorkflow = filename;
    await saveConfig(config);
    res.json({ activeWorkflow: filename });
  } catch (err) {
    res.status(400).json({ error: `failed to load workflow: ${err.message}` });
  }
});

export default router;
