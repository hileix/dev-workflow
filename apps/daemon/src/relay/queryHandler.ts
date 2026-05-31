import {
  DAEMON_QUERY_ACTIONS,
  PROTOCOL_VERSION,
  QueryRequestSchema,
  RELAY_DAEMON_MESSAGE_TYPES,
} from "@dev-workflow/protocol";
import { deleteAiApi, getWorkflowConfig, listAiApiProfiles, saveAiApi } from "../services/settingsService";
import {
  activateWorkflow,
  createWorkflow,
  createWorkflowDraft,
  getWorkflowByFilename,
  listWorkflows as listWorkflowDefinitions,
  removeWorkflow,
  setWorkflowVisible,
  updateWorkflow,
  updateWorkflowDraft,
} from "../services/workflowService";
import { deleteSkill, generateSkill, importSkillsFromPaths, listSkills, saveSkill } from "../services/skillService";
import { addWorkFolder, listWorkFolders, removeWorkFolder } from "../services/workfolderService";
import {
  getTaskOutputPath,
  getTaskState,
  openTaskOutput,
  removeTask,
  removeTaskWorktreeOnly,
  saveTaskUploads as saveTaskUploadFiles,
} from "../services/taskService";
import { openPath } from "../services/systemService";
import { getTaskSnapshot, listTaskSnapshots } from "./taskSnapshots.ts";
import { knownTasks, sendToRelay } from "./state.ts";

export function createQueryHandler({ syncDeviceMeta }) {
  return async function handleQuery(message) {
    const parsedMessage = QueryRequestSchema.parse(message);
    const { requestId, action } = parsedMessage;
    const payload = (parsedMessage.payload || {}) as Record<string, any>;
    const reply = (ok, data = {}, error = "") => {
      sendToRelay({
        type: RELAY_DAEMON_MESSAGE_TYPES.queryResponse,
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        ok,
        data,
        error,
      });
    };

    try {
      if (action === DAEMON_QUERY_ACTIONS.listTasks) {
        reply(true, { tasks: await listTaskSnapshots() });
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.getTask) {
        const taskId = String(payload?.taskId || "").trim();
        if (!taskId) {
          reply(false, {}, "taskId is required");
          return;
        }
        const taskInfo = knownTasks.get(taskId);
        try {
          const task = await getTaskSnapshot(taskId, taskInfo?.workFolder || "", taskInfo?.runId || "");
          reply(true, { task });
        } catch (error) {
          if (error.message === "task not found") {
            reply(true, { task: null });
            return;
          }
          throw error;
        }
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.getWorkflowConfig) {
        reply(true, await getWorkflowConfig());
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.listAiApiProfiles) {
        reply(true, await listAiApiProfiles());
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.saveAiApiProfile) {
        reply(true, await saveAiApi(payload?.profile || {}));
        await syncDeviceMeta(true);
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.deleteAiApiProfile) {
        reply(true, await deleteAiApi(payload?.id));
        await syncDeviceMeta(true);
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.listWorkflows) {
        reply(true, await listWorkflowDefinitions());
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.getWorkflow) {
        reply(true, await getWorkflowByFilename(String(payload?.filename || "")));
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.setWorkflowVisible) {
        reply(true, await setWorkflowVisible(String(payload?.filename || ""), payload?.visible));
        await syncDeviceMeta(true);
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.createWorkflow) {
        reply(true, payload?.draft
          ? await createWorkflowDraft(payload?.workflow || {})
          : await createWorkflow(payload?.workflow || {}));
        await syncDeviceMeta(true);
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.updateWorkflow) {
        reply(true, payload?.draft
          ? await updateWorkflowDraft(String(payload?.filename || ""), payload?.workflow || {})
          : await updateWorkflow(String(payload?.filename || ""), payload?.workflow || {}));
        await syncDeviceMeta(true);
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.removeWorkflow) {
        reply(true, await removeWorkflow(String(payload?.filename || "")));
        await syncDeviceMeta(true);
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.activateWorkflow) {
        reply(true, await activateWorkflow(String(payload?.filename || "")));
        await syncDeviceMeta(true);
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.generateSkill) {
        reply(true, await generateSkill(payload || {}));
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.listSkills) {
        reply(true, await listSkills());
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.saveSkill) {
        reply(true, await saveSkill(payload?.skill || {}));
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.deleteSkill) {
        reply(true, await deleteSkill(String(payload?.slug || "")));
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.importSkills) {
        reply(true, await importSkillsFromPaths(Array.isArray(payload?.paths) ? payload.paths : []));
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.listWorkfolders) {
        reply(true, await listWorkFolders());
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.addWorkfolder) {
        reply(true, await addWorkFolder(payload?.path));
        await syncDeviceMeta(true);
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.removeWorkfolder) {
        reply(true, await removeWorkFolder(payload?.path));
        await syncDeviceMeta(true);
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.getTaskState) {
        reply(true, await getTaskState(String(payload?.taskId || ""), String(payload?.runId || "")));
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.removeTask) {
        const taskId = String(payload?.taskId || "");
        const runId = String(payload?.runId || "");
        await removeTask(taskId, runId, { removeWorktree: Boolean(payload?.removeWorktree) });
        knownTasks.delete(taskId);
        sendToRelay({
          type: RELAY_DAEMON_MESSAGE_TYPES.taskRemoved,
          protocolVersion: PROTOCOL_VERSION,
          taskId,
          runId,
        });
        reply(true, { ok: true });
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.saveTaskUploads) {
        reply(true, await saveTaskUploadFiles(String(payload?.runId || ""), payload?.files || []));
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.getTaskOutputPath) {
        const path = await getTaskOutputPath(
          String(payload?.taskId || ""),
          String(payload?.runId || ""),
          String(payload?.phaseId || ""),
          String(payload?.outputKey || "")
        );
        reply(true, { path });
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.openPath) {
        reply(true, await openPath(payload?.path, payload?.editor || "code"));
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.removeTaskWorktree) {
        reply(true, await removeTaskWorktreeOnly(String(payload?.taskId || ""), String(payload?.runId || "")));
        return;
      }

      if (action === DAEMON_QUERY_ACTIONS.openTaskOutput) {
        reply(true, await openTaskOutput(
          String(payload?.taskId || ""),
          String(payload?.runId || ""),
          String(payload?.phaseId || ""),
          String(payload?.outputKey || ""),
          String(payload?.editor || "code")
        ));
        return;
      }

      reply(false, {}, "unsupported query");
    } catch (error) {
      reply(false, {}, error.message);
    }
  };
}
