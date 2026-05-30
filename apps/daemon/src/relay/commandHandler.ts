import {
  COMMAND_TYPE,
  CommandRequestSchema,
  PROTOCOL_VERSION,
  RELAY_DAEMON_MESSAGE_TYPES,
} from "@dev-workflow/protocol";
import { activateWorkflow } from "../services/workflowService";
import { removeTask } from "../services/taskService";
import {
  approveWorkflow,
  pauseWorkflowPhase,
  rejectWorkflow,
  resumeWorkflowPhase,
  retryWorkflowPhase,
  sendWorkflowMessage,
  startWorkflowSession,
} from "../runtime/workflow-runtime";
import { createRelayTaskSender, normalizeImagePayload, pushTaskSnapshot } from "./taskSnapshots.ts";
import { defaultWorkFolder, knownTasks, sendToRelay } from "./state.ts";

function runWorkflowCommand(taskId, sender, operation) {
  Promise.resolve()
    .then(operation)
    .catch((error) => {
      sender({
        type: "error",
        taskId,
        message: error.message || "workflow error",
      });
    });
}

function sendCommandResult(commandId, status, error = "") {
  sendToRelay({
    type: RELAY_DAEMON_MESSAGE_TYPES.commandResult,
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    status,
    error,
  });
}

export async function handleCommand(message) {
  const parsedMessage = CommandRequestSchema.parse(message);
  const { commandId, taskId, command } = parsedMessage;
  const payload = (parsedMessage.payload || {}) as Record<string, any>;
  const taskInfo = knownTasks.get(taskId);
  const workFolder = payload?.workFolder || taskInfo?.workFolder || defaultWorkFolder;
  const runId = String(payload?.runId || taskInfo?.runId || "").trim();

  const sendResult = (status, error = "") => sendCommandResult(commandId, status, error);

  if (command === COMMAND_TYPE.startWorkflow) {
    if (!taskId || !workFolder) {
      sendResult("error", "taskId and workFolder are required");
      return;
    }
    try {
      const workflowFilename = String(payload?.workflowFilename || "").trim();
      const startRunId = String(payload?.runId || knownTasks.get(taskId)?.runId || "").trim() || `run-${Date.now()}`;
      const imagePaths = await normalizeImagePayload(startRunId, payload?.images || []);
      if (workflowFilename) {
        await activateWorkflow(workflowFilename);
      }
      knownTasks.set(taskId, { workFolder, runId: startRunId });
      const sender = createRelayTaskSender(taskId, workFolder, startRunId);
      runWorkflowCommand(taskId, sender, () => startWorkflowSession(taskId, workFolder, payload?.taskInputs || {}, imagePaths, startRunId, sender, {
        worktreeName: payload?.worktreeName || "",
        workflowFilename,
      }));
      sendResult("ok");
    } catch (error) {
      sendResult("error", error.message);
    }
    return;
  }

  if (command === COMMAND_TYPE.deleteTask) {
    if (!taskId) {
      sendResult("error", "taskId is required");
      return;
    }
    try {
      await removeTask(taskId, runId, { removeWorktree: Boolean(payload?.removeWorktree) });
      knownTasks.delete(taskId);
      sendToRelay({
        type: RELAY_DAEMON_MESSAGE_TYPES.taskRemoved,
        protocolVersion: PROTOCOL_VERSION,
        taskId,
        runId,
      });
      sendResult("ok");
    } catch (error) {
      sendResult("error", error.message);
    }
    return;
  }

  if (command === COMMAND_TYPE.syncTask) {
    pushTaskSnapshot(taskId).then(() => sendResult("ok")).catch((error) => sendResult("error", error.message));
    return;
  }

  const sender = createRelayTaskSender(taskId, workFolder, runId);
  try {
    if (command === COMMAND_TYPE.approve) {
      runWorkflowCommand(taskId, sender, () => approveWorkflow(taskId, sender, runId));
      sendResult("ok");
      return;
    }
    if (command === COMMAND_TYPE.reject) {
      runWorkflowCommand(taskId, sender, () => rejectWorkflow(taskId, payload?.rejectTo, payload?.reason || "", sender, runId));
      sendResult("ok");
      return;
    }
    if (command === COMMAND_TYPE.message) {
      const imagePaths = await normalizeImagePayload(runId, payload?.images || []);
      runWorkflowCommand(taskId, sender, () => sendWorkflowMessage(taskId, payload?.text || "", imagePaths, sender, runId));
      sendResult("ok");
      return;
    }
    if (command === COMMAND_TYPE.resumePhase) {
      runWorkflowCommand(taskId, sender, () => resumeWorkflowPhase(taskId, payload?.phase, sender, runId));
      sendResult("ok");
      return;
    }
    if (command === COMMAND_TYPE.retryPhase) {
      runWorkflowCommand(taskId, sender, () => retryWorkflowPhase(taskId, payload?.phase, sender, runId));
      sendResult("ok");
      return;
    }
    if (command === COMMAND_TYPE.pausePhase) {
      runWorkflowCommand(taskId, sender, () => pauseWorkflowPhase(taskId, payload?.phase, sender, runId));
      sendResult("ok");
      return;
    }
  } catch (error) {
    sendResult("error", error.message);
    return;
  }

  sendResult("error", "unsupported command");
}
