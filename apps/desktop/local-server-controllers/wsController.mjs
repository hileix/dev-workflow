import { WebSocketServer } from "ws";
import { wsSend } from "../../../packages/core-lib/claude.mjs";
import {
  approveWorkflow,
  pauseWorkflowPhase,
  rejectWorkflow,
  restartWorkflowPhase,
  sendWorkflowMessage,
  startWorkflowSession,
} from "../electron/workflow-runtime.mjs";

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    const send = (payload) => wsSend(ws, payload);

    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      try {
        if (msg.type === "start") {
          await startWorkflowSession(msg.taskId, msg.workFolder, msg.contextValues, msg.images, msg.runId, send, {
            worktreeName: msg.worktreeName,
            workflowFilename: msg.workflowFilename,
          });
        } else if (msg.type === "approve") {
          await approveWorkflow(msg.taskId, send, msg.runId);
        } else if (msg.type === "reject") {
          await rejectWorkflow(msg.taskId, msg.rejectTo, msg.reason, send, msg.runId);
        } else if (msg.type === "message") {
          await sendWorkflowMessage(msg.taskId, msg.text, msg.images, send, msg.runId);
        } else if (msg.type === "restart_phase") {
          await restartWorkflowPhase(msg.taskId, msg.phase, send, msg.runId);
        } else if (msg.type === "pause_phase") {
          await pauseWorkflowPhase(msg.taskId, msg.phase, send, msg.runId);
        }
      } catch (err) {
        send({ type: "error", taskId: msg.taskId, runId: msg.runId || "", message: err.message || "workflow error" });
      }
    });

    ws.on("close", () => {
      // The active task id is not tracked per socket here; aborting is handled by explicit detach/delete.
    });
  });
}
