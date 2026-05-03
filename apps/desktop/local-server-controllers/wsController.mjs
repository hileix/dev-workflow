import { WebSocketServer } from "ws";
import { mkdir } from "fs/promises";
import { getBaseDir } from "../../../packages/core-models/config.mjs";
import { getPhaseOrder, getRejectTargets, isAutoPhase, nextPhase } from "../../../packages/core-models/workflow.mjs";
import { taskDir, readState, writeState, makeInitialState, updatePhaseStatus, appendToPhaseFile, clearTaskData } from "../../../packages/core-models/state.mjs";
import { upsertTask } from "../../../packages/core-models/workfolders.mjs";
import { activeWorkflows, wsSend, runPhase, readArtifact, getPhaseContent, continuePhaseConversation } from "../../../packages/core-lib/claude.mjs";

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === "start") {
        const { taskId, workFolder, contextValues, images } = msg;
        if (!taskId || !workFolder) return wsSend(ws, { type: "error", message: "taskId and workFolder required" });

        let existingState = null;
        try { existingState = await readState(taskId); } catch {}

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
          });
          wsSend(ws, { type: "state", state: existingState });

          for (const p of existingState.phases) {
            const content = await getPhaseContent(taskId, p.id);
            if (content) wsSend(ws, { type: "phase_content", phase: p.id, content });
            if (p.status !== "pending") {
              const artifact = await readArtifact(taskId, p.id);
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
          if (existingState) await clearTaskData(taskId);
          const PHASE_ORDER = getPhaseOrder();
          const dir = await taskDir(taskId);
          await mkdir(dir, { recursive: true });

          const baseDir = await getBaseDir();
          const state = makeInitialState(taskId, workFolder, baseDir, contextValues);
          updatePhaseStatus(state, PHASE_ORDER[0], "in_progress");
          await writeState(taskId, state);

          activeWorkflows.set(taskId, {
            workFolder,
            send: (payload) => wsSend(ws, payload),
            ws,
            abortController: null,
            phaseSessionIds: {},
            startImages: images || [],
          });
          await upsertTask(workFolder, taskId, "in_progress");
          wsSend(ws, { type: "state", state });
          runPhase(taskId, PHASE_ORDER[0]);
        }

      } else if (msg.type === "approve") {
        const { taskId } = msg;
        const wf = activeWorkflows.get(taskId);
        if (!wf) return wsSend(ws, { type: "error", message: "workflow not found" });

        try {
          const state = await readState(taskId);
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
            upsertTask(wf.workFolder, taskId, "completed").catch(() => {});
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
        const { taskId, rejectTo } = msg;
        const wf = activeWorkflows.get(taskId);
        if (!wf) return wsSend(ws, { type: "error", message: "workflow not found" });

        try {
          const PHASE_ORDER = getPhaseOrder();
          const REJECT_TARGETS = getRejectTargets();
          const state = await readState(taskId);
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

          const content = await getPhaseContent(taskId, rejectTo);
          if (content) wsSend(ws, { type: "phase_content", phase: rejectTo, content });
        } catch (err) {
          wsSend(ws, { type: "error", message: err.message });
        }

      } else if (msg.type === "message") {
        const { taskId, text, images } = msg;
        const wf = activeWorkflows.get(taskId);
        if (!wf) return wsSend(ws, { type: "error", message: "workflow not found" });

        try {
          const state = await readState(taskId);
          const phase = state.currentPhase;

          const userBlock = `\n\n---\n\n**You:** ${text}\n\n`;
          await appendToPhaseFile(taskId, phase, userBlock);
          wsSend(ws, { type: "user_message", phase, text });

          updatePhaseStatus(state, phase, "in_progress");
          state.overallStatus = "in_progress";
          await writeState(taskId, state);
          wsSend(ws, { type: "state", state });
          await continuePhaseConversation(taskId, phase, text, images || []);
          const latestState = await readState(taskId);
          updatePhaseStatus(latestState, phase, "awaiting_input");
          latestState.overallStatus = "awaiting_input";
          await writeState(taskId, latestState);
          wsSend(ws, { type: "phase_done", phase });
          wsSend(ws, { type: "state", state: latestState });
        } catch (err) {
          wsSend(ws, { type: "error", message: err.message });
        }

      } else if (msg.type === "get_content") {
        const { taskId, phase } = msg;
        const wf = activeWorkflows.get(taskId);
        if (!wf) return;
        const content = await getPhaseContent(taskId, phase);
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
