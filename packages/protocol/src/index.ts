import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const RELAY_WS_PATHS = {
  daemon: "/ws/daemon",
  ui: "/ws/ui",
} as const;

export const RELAY_API_ROUTES = {
  health: "/health",
  devices: "/api/devices",
  tasks: "/api/tasks",
  workflow: "/api/workflow",
  aiApiProfiles: "/api/settings/ai-api-profiles",
  aiApiProfile: "/api/settings/ai-api-profiles/:id",
  workflows: "/api/workflows",
  workflowByFilename: "/api/workflows/:filename",
  workflowVisibility: "/api/workflows/:filename/visibility",
  workflowActivate: "/api/workflows/:filename/activate",
  generateSkill: "/api/generate-skill",
  skills: "/api/skills",
  skillBySlug: "/api/skills/:slug",
  skillsImport: "/api/skills/import",
  workfolders: "/api/workfolders",
  taskState: "/api/tasks/:taskId/state",
  taskById: "/api/tasks/:taskId",
  taskUpload: "/api/tasks/:runId/upload",
  openPath: "/api/open-path",
  taskWorktree: "/api/tasks/:taskId/worktree",
  taskOpenOutput: "/api/tasks/:taskId/open-output",
  taskCommands: "/api/tasks/:taskId/commands",
  deviceTask: "/api/tasks/:deviceId/:taskId",
  deviceTaskCommands: "/api/tasks/:deviceId/:taskId/commands",
} as const;

export function formatRelayApiRoute(
  route: string,
  params: Record<string, string | number | boolean | null | undefined> = {}
) {
  const formatted = route.replace(/:([A-Za-z0-9_]+)/g, (_match, key) => {
    const value = params[key];
    if (value === undefined || value === null) {
      throw new Error(`missing route param: ${key}`);
    }
    return encodeURIComponent(String(value));
  });
  if (formatted.includes(":")) {
    throw new Error(`unresolved route param in ${formatted}`);
  }
  return formatted;
}

export const RELAY_DAEMON_MESSAGE_TYPES = {
  daemonHello: "daemon.hello",
  daemonAccepted: "daemon.accepted",
  queryRequest: "query.request",
  queryResponse: "query.response",
  commandRequest: "command.request",
  commandResult: "command.result",
  taskSnapshot: "task.snapshot",
  taskEvent: "task.event",
  taskRemoved: "task.removed",
} as const;

export const RELAY_UI_EVENT_TYPES = {
  bootstrap: "bootstrap",
  deviceStatus: "device.status",
  taskSnapshot: "task.snapshot",
  taskEvent: "task.event",
  tasksRemoveDevice: "tasks.remove_device",
  tasksRemoveTask: "tasks.remove_task",
  commandStatus: "command.status",
  commandError: "command.error",
} as const;

export const COMMAND_TYPE = {
  approve: "approve",
  reject: "reject",
  message: "message",
  syncTask: "sync_task",
  startWorkflow: "start_workflow",
  deleteTask: "delete_task",
  resumePhase: "resume_phase",
  retryPhase: "retry_phase",
  pausePhase: "pause_phase",
} as const;

export const COMMAND_TYPES = [
  COMMAND_TYPE.approve,
  COMMAND_TYPE.reject,
  COMMAND_TYPE.message,
  COMMAND_TYPE.syncTask,
  COMMAND_TYPE.startWorkflow,
  COMMAND_TYPE.deleteTask,
  COMMAND_TYPE.resumePhase,
  COMMAND_TYPE.retryPhase,
  COMMAND_TYPE.pausePhase,
] as const;

export const COMMAND_STATUSES = ["pending", "ok", "error"] as const;
export const DEVICE_STATUSES = ["online", "offline"] as const;

export const DAEMON_QUERY_ACTIONS = {
  getWorkflowConfig: "get_workflow_config",
  listAiApiProfiles: "list_ai_api_profiles",
  saveAiApiProfile: "save_ai_api_profile",
  deleteAiApiProfile: "delete_ai_api_profile",
  listWorkflows: "list_workflows",
  getWorkflow: "get_workflow",
  setWorkflowVisible: "set_workflow_visible",
  createWorkflow: "create_workflow",
  updateWorkflow: "update_workflow",
  removeWorkflow: "remove_workflow",
  activateWorkflow: "activate_workflow",
  generateSkill: "generate_skill",
  listSkills: "list_skills",
  saveSkill: "save_skill",
  deleteSkill: "delete_skill",
  importSkills: "import_skills",
  listWorkfolders: "list_workfolders",
  addWorkfolder: "add_workfolder",
  removeWorkfolder: "remove_workfolder",
  listTasks: "list_tasks",
  getTask: "get_task",
  removeTask: "remove_task",
  getTaskState: "get_task_state",
  saveTaskUploads: "save_task_uploads",
  getTaskOutputPath: "get_task_output_path",
  openPath: "open_path",
  removeTaskWorktree: "remove_task_worktree",
  openTaskOutput: "open_task_output",
} as const;

export const DAEMON_QUERY_ACTION_VALUES = Object.values(DAEMON_QUERY_ACTIONS);

const UnknownRecordSchema = z.record(z.string(), z.unknown());
const OptionalUnknownRecordSchema = UnknownRecordSchema.optional();
const OptionalStringSchema = z.string().optional();
const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION).optional();

export const CommandTypeSchema = z.enum(COMMAND_TYPES);
export const CommandStatusValueSchema = z.enum(COMMAND_STATUSES);
export const DeviceStatusValueSchema = z.enum(DEVICE_STATUSES);

export const DeviceSchema = z.object({
  deviceId: z.string().min(1),
  name: OptionalStringSchema,
  status: DeviceStatusValueSchema.optional(),
  lastSeenAt: OptionalStringSchema,
  meta: OptionalUnknownRecordSchema,
}).passthrough();

export const WorkflowDefinitionSchema = UnknownRecordSchema;

export const WorkflowSummarySchema = z.object({
  filename: OptionalStringSchema,
  name: OptionalStringSchema,
  visible: z.boolean().optional(),
  phaseCount: z.number().optional(),
  phaseOrder: z.array(z.string()).optional(),
  workflowConfig: OptionalUnknownRecordSchema,
}).passthrough();

export const PhaseStateSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  updated: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
}).passthrough();

export const ArtifactSchema = z.object({
  phase: OptionalStringSchema,
  outputKey: OptionalStringSchema,
  path: OptionalStringSchema,
  content: z.unknown().optional(),
}).passthrough();

export const InteractionSchema = z.object({
  id: OptionalStringSchema,
  at: OptionalStringSchema,
  phase: OptionalStringSchema,
  role: OptionalStringSchema,
  type: OptionalStringSchema,
  text: OptionalStringSchema,
}).passthrough();

export const TaskRunSchema = z.object({
  taskId: z.string().min(1),
  runId: OptionalStringSchema,
  deviceId: OptionalStringSchema,
  workFolder: OptionalStringSchema,
  state: OptionalUnknownRecordSchema,
}).passthrough();

export const TaskSnapshotSchema = z.object({
  key: OptionalStringSchema,
  deviceId: z.string().min(1),
  taskId: z.string().min(1),
  runId: OptionalStringSchema,
  workFolder: OptionalStringSchema,
  state: z.unknown().nullable().optional(),
  messages: OptionalUnknownRecordSchema,
  outputArtifacts: OptionalUnknownRecordSchema,
  interactions: OptionalUnknownRecordSchema,
  updatedAt: OptionalStringSchema,
}).passthrough();

export const TaskReferenceSchema = z.object({
  deviceId: OptionalStringSchema,
  taskId: z.string().min(1),
  key: OptionalStringSchema,
}).passthrough();

export const DaemonHelloSchema = z.object({
  type: z.literal(RELAY_DAEMON_MESSAGE_TYPES.daemonHello),
  protocolVersion: ProtocolVersionSchema,
  deviceId: z.string().min(1),
  name: OptionalStringSchema,
  capabilities: z.array(z.string()).optional(),
  runtimes: z.array(z.string()).optional(),
  meta: OptionalUnknownRecordSchema,
}).passthrough();

export const DaemonAcceptedSchema = z.object({
  type: z.literal(RELAY_DAEMON_MESSAGE_TYPES.daemonAccepted),
  protocolVersion: ProtocolVersionSchema,
  device: DeviceSchema.nullable().optional(),
}).passthrough();

export const QueryRequestSchema = z.object({
  type: z.literal(RELAY_DAEMON_MESSAGE_TYPES.queryRequest),
  protocolVersion: ProtocolVersionSchema,
  requestId: z.string().min(1),
  action: z.string().min(1),
  payload: OptionalUnknownRecordSchema,
}).passthrough();

export const QueryResponseSchema = z.object({
  type: z.literal(RELAY_DAEMON_MESSAGE_TYPES.queryResponse),
  protocolVersion: ProtocolVersionSchema,
  requestId: z.string().min(1),
  ok: z.boolean(),
  data: OptionalUnknownRecordSchema,
  error: OptionalStringSchema,
}).passthrough();

export const CommandRequestSchema = z.object({
  type: z.literal(RELAY_DAEMON_MESSAGE_TYPES.commandRequest),
  protocolVersion: ProtocolVersionSchema,
  commandId: z.string().min(1),
  taskId: z.string().min(1),
  command: CommandTypeSchema,
  payload: OptionalUnknownRecordSchema,
}).passthrough();

export const CommandResultSchema = z.object({
  type: z.literal(RELAY_DAEMON_MESSAGE_TYPES.commandResult),
  protocolVersion: ProtocolVersionSchema,
  commandId: z.string().min(1),
  status: CommandStatusValueSchema,
  error: OptionalStringSchema,
}).passthrough();

export const CommandStatusSchema = z.object({
  id: z.string().min(1),
  deviceId: OptionalStringSchema,
  taskId: OptionalStringSchema,
  type: CommandTypeSchema,
  payload: OptionalUnknownRecordSchema,
  status: CommandStatusValueSchema,
  createdAt: OptionalStringSchema,
  completedAt: z.string().nullable().optional(),
  error: OptionalStringSchema,
}).passthrough();

export const TaskSnapshotMessageSchema = z.object({
  type: z.literal(RELAY_DAEMON_MESSAGE_TYPES.taskSnapshot),
  protocolVersion: ProtocolVersionSchema,
  taskId: OptionalStringSchema,
  task: TaskSnapshotSchema,
}).passthrough();

export const TaskEventMessageSchema = z.object({
  type: z.literal(RELAY_DAEMON_MESSAGE_TYPES.taskEvent),
  protocolVersion: ProtocolVersionSchema,
  taskId: OptionalStringSchema,
  event: z.unknown().optional(),
  task: TaskSnapshotSchema.optional(),
}).passthrough();

export const TaskRemovedMessageSchema = z.object({
  type: z.literal(RELAY_DAEMON_MESSAGE_TYPES.taskRemoved),
  protocolVersion: ProtocolVersionSchema,
  taskId: z.string().min(1),
  runId: OptionalStringSchema,
}).passthrough();

export const UiBootstrapEventSchema = z.object({
  type: z.literal(RELAY_UI_EVENT_TYPES.bootstrap),
  devices: z.array(DeviceSchema),
  tasks: z.array(TaskSnapshotSchema).optional(),
}).passthrough();

export const UiDeviceStatusEventSchema = z.object({
  type: z.literal(RELAY_UI_EVENT_TYPES.deviceStatus),
  device: DeviceSchema,
}).passthrough();

export const UiTaskSnapshotEventSchema = z.object({
  type: z.literal(RELAY_UI_EVENT_TYPES.taskSnapshot),
  task: TaskSnapshotSchema,
}).passthrough();

export const UiTaskEventSchema = z.object({
  type: z.literal(RELAY_UI_EVENT_TYPES.taskEvent),
  taskKey: OptionalStringSchema,
  deviceId: OptionalStringSchema,
  taskId: OptionalStringSchema,
  event: z.unknown().optional(),
  task: TaskSnapshotSchema,
}).passthrough();

export const UiTasksRemoveDeviceEventSchema = z.object({
  type: z.literal(RELAY_UI_EVENT_TYPES.tasksRemoveDevice),
  deviceId: z.string().min(1),
}).passthrough();

export const UiTasksRemoveTaskEventSchema = z.object({
  type: z.literal(RELAY_UI_EVENT_TYPES.tasksRemoveTask),
  taskKey: OptionalStringSchema,
  deviceId: OptionalStringSchema,
  taskId: OptionalStringSchema,
  runId: OptionalStringSchema,
}).passthrough();

export const UiCommandStatusEventSchema = z.object({
  type: z.literal(RELAY_UI_EVENT_TYPES.commandStatus),
  command: CommandStatusSchema,
}).passthrough();

export const UiCommandErrorEventSchema = z.object({
  type: z.literal(RELAY_UI_EVENT_TYPES.commandError),
  error: z.string(),
}).passthrough();

export function makeTaskKey(deviceId: string, taskId: string) {
  return `${deviceId}:${taskId}`;
}

export function parseTaskKey(key: string) {
  const index = String(key || "").indexOf(":");
  if (index <= 0 || index === key.length - 1) {
    throw new Error("invalid task key");
  }
  return {
    deviceId: key.slice(0, index),
    taskId: key.slice(index + 1),
  };
}

export function normalizeTaskReference(input: unknown) {
  const ref = TaskReferenceSchema.parse(input);
  if (ref.deviceId && ref.taskId) return ref;
  if (ref.key) {
    return {
      ...ref,
      ...parseTaskKey(ref.key),
    };
  }
  return ref;
}

export type CommandType = z.infer<typeof CommandTypeSchema>;
export type CommandStatusValue = z.infer<typeof CommandStatusValueSchema>;
export type Device = z.infer<typeof DeviceSchema>;
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;
export type CommandStatus = z.infer<typeof CommandStatusSchema>;
export type DaemonHello = z.infer<typeof DaemonHelloSchema>;
export type DaemonAccepted = z.infer<typeof DaemonAcceptedSchema>;
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
