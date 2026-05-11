import { Router } from "express";
import { join } from "path";
import { readFile, writeFile, readdir, stat, unlink, mkdir } from "fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  readConfig,
  saveConfig,
  getWorkflowDir,
  readAiBackendOverride,
  readMobileAccessEnabled,
  saveAiBackendOverride,
  saveMobileAccessEnabled,
} from "../../../packages/core-models/config.mjs";
import { deleteManagedSkill, importManagedSkills, listManagedSkills, saveManagedSkill } from "../../../packages/core-models/skills.mjs";
import {
  assertSafeWorkflowFilename,
  getWorkflow, getActiveWorkflowFile, setActiveWorkflowFile,
  deriveContextFields, getWorkflowConfigShape, loadWorkflow, unloadWorkflow,
} from "../../../packages/core-models/workflow.mjs";
import { validateWorkflowDsl } from "../../../packages/core-lib/langgraph-runtime/index.mjs";

const router = Router();

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

function getWorkflowFilename(workflow) {
  const name = String(workflow?.name || "").trim();
  if (!name) throw new Error("workflow name is required");
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".json";
}

async function writeWorkflowFile(filename, workflow, isDraft) {
  if (!String(workflow?.name || "").trim()) throw new Error("workflow name is required");
  const workflowDir = await ensureWorkflowDir();
  await writeFile(join(workflowDir, filename), JSON.stringify(workflow, null, 2));
  if (!isDraft && filename === getActiveWorkflowFile()) {
    loadWorkflow(join(workflowDir, filename));
  }
  return { filename, name: workflow.name };
}

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
  const mobileAccessEnabled = await readMobileAccessEnabled();
  const aiBackendOverride = await readAiBackendOverride();
  if (!WORKFLOW) {
    return res.json(buildEmptyWorkflowConfig(mobileAccessEnabled, aiBackendOverride));
  }

  res.json({
    ...getWorkflowConfigShape(WORKFLOW),
    mobileAccessEnabled,
    aiBackendOverride,
  });
});

router.put("/settings/mobile-access", async (req, res) => {
  try {
    await saveMobileAccessEnabled(req.body?.enabled);
    const WORKFLOW = getWorkflow();
    if (!WORKFLOW) return res.json(buildEmptyWorkflowConfig(await readMobileAccessEnabled(), await readAiBackendOverride()));

    res.json({
      ...getWorkflowConfigShape(WORKFLOW),
      mobileAccessEnabled: await readMobileAccessEnabled(),
      aiBackendOverride: await readAiBackendOverride(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "failed to update mobile access" });
  }
});

router.put("/settings/ai-backend", async (req, res) => {
  try {
    await saveAiBackendOverride(req.body?.backend);
    const WORKFLOW = getWorkflow();
    if (!WORKFLOW) return res.json(buildEmptyWorkflowConfig(await readMobileAccessEnabled(), await readAiBackendOverride()));

    res.json({
      ...getWorkflowConfigShape(WORKFLOW),
      mobileAccessEnabled: await readMobileAccessEnabled(),
      aiBackendOverride: await readAiBackendOverride(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "failed to update AI backend" });
  }
});

// --- Workflow CRUD ---

router.get("/workflows", async (req, res) => {
  const workflowDir = await ensureWorkflowDir();
  try {
    const files = await readdir(workflowDir);
    const workflows = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(await readFile(join(workflowDir, f), "utf-8"));
        const workflowConfig = getWorkflowConfigShape(raw);
        workflows.push({
          filename: f,
          name: raw.name || f,
          phaseCount: workflowConfig.phaseOrder.length,
          phaseOrder: workflowConfig.phaseOrder,
          groups: workflowConfig.groups,
          workflowConfig,
          contextFields: deriveContextFields(raw),
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
  try {
    const filename = assertSafeWorkflowFilename(req.params.filename);
    const raw = await readFile(join(await ensureWorkflowDir(), filename), "utf-8");
    res.json(JSON.parse(raw));
  } catch {
    res.status(400).json({ error: "workflow not found" });
  }
});

router.post("/workflows", async (req, res) => {
  const isDraft = req.query.draft === "1";
  let workflow;
  try {
    workflow = isDraft ? req.body : validateWorkflowDsl(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message || "invalid workflow DSL" });
  }
  let filename;
  try {
    filename = getWorkflowFilename(workflow);
  } catch (err) {
    return res.status(400).json({ error: err.message || "invalid workflow DSL" });
  }
  const workflowDir = await ensureWorkflowDir();
  const filepath = join(workflowDir, filename);
  try {
    await stat(filepath);
    return res.status(409).json({ error: "workflow with this name already exists" });
  } catch {}
  await writeFile(filepath, JSON.stringify(workflow, null, 2));
  if (!isDraft && !getWorkflow()) {
    loadWorkflow(filepath);
    setActiveWorkflowFile(filename);
    const config = await readConfig();
    config.activeWorkflow = filename;
    await saveConfig(config);
  }
  res.json({ filename, name: workflow.name });
});

router.put("/workflows/:filename", async (req, res) => {
  let filename;
  try {
    filename = assertSafeWorkflowFilename(req.params.filename);
  } catch {
    return res.status(400).json({ error: "invalid filename" });
  }
  const isDraft = req.query.draft === "1";
  let workflow;
  try {
    workflow = isDraft ? req.body : validateWorkflowDsl(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message || "invalid workflow DSL" });
  }
  try {
    res.json(await writeWorkflowFile(filename, workflow, isDraft));
  } catch (err) {
    res.status(400).json({ error: err.message || "invalid workflow DSL" });
  }
});

router.delete("/workflows/:filename", async (req, res) => {
  try {
    const filename = assertSafeWorkflowFilename(req.params.filename);
    const workflowDir = await ensureWorkflowDir();
    const files = (await readdir(workflowDir)).filter((file) => file.endsWith(".json"));
    if (!files.includes(filename)) return res.status(404).json({ error: "workflow not found" });

    await unlink(join(workflowDir, filename));
    if (getActiveWorkflowFile() === filename) {
      const remaining = files.filter((file) => file !== filename).sort();
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
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "workflow not found" });
  }
});

router.put("/workflows/:filename/activate", async (req, res) => {
  try {
    const filename = assertSafeWorkflowFilename(req.params.filename);
    const workflowDir = await ensureWorkflowDir();
    loadWorkflow(join(workflowDir, filename));
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
