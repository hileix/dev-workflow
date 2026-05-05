import { WebSocketServer } from "ws";
import { mkdir } from "fs/promises";
import { getBaseDir } from "../../../packages/core-models/config.mjs";
import { getPhaseOrder, getRejectTargets, isAutoPhase, nextPhase } from "../../../packages/core-models/workflow.mjs";
import { createTaskRunDir, readState, writeState, makeInitialState, updatePhaseStatus, appendToPhaseFile, appendPhaseInteraction, clearTaskData } from "../../../packages/core-models/state.mjs";
import { upsertTask } from "../../../packages/core-models/workfolders.mjs";
import {
  activeWorkflows,
  wsSend,
  runPhase,
  readArtifact,
  getPhaseContent,
  continuePhaseConversation,
  completePhaseAfterUserTurn,
} from "../../../packages/core-lib/claude.mjs";

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === "start") {
        const { taskId, workFolder, contextValues, images, runId } = msg;
        if (!taskId || !workFolder) return wsSend(ws, { type: "error", message: "taskId and workFolder required" });

        let existingState = null;
        try { existingState = await readState(taskId, runId || ""); } catch {}

        if (existingState && existingState.overallStatus !== "completed") {
          const phaseSessionIds = {};
          for (const p of existingState.phases) {
            if (p.sessionId) phaseSessionIds[p.id] = p.sessionId;
          }
          activeWorkflows.set(taskId, {
            workFolder: existingState.workFolder,
            send: (payload) => wsSend(ws, payload),
            ws,
            abortController: null,
            phaseSessionIds,
            runId: existingState.runId || runId || "",
          });
          wsSend(ws, { type: "state", state: existingState });

          for (const p of existingState.phases) {
            const content = await getPhaseContent(taskId, p.id, existingState.runId || runId || "");
            if (content) wsSend(ws, { type: "phase_content", phase: p.id, content });
            if (p.status !== "pending") {
              const artifact = await readArtifact(taskId, p.id, existingState.runId || runId || "");
              if (artifact) wsSend(ws, { type: "phase_artifact", phase: p.id, content: artifact });
            }
          }

          const cur = existingState.currentPhase;
          if (cur && isAutoPhase(cur)) {
            const curPhase = existingState.phases.find((p) => p.id === cur);
            if (curPhase && curPhase.status === "in_progress") {
              runPhase(taskId, cur, phaseSessionIds[cur] || null);
            }
          }
        } else {
          if (existingState) await clearTaskData(taskId, runId || existingState.runId || "");
          const PHASE_ORDER = getPhaseOrder();
          const finalRunId = runId || `run-${Date.now()}`;
          const dir = await createTaskRunDir(taskId, finalRunId);

          const baseDir = await getBaseDir();
          const state = makeInitialState(taskId, workFolder, baseDir, contextValues, { runId: finalRunId });
          updatePhaseStatus(state, PHASE_ORDER[0], "in_progress");
          await writeState(taskId, state);

          activeWorkflows.set(taskId, {
            workFolder,
            send: (payload) => wsSend(ws, payload),
            ws,
            abortController: null,
            phaseSessionIds: {},
            startImages: images || [],
            runId: finalRunId,
          });
          await upsertTask(workFolder, taskId, "in_progress", finalRunId);
          wsSend(ws, { type: "state", state });
          runPhase(taskId, PHASE_ORDER[0]);
        }

      } else if (msg.type === "approve") {
        const { taskId, runId } = msg;
        const wf = activeWorkflows.get(taskId);
        if (!wf) return wsSend(ws, { type: "error", message: "workflow not found" });

        try {
          const state = await readState(taskId, runId || wf.runId || "");
          const cur = state.currentPhase;
          if (isAutoPhase(cur)) {
            return wsSend(ws, { type: "error", message: `cannot approve auto phase ${cur}` });
          }
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
            upsertTask(wf.workFolder, taskId, "completed", state.runId || wf.runId || "", { create: false }).catch(() => {});
          }
          await writeState(taskId, state);
          wsSend(ws, { type: "state", state });

          if (next && isAutoPhase(next)) {
            runPhase(taskId, next);
          }
        } catch (err) {
          wsSend(ws, { type: "error", message: err.message });
        }

      } else if (msg.type === "reject") {
        const { taskId, rejectTo, runId } = msg;
        const wf = activeWorkflows.get(taskId);
        if (!wf) return wsSend(ws, { type: "error", message: "workflow not found" });

        try {
          const PHASE_ORDER = getPhaseOrder();
          const REJECT_TARGETS = getRejectTargets();
          const state = await readState(taskId, runId || wf.runId || "");
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
          await writeState(taskId, state);
          wsSend(ws, { type: "state", state });

          const content = await getPhaseContent(taskId, rejectTo, state.runId || runId || wf.runId || "");
          if (content) wsSend(ws, { type: "phase_content", phase: rejectTo, content });
        } catch (err) {
          wsSend(ws, { type: "error", message: err.message });
        }

      } else if (msg.type === "message") {
        const { taskId, text, images, runId } = msg;
        const wf = activeWorkflows.get(taskId);
        if (!wf) return wsSend(ws, { type: "error", message: "workflow not found" });

        try {
          const state = await readState(taskId, runId || wf.runId || "");
          const phase = state.currentPhase;
          const stateRunId = state.runId || runId || wf.runId || "";

          const userBlock = `\n\n---\n\n**You:** ${text}\n\n`;
          await appendToPhaseFile(taskId, phase, userBlock, stateRunId);
          const interaction = await appendPhaseInteraction(taskId, phase, {
            role: "user",
            type: "user_message",
            text,
            imageCount: images?.length || 0,
          }, stateRunId);
          if (interaction) wsSend(ws, { type: "phase_interaction", phase, interaction });
          wsSend(ws, { type: "user_message", phase, text });

          updatePhaseStatus(state, phase, "in_progress");
          state.overallStatus = "in_progress";
          await writeState(taskId, state);
          wsSend(ws, { type: "state", state });
          wf.runId = stateRunId;
          await continuePhaseConversation(taskId, phase, text, images || [], { mode: "phase_revision" });
          await completePhaseAfterUserTurn(taskId, phase, stateRunId);
          wsSend(ws, { type: "phase_done", phase });
        } catch (err) {
          wsSend(ws, { type: "error", message: err.message });
        }

      } else if (msg.type === "restart_phase") {
        const { taskId, phase, runId } = msg;
        if (!taskId || !phase) return wsSend(ws, { type: "error", message: "taskId and phase required" });
        if (!isAutoPhase(phase)) return wsSend(ws, { type: "error", message: `cannot restart manual phase ${phase}` });

        try {
          const existing = activeWorkflows.get(taskId);
          const state = await readState(taskId, runId || existing?.runId || "");
          if (state.currentPhase !== phase) {
            return wsSend(ws, { type: "error", message: `cannot restart ${phase} while current phase is ${state.currentPhase}` });
          }

          const phaseSessionIds = {};
          for (const p of state.phases) {
            if (p.sessionId) phaseSessionIds[p.id] = p.sessionId;
          }

          if (existing?.abortController) {
            try { existing.abortController.abort(); } catch {}
          }
          activeWorkflows.set(taskId, {
            ...existing,
            workFolder: existing?.workFolder || state.workFolder,
            send: (payload) => wsSend(ws, payload),
            ws,
            abortController: null,
            phaseSessionIds,
            runId: state.runId || existing?.runId || "",
          });

          updatePhaseStatus(state, phase, "in_progress", null);
          state.overallStatus = "in_progress";
          await writeState(taskId, state);
          wsSend(ws, { type: "state", state });
          wsSend(ws, { type: "phase_restarted", phase });
          runPhase(taskId, phase);
        } catch (err) {
          wsSend(ws, { type: "error", message: err.message });
        }

      } else if (msg.type === "pause_phase") {
        const { taskId, phase, runId } = msg;
        if (!taskId || !phase) return wsSend(ws, { type: "error", message: "taskId and phase required" });

        try {
          const wf = activeWorkflows.get(taskId);
          const state = await readState(taskId, runId || wf?.runId || "");
          if (state.currentPhase !== phase) {
            return wsSend(ws, { type: "error", message: `cannot pause ${phase} while current phase is ${state.currentPhase}` });
          }

          if (wf) {
            wf.send = (payload) => wsSend(ws, payload);
            if (wf.abortController) {
              try { wf.abortController.abort(); } catch {}
              wf.abortController = null;
            }
          }

          updatePhaseStatus(state, phase, "awaiting_input");
          state.overallStatus = "awaiting_input";
          await writeState(taskId, state);
          upsertTask(state.originalWorkFolder || state.workFolder, taskId, "awaiting_input", state.runId || "", { create: false }).catch(() => {});
          wsSend(ws, { type: "phase_paused", phase });
          wsSend(ws, { type: "state", state });
        } catch (err) {
          wsSend(ws, { type: "error", message: err.message });
        }

      } else if (msg.type === "get_content") {
        const { taskId, phase, runId } = msg;
        const wf = activeWorkflows.get(taskId);
        if (!wf) return;
        const content = await getPhaseContent(taskId, phase, runId || wf.runId || "");
        wsSend(ws, { type: "phase_content", phase, content });
      }
    });

    ws.on("close", () => {
      for (const [, wf] of activeWorkflows) {
        if (wf.ws === ws && wf.abortController) {
          try { wf.abortController.abort(); } catch {}
          wf.abortController = null;
        }
      }
    });
  });
}
