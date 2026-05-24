# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dev Workflow is an Electron desktop app for running AI-assisted development workflows locally. It orchestrates multi-step workflows using Claude Code and Codex agents, manages task state, and provides a UI for monitoring and controlling workflow execution.

**Key Architecture**: The desktop app is the source of truth. It manages workflow definitions, task runs, AI agent execution via node-pty terminals, and optional Git worktrees locally. A relay backend and Flutter mobile app exist for remote monitoring but are secondary.

## Development Commands

### Desktop Development (Primary)
```bash
pnpm dev:desktop        # Start full desktop stack (renderer + server + connector + Electron)
pnpm dev:renderer       # Start Vite dev server only (port 5900)
pnpm dev:server         # Start local workflow server only (port 3900)
pnpm build:desktop      # Build React renderer for production
pnpm start:desktop      # Run Electron with existing build
```

### Backend/Mobile Development (Secondary)
```bash
pnpm dev:backend        # Start relay backend (port 8900)
pnpm dev:mobile-stack   # Start server + backend + connector
cd apps/mobile && flutter run  # Run Flutter app
```

### Testing
- No automated test suite configured (`pnpm test` intentionally fails)
- Manually verify changes with `pnpm dev:desktop` or `pnpm build:desktop && pnpm start:desktop`
- For Flutter: `cd apps/mobile && flutter analyze`

## Critical Architecture Patterns

### 1. Workflow Runtime Architecture

**LangGraph-based execution**: Workflows are defined as DSL JSON files and compiled into LangGraph state machines (`packages/core-lib/langgraph-runtime/builder.ts`).

**Step types**:
- `agent`: Executes AI agent (Claude Code or Codex) via node-pty terminal
- `checkpoint`: Human approval gate with approve/reject routing
- `condition`: Programmatic branching based on AI evaluation
- `end`: Terminal node

**State management**: Task state is persisted to `~/Library/Application Support/dev-workflow/tasks/` with:
- `workflow-state.json`: Overall task state and phase statuses
- `interactions/{phase}.jsonl`: Terminal interaction logs (JSONL format)
- `outputs/{phase}/`: Phase output artifacts
- `checkpoints/`: LangGraph checkpoint data

### 2. Agent Execution via SDK Adapters

**Location**: `packages/core-lib/langgraph-runtime/sdk-agent-adapter.ts`

**Key mechanism**: Spawns Claude Code or Codex CLI via `node-pty` with:
- Real-time terminal streaming via WebSocket
- Hook-based completion detection (Stop hook creates marker file)
- Session resumption support via `--resume <sessionId>`

**Resume behavior**:
- When `sessionId` exists: adds `--resume` flag, skips prompt/images
- When no `sessionId`: starts new session with full prompt

**Hook configuration**: Creates `.claude/settings.json` or `.codex/settings.json` in project directory with Stop hook that touches a completion marker file. System polls for this file every 500ms to detect task completion.

### 3. Terminal Bridge & WebSocket Communication

**Terminal bridge** (`apps/desktop/electron/terminal-bridge.ts`): Exposes WebSocket server for real-time terminal I/O between agent processes and UI.

**Flow**:
1. Agent spawned via node-pty
2. Terminal bridge creates WebSocket endpoint
3. UI connects and streams terminal output
4. Interactions saved to `{phase}.jsonl` for replay on app restart

**Session restoration**: On app restart, loads interactions from JSONL files and replays them into xterm terminal (`apps/desktop/renderer/src/components/TaskTerminalPanel.tsx`).

### 4. Store Architecture (Zustand)

**Key stores** (`apps/desktop/renderer/src/stores/`):
- `workflowStore.ts`: Task state, phase interactions, streaming status (NOT persisted)
- `configStore.ts`: App settings, workflow config, work folders
- `workflowEditorStore.ts`: Workflow editor state (persisted to sessionStorage)

**State keys**: Uses `{taskId}:{runId}` pattern for multi-run support. All state is indexed by this composite key.

**Data loading**: `loadTask()` fetches state from Electron API, populates `phaseInteractionsByRun` for terminal display.

### 5. Git Worktree Integration

**Purpose**: Isolates workflow changes in separate Git worktrees to avoid polluting main branch.

**Flow** (`packages/core-lib/worktree.ts`):
1. Generate branch name via AI (uses worktree naming skill)
2. Create worktree: `git worktree add <path> -b <branch>`
3. Run workflow in worktree directory
4. Cleanup: `git worktree remove <path>`

**Worktree path**: `<parent-dir>/<generated-branch-name>/`

## Important File Locations

### Workflow Execution
- `apps/desktop/electron/workflow-runtime.ts`: Main workflow orchestration, LangGraph graph execution
- `packages/core-lib/langgraph-runtime/builder.ts`: Compiles DSL to LangGraph
- `packages/core-lib/langgraph-runtime/sdk-agent-adapter.ts`: Claude Code/Codex CLI spawning and hook management
- `packages/core-lib/langgraph-runtime/app-adapter.ts`: Agent adapter for app-managed workflows

### State Management
- `packages/core-models/state.ts`: Task state persistence (read/write workflow-state.json, interactions)
- `packages/core-models/workflow.ts`: Workflow DSL validation and utilities
- `packages/core-models/config.ts`: App configuration (config.json)

### UI Components
- `apps/desktop/renderer/src/pages/TaskPage.tsx`: Main task execution view
- `apps/desktop/renderer/src/components/TaskTerminalPanel.tsx`: xterm.js terminal with interaction replay
- `apps/desktop/renderer/src/WorkflowEditor.tsx`: Visual workflow editor (large file, ~90KB)

### IPC Bridge
- `apps/desktop/electron/main.ts`: Electron main process, IPC handlers
- `apps/desktop/electron/api.ts`: Desktop API functions (getTaskState, removeTask, etc.)

## Common Patterns

### Adding a New Workflow Step Type
1. Add type to DSL schema in `packages/core-models/workflow.ts`
2. Create node builder in `packages/core-lib/langgraph-runtime/builder.ts` (e.g., `createAgentNode`)
3. Add routing logic if needed (e.g., `createCheckpointRouter`)
4. Update UI to display new step type in `apps/desktop/renderer/src/pages/TaskPage.tsx`

### Modifying Agent Execution
- Edit `packages/core-lib/langgraph-runtime/sdk-agent-adapter.ts`
- Key functions: `streamInteractiveCli()` for spawning, `onData()` for output processing
- Hook configuration in `projectHooksConfig` object (must use nested `hooks` array structure)

### Adding UI State
- For persistent state: Add to `configStore.ts` or persist via Electron API
- For session state: Add to `workflowStore.ts` (resets on app restart)
- For editor state: Add to `workflowEditorStore.ts` (persisted to sessionStorage)

## Data Storage Locations

**macOS**: `~/Library/Application Support/dev-workflow/`
- `config.json`: App settings, AI backend config
- `workflows/`: Workflow DSL JSON files
- `tasks/`: Task run data (state, interactions, outputs)
- `skills/`: Managed skills

**Windows**: `%APPDATA%/dev-workflow/`
**Linux**: `~/.config/dev-workflow/`

## Known Constraints

- Interactions are stored as JSONL, not full terminal state (no scrollback beyond logged interactions)
- Hook completion detection polls every 500ms (not event-driven)
- Session resumption depends on Claude Code/Codex maintaining session state
- Mobile app is read-only for task monitoring, not full workflow editing
- No automated tests; rely on manual verification
