import { Router } from "express";
import { basename, resolve, join } from "path";
import { stat, mkdir } from "fs/promises";
import { spawn } from "child_process";
import multer from "multer";
import { readWorkfolders, saveWorkfolders, deleteTask } from "../../../packages/core-models/workfolders.mjs";
import { getBaseDir } from "../../../packages/core-models/config.mjs";
import { assertSafeRunId, readState, getTaskRunId, readPhaseInteractions } from "../../../packages/core-models/state.mjs";
import { getPhaseContent, readPhaseOutputArtifacts, stopActiveWorkflow } from "../../../packages/core-lib/claude.mjs";

const upload = multer({ storage: multer.diskStorage({
  async destination(req, _file, cb) {
    try {
      const baseDir = await getBaseDir();
      const runId = assertSafeRunId(req.params.runId || "");
      if (!runId) return cb(new Error("runId required"));
      const dir = join(baseDir, runId, "uploads");
      await mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (error) {
      cb(error);
    }
  },
  filename(_req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
}) });

const router = Router();

router.get("/workfolders", async (req, res) => {
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
      } catch {
        task.phases = [];
      }
    }
  }
  res.json(folders);
});

router.post("/workfolders", async (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: "path required" });
  const absPath = resolve(folderPath);
  try {
    const s = await stat(absPath);
    if (!s.isDirectory()) return res.status(400).json({ error: "not a directory" });
  } catch {
    return res.status(400).json({ error: "path does not exist" });
  }
  const folders = await readWorkfolders();
  if (folders.some((f) => f.path === absPath)) return res.status(400).json({ error: "folder already added" });
  folders.push({ name: basename(absPath), path: absPath, tasks: [] });
  await saveWorkfolders(folders);
  res.json(folders);
});

router.delete("/workfolders", async (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: "path required" });
  let folders = await readWorkfolders();
  folders = folders.filter((f) => f.path !== folderPath);
  await saveWorkfolders(folders);
  res.json(folders);
});

router.get("/tasks/:taskId/state", async (req, res) => {
  const { taskId } = req.params;
  const runId = String(req.query.runId || "");
  try {
    const state = await readState(taskId, runId);
    const stateRunId = state.runId || runId;
    const messages = {};
    const outputArtifacts = {};
    const interactions = {};
    for (const p of state.phases) {
      const content = await getPhaseContent(taskId, p.id, stateRunId);
      if (content) messages[p.id] = content;
      const phaseInteractions = await readPhaseInteractions(taskId, p.id, stateRunId);
      if (phaseInteractions.length > 0) interactions[p.id] = phaseInteractions;
      if (p.status !== "pending") {
        const phaseOutputArtifacts = await readPhaseOutputArtifacts(taskId, p.id, stateRunId);
        if (Object.keys(phaseOutputArtifacts).length > 0) {
          outputArtifacts[p.id] = phaseOutputArtifacts;
        }
      }
    }
    res.json({ state, messages, outputArtifacts, interactions });
  } catch {
    res.status(404).json({ error: "task not found" });
  }
});

router.delete("/tasks/:taskId", async (req, res) => {
  const { taskId } = req.params;
  const runId = String(req.query.runId || "");
  const removeWorktree = req.query.removeWorktree === "1" || req.query.removeWorktree === "true";
  if (!taskId) return res.status(400).json({ error: "taskId required" });
  try {
    const safeRunId = assertSafeRunId(runId);
    stopActiveWorkflow(taskId, safeRunId);
    await deleteTask(taskId, safeRunId, { removeWorktree });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "task not found" });
  }
});

router.post("/pick-folder", (req, res) => {
  const script = 'osascript -e \'tell application "System Events" to activate\' -e \'POSIX path of (choose folder with prompt "Select a work folder")\'';
  const child = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.on("close", (code) => {
    const selected = stdout.trim().replace(/\/$/, "");
    if (code !== 0 || !selected) return res.json({ cancelled: true });
    res.json({ cancelled: false, path: selected });
  });
});

router.post("/tasks/:runId/upload", upload.array("images", 10), (req, res) => {
  const paths = (req.files || []).map((f) => f.path);
  res.json({ paths });
});

export default router;
