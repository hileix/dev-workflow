import { join } from "path";
import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { getBaseDir } from "../models/config.mjs";
import { getPhaseSkills, getPhaseArtifactFiles, isAutoPhase, nextPhase } from "../models/workflow.mjs";
import { readState, writeState, updatePhaseStatus, appendToPhaseFile, readPhaseMessages, taskDir } from "../models/state.mjs";
import { upsertTask } from "../models/workfolders.mjs";

export const activeWorkflows = new Map();

export function sendWorkflowEvent(send, data) {
  if (!send) return;
  try {
    send(data);
  } catch {}
}

export function killAllChildren() {
  for (const [, wf] of activeWorkflows) {
    if (wf.child) {
      wf.child.kill();
      wf.child = null;
    }
  }
}

export function formatToolLog(name, input) {
  try {
    const parsed = JSON.parse(input);
    if (name === "Bash" && parsed.command) return `\`$ ${parsed.command}\``;
    if (name === "Read" && parsed.file_path) return `Reading \`${parsed.file_path}\``;
    if (name === "Edit" && parsed.file_path) return `Editing \`${parsed.file_path}\``;
    if (name === "Write" && parsed.file_path) return `Writing \`${parsed.file_path}\``;
    if ((name === "Grep" || name === "Glob") && parsed.pattern) return `${name}: \`${parsed.pattern}\``;
    if (name === "Skill" && parsed.skill) return `Skill: \`/${parsed.skill}\``;
    return `${name}`;
  } catch {
    return `${name}`;
  }
}

export async function readArtifact(ticketId, phase) {
  const PHASE_ARTIFACT_FILES = getPhaseArtifactFiles();
  const fn = PHASE_ARTIFACT_FILES[phase];
  if (fn) {
    try { return await readFile(join(await taskDir(ticketId), fn(ticketId)), "utf-8"); } catch {}
  }
  return "";
}

export async function getPhaseContent(ticketId, phase) {
  const messages = await readPhaseMessages(ticketId, phase);
  if (!isAutoPhase(phase)) {
    const artifact = await readArtifact(ticketId, phase);
    if (artifact) return messages ? artifact + "\n\n---\n\n" + messages : artifact;
  }
  if (messages) return messages;
  const artifact = await readArtifact(ticketId, phase);
  if (artifact) return artifact;
  return "";
}

export async function runPhase(ticketId, phase, sessionId) {
  const wf = activeWorkflows.get(ticketId);
  if (!wf) return;
  const { workFolder, send } = wf;

  const baseDir = await getBaseDir();
  const state = await readState(ticketId);
  const promptValues = state.promptValues || {};
  const PHASE_SKILLS = getPhaseSkills();
  const skillFn = PHASE_SKILLS[phase];
  const prompt = skillFn ? skillFn(ticketId, baseDir, promptValues) : "";

  const args = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--dangerously-skip-permissions",
  ];

  if (wf.startImages && wf.startImages.length > 0) {
    for (const imgPath of wf.startImages) args.push("--file", imgPath);
    wf.startImages = [];
  }

  if (sessionId) args.push("--resume", sessionId);

  const child = spawn(process.env.CLAUDE_PATH || "claude", args, {
    cwd: workFolder,
    stdio: ["ignore", "pipe", "pipe"],
  });
  wf.child = child;

  let buffer = "";
  let currentTool = null;
  let toolInputJson = "";

  function processLine(line) {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event.type === "stream_event") {
        const inner = event.event;
        if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta") {
          const text = inner.delta.text;
          sendWorkflowEvent(send, { type: "text_delta", phase, text });
          appendToPhaseFile(ticketId, phase, text);
        } else if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use") {
          currentTool = inner.content_block.name;
          toolInputJson = "";
        } else if (inner.type === "content_block_delta" && inner.delta?.type === "input_json_delta") {
          toolInputJson += inner.delta.partial_json;
        } else if (inner.type === "content_block_stop" && currentTool) {
          const log = formatToolLog(currentTool, toolInputJson);
          const msg = `\n\n*${log}*\n\n`;
          sendWorkflowEvent(send, { type: "tool_use", phase, name: currentTool, log });
          appendToPhaseFile(ticketId, phase, msg);
          currentTool = null;
          toolInputJson = "";
        }
      } else if (event.type === "result") {
        const sid = event.session_id;
        wf.phaseSessionIds[phase] = sid;
        readState(ticketId).then((state) => {
          const p = state.phases.find((p) => p.id === phase);
          updatePhaseStatus(state, phase, p?.status || "in_progress", sid);
          writeState(ticketId, state);
        }).catch(() => {});
      }
    } catch {}
  }

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const l of lines) processLine(l);
  });

  child.stderr.on("data", () => {});

  child.on("close", async () => {
    if (buffer.trim()) processLine(buffer);
    wf.child = null;

    try {
      const state = await readState(ticketId);
      updatePhaseStatus(state, phase, "completed");
      const next = nextPhase(phase);
      if (next) {
        state.currentPhase = next;
        if (!isAutoPhase(next)) {
          updatePhaseStatus(state, next, "awaiting_input");
          state.overallStatus = "awaiting_input";
          upsertTask(workFolder, ticketId, "awaiting_input").catch(() => {});
        } else {
          updatePhaseStatus(state, next, "in_progress");
        }
      } else {
        state.overallStatus = "completed";
        state.currentPhase = "completed";
        upsertTask(workFolder, ticketId, "completed").catch(() => {});
      }
      await writeState(ticketId, state);
      sendWorkflowEvent(send, { type: "state", state });

      let artifact = await readArtifact(ticketId, phase);
      if (!artifact) {
        const messages = await readPhaseMessages(ticketId, phase);
        if (messages) artifact = messages;
      }
      if (artifact) sendWorkflowEvent(send, { type: "phase_artifact", phase, content: artifact });

      if (next && !isAutoPhase(next)) {
        const content = await getPhaseContent(ticketId, next);
        if (content) sendWorkflowEvent(send, { type: "phase_content", phase: next, content });
      }

      if (next && isAutoPhase(next)) {
        runPhase(ticketId, next);
      }
    } catch (err) {
      sendWorkflowEvent(send, { type: "error", message: err.message });
    }
  });
}
