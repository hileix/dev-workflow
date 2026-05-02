import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import { mkdir } from "fs/promises";
import { getBaseDir } from "../models/config.mjs";
import { getPhaseOrder, getRejectTargets, isAutoPhase, nextPhase } from "../models/workflow.mjs";
import { taskDir, readState, writeState, makeInitialState, updatePhaseStatus, appendToPhaseFile, clearTaskData } from "../models/state.mjs";
import { upsertTask } from "../models/workfolders.mjs";
import { activeWorkflows, wsSend, formatToolLog, runPhase, readArtifact, getPhaseContent } from "../lib/claude.mjs";

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === "start") {
        const { ticketId, workFolder, promptValues, images } = msg;
        if (!ticketId || !workFolder) return wsSend(ws, { type: "error", message: "ticketId and workFolder required" });

        let existingState = null;
        try { existingState = await readState(ticketId); } catch {}

        if (existingState && existingState.overallStatus !== "completed") {
          const phaseSessionIds = {};
          for (const p of existingState.phases) {
            if (p.sessionId) phaseSessionIds[p.id] = p.sessionId;
          }
          activeWorkflows.set(ticketId, { workFolder: existingState.workFolder, ws, child: null, phaseSessionIds });
          wsSend(ws, { type: "state", state: existingState });

          for (const p of existingState.phases) {
            const content = await getPhaseContent(ticketId, p.id);
            if (content) wsSend(ws, { type: "phase_content", phase: p.id, content });
            if (p.status !== "pending") {
              const artifact = await readArtifact(ticketId, p.id);
              if (artifact) wsSend(ws, { type: "phase_artifact", phase: p.id, content: artifact });
            }
          }

          const cur = existingState.currentPhase;
          if (cur && isAutoPhase(cur)) {
            const curPhase = existingState.phases.find((p) => p.id === cur);
            if (curPhase && curPhase.status === "in_progress") {
              runPhase(ticketId, cur, phaseSessionIds[cur] || null);
            }
          }
        } else {
          if (existingState) await clearTaskData(ticketId);
          const PHASE_ORDER = getPhaseOrder();
          const dir = await taskDir(ticketId);
          await mkdir(dir, { recursive: true });

          const baseDir = await getBaseDir();
          const state = makeInitialState(ticketId, workFolder, baseDir, promptValues);
          updatePhaseStatus(state, PHASE_ORDER[0], "in_progress");
          await writeState(ticketId, state);

          activeWorkflows.set(ticketId, { workFolder, ws, child: null, phaseSessionIds: {}, startImages: images || [] });
          await upsertTask(workFolder, ticketId, "in_progress");
          wsSend(ws, { type: "state", state });
          runPhase(ticketId, PHASE_ORDER[0]);
        }

      } else if (msg.type === "approve") {
        const { ticketId } = msg;
        const wf = activeWorkflows.get(ticketId);
        if (!wf) return wsSend(ws, { type: "error", message: "workflow not found" });

        try {
          const state = await readState(ticketId);
          const cur = state.currentPhase;
          updatePhaseStatus(state, cur, "completed");
          const next = nextPhase(cur);
          if (next) {
            state.currentPhase = next;
            if (isAutoPhase(next)) {
              updatePhaseStatus(state, next, "in_progress");
              state.overallStatus = "in_progress";
            } else {
              updatePhaseStatus(state, next, "awaiting_input");
              state.overallStatus = "awaiting_input";
            }
          } else {
            state.overallStatus = "completed";
            state.currentPhase = "completed";
            upsertTask(wf.workFolder, ticketId, "completed").catch(() => {});
          }
          await writeState(ticketId, state);
          wsSend(ws, { type: "state", state });

          if (next && isAutoPhase(next)) {
            runPhase(ticketId, next);
          }
        } catch (err) {
          wsSend(ws, { type: "error", message: err.message });
        }

      } else if (msg.type === "reject") {
        const { ticketId, rejectTo } = msg;
        const wf = activeWorkflows.get(ticketId);
        if (!wf) return wsSend(ws, { type: "error", message: "workflow not found" });

        try {
          const PHASE_ORDER = getPhaseOrder();
          const REJECT_TARGETS = getRejectTargets();
          const state = await readState(ticketId);
          const cur = state.currentPhase;
          const allowed = REJECT_TARGETS[cur];
          if (!allowed || !allowed.includes(rejectTo)) {
            return wsSend(ws, { type: "error", message: `cannot reject from ${cur} to ${rejectTo}` });
          }

          const targetIdx = PHASE_ORDER.indexOf(rejectTo);
          for (let i = targetIdx; i < PHASE_ORDER.length; i++) {
            const pid = PHASE_ORDER[i];
            updatePhaseStatus(state, pid, pid === rejectTo ? "awaiting_input" : "pending");
          }
          state.currentPhase = rejectTo;
          state.overallStatus = "awaiting_input";
          await writeState(ticketId, state);
          wsSend(ws, { type: "state", state });

          const content = await getPhaseContent(ticketId, rejectTo);
          if (content) wsSend(ws, { type: "phase_content", phase: rejectTo, content });
        } catch (err) {
          wsSend(ws, { type: "error", message: err.message });
        }

      } else if (msg.type === "message") {
        const { ticketId, text, images } = msg;
        const wf = activeWorkflows.get(ticketId);
        if (!wf) return wsSend(ws, { type: "error", message: "workflow not found" });

        try {
          const state = await readState(ticketId);
          const phase = state.currentPhase;
          const priorSessionId = wf.phaseSessionIds[phase] || null;

          const userBlock = `\n\n---\n\n**You:** ${text}\n\n`;
          appendToPhaseFile(ticketId, phase, userBlock);
          wsSend(ws, { type: "user_message", phase, text });

          const prompt = text;
          const args = [
            "-p", prompt,
            "--output-format", "stream-json",
            "--include-partial-messages",
            "--verbose",
            "--dangerously-skip-permissions",
          ];
          if (images && images.length > 0) {
            for (const imgPath of images) args.push("--file", imgPath);
          }
          if (priorSessionId) args.push("--resume", priorSessionId);

          updatePhaseStatus(state, phase, "in_progress");
          state.overallStatus = "in_progress";
          await writeState(ticketId, state);
          wsSend(ws, { type: "state", state });

          const child = spawn(process.env.CLAUDE_PATH || "claude", args, {
            cwd: wf.workFolder,
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
                  const t = inner.delta.text;
                  wsSend(ws, { type: "text_delta", phase, text: t });
                  appendToPhaseFile(ticketId, phase, t);
                } else if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use") {
                  currentTool = inner.content_block.name;
                  toolInputJson = "";
                } else if (inner.type === "content_block_delta" && inner.delta?.type === "input_json_delta") {
                  toolInputJson += inner.delta.partial_json;
                } else if (inner.type === "content_block_stop" && currentTool) {
                  const log = formatToolLog(currentTool, toolInputJson);
                  const logMsg = `\n\n*${log}*\n\n`;
                  wsSend(ws, { type: "tool_use", phase, name: currentTool, log });
                  appendToPhaseFile(ticketId, phase, logMsg);
                  currentTool = null;
                  toolInputJson = "";
                }
              } else if (event.type === "result") {
                wf.phaseSessionIds[phase] = event.session_id;
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
              const st = await readState(ticketId);
              wsSend(ws, { type: "phase_done", phase });
              wsSend(ws, { type: "state", state: st });
            } catch {}
          });
        } catch (err) {
          wsSend(ws, { type: "error", message: err.message });
        }

      } else if (msg.type === "get_content") {
        const { ticketId, phase } = msg;
        const wf = activeWorkflows.get(ticketId);
        if (!wf) return;
        const content = await getPhaseContent(ticketId, phase);
        wsSend(ws, { type: "phase_content", phase, content });
      }
    });

    ws.on("close", () => {
      for (const [, wf] of activeWorkflows) {
        if (wf.ws === ws && wf.child) {
          wf.child.kill();
        }
      }
    });
  });
}
