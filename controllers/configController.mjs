import { Router } from "express";
import { join, resolve } from "path";
import { stat, mkdir } from "fs/promises";
import { readConfig, saveConfig } from "../models/config.mjs";

const router = Router();

router.get("/config", async (req, res) => {
  const config = await readConfig();
  res.json({ taskStoragePath: config.taskStoragePath || "" });
});

router.put("/config/task-storage-path", async (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: "path required" });
  const absPath = resolve(folderPath);
  try {
    const s = await stat(absPath);
    if (!s.isDirectory()) return res.status(400).json({ error: "not a directory" });
  } catch {
    return res.status(400).json({ error: "path does not exist" });
  }
  const config = await readConfig();
  config.taskStoragePath = join(absPath, ".do-a-ticket-task");
  await saveConfig(config);
  await mkdir(config.taskStoragePath, { recursive: true });
  res.json({ taskStoragePath: config.taskStoragePath });
});

export default router;
