const WORKFLOW_DEBUG_EVENT_TYPES = {
  STATE: "state",
  TEXT_DELTA: "text_delta",
  TOOL_USE: "tool_use",
  BACKEND_SELECTED: "backend_selected",
  SESSION_ATTACHED: "session_attached",
  USER_MESSAGE: "user_message",
  PHASE_ARTIFACT: "phase_artifact",
  PHASE_CONTENT: "phase_content",
  PHASE_INTERACTION: "phase_interaction",
  PHASE_DONE: "phase_done",
  PHASE_COMPLETED: "phase_completed",
  WORKFLOW_STARTING: "workflow_starting",
  WORKTREE_NAMING_STARTED: "worktree_naming_started",
  WORKTREE_NAMING_COMPLETED: "worktree_naming_completed",
  WORKTREE_PREPARING: "worktree_preparing",
  WORKTREE_READY: "worktree_ready",
} as const;

export const DEBUG_EVENT_TYPES = {
  ...WORKFLOW_DEBUG_EVENT_TYPES,
  ERROR: "error",
  PHASE_FAILED: "phase_failed",
  CLIENT_CONNECT: "client_connect",
  CLIENT_DETACH: "client_detach",
  PHASE_APPROVE_REQUESTED: "phase_approve_requested",
  PHASE_APPROVED: "phase_approved",
  PHASE_REJECT_REQUESTED: "phase_reject_requested",
  PHASE_REJECTED: "phase_rejected",
  PHASE_MESSAGE_REQUESTED: "phase_message_requested",
  PHASE_PAUSE_REQUESTED: "phase_pause_requested",
  PHASE_PAUSED: "phase_paused",
  PHASE_RESUME_REQUESTED: "phase_resume_requested",
  PHASE_RESUMED: "phase_resumed",
  PHASE_RETRY_REQUESTED: "phase_retry_requested",
  PHASE_RETRIED: "phase_retried",
  TASK_DELETE_REQUESTED: "task_delete_requested",
  TASK_DELETED: "task_deleted",
  TASK_DELETE_FAILED: "task_delete_failed",
  WORKTREE_REMOVE_REQUESTED: "worktree_remove_requested",
  WORKTREE_REMOVED: "worktree_removed",
  WORKTREE_REMOVE_FAILED: "worktree_remove_failed",
  WORKTREE_OPEN_REQUESTED: "worktree_open_requested",
  WORKTREE_OPENED: "worktree_opened",
  WORKTREE_OPEN_FAILED: "worktree_open_failed",
  DOCUMENT_OPEN_REQUESTED: "document_open_requested",
  DOCUMENT_OPENED: "document_opened",
  DOCUMENT_OPEN_FAILED: "document_open_failed",
} as const;

export const DEBUG_EVENT_TRIGGERS = {
  TOOLBAR: "toolbar",
  CHECKPOINT: "checkpoint",
  CHAT: "chat",
} as const;

export const DEBUG_EVENT_REQUESTED_BY = {
  USER: "user",
} as const;

export function buildClientDebugPayload(type, payload = {}) {
  return {
    type,
    requestedBy: DEBUG_EVENT_REQUESTED_BY.USER,
    ...payload,
  };
}
