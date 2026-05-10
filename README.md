# Dev Workflow

Dev Workflow is an Electron desktop app for running AI-assisted development workflows on your own machine.

The desktop app is the source of truth. It manages workflow definitions, selected project folders, task runs, AI agent execution, uploaded context, generated outputs, skills, and optional Git worktrees locally. The mobile app is still early and currently only exists as an optional remote companion through the relay backend.

## What The Desktop App Does

The app is meant to turn repeatable development work into guided, inspectable workflow runs. Instead of manually prompting an AI agent step by step, you define a workflow made of agent steps, condition steps, and checkpoint steps. Then you start a task from the desktop UI, provide the task context, and let the app run each phase while keeping the state, logs, outputs, and decisions organized.

Typical use cases:

- Create a workflow for a recurring engineering process, such as planning, implementation, review, or documentation.
- Start a task against a real local project folder.
- Provide structured context fields and pasted or uploaded screenshots/images.
- Let Claude or Codex execute workflow phases from the local runtime.
- Review each phase in a graph-based run page that shows status, routes, checkpoints, outputs, logs, and debug details.
- Approve, reject, or send follow-up messages when a checkpoint needs human input.
- Save generated outputs and phase artifacts under the task run.
- Use managed skills to control how agents perform specific workflow steps.
- Optionally create a Git worktree for a workflow run so code changes stay isolated.

In short, the Electron app is a local control center for AI-assisted project work: it stores the workflow, starts the agents, tracks every phase, and keeps the run tied to your actual workspace.

## Architecture

```txt
Electron Desktop App
        |
        | local IPC
        v
Desktop Runtime + Local Workflow Server
        |
        | local HTTP / WebSocket
        v
Desktop Connector
        |
        | WebSocket
        v
Relay Backend
        |
        | HTTP / WebSocket
        v
Flutter Mobile App
```

Mobile access is disabled by default and is not the main product surface yet.

## Repository Layout

- `apps/desktop/electron`: Electron main process, preload bridge, API handlers, and workflow runtime.
- `apps/desktop/renderer`: React renderer for the desktop app.
- `apps/desktop/local-server-controllers`: local Express and WebSocket controllers.
- `apps/desktop/connector`: bridge between local desktop state and the relay backend.
- `apps/backend`: in-memory relay backend for mobile access.
- `apps/mobile`: Flutter mobile client.
- `packages/core-models`: workflow, config, state, skills, and workfolder storage.
- `packages/core-lib`: shared workflow runtime helpers, worktree helpers, and SDK adapters.
- `docs`: design notes and implementation plans.
- `references`: external source snapshots used for architecture research.

## Requirements

- Node.js from `.nvmrc`
- `pnpm`
- Flutter, only for mobile development

Install dependencies:

```bash
pnpm install
cd apps/mobile && flutter pub get
```

## Desktop Development

Start the desktop app, local workflow server, and connector:

```bash
pnpm dev:desktop
```

Build the renderer:

```bash
pnpm build:desktop
```

Run Electron with the existing renderer build:

```bash
pnpm start:desktop
```

Useful focused commands:

```bash
pnpm dev:renderer
pnpm dev:server
pnpm dev:connector
```

## Mobile Relay Development

Start the local workflow server, backend, and connector:

```bash
pnpm dev:mobile-stack
```

Start the Flutter app in another terminal:

```bash
pnpm dev:mobile
```

Set the backend URL in the mobile app:

- iOS simulator: `http://127.0.0.1:8787`
- Android emulator: `http://10.0.2.2:8787`
- Real device on the same LAN: `http://<your-host-ip>:8787`

Useful checks:

```txt
http://127.0.0.1:3000
http://127.0.0.1:8787/health
http://127.0.0.1:8787/api/devices
```

If the connector is online and mobile access is enabled, the device list should include `desktop-local`.

## Runtime Data

Desktop data is stored under the platform app-data directory:

- macOS: `~/Library/Application Support/dev-Workflow`
- Windows: `%APPDATA%/dev-Workflow`
- Linux: `$XDG_CONFIG_HOME/dev-Workflow` or `~/.config/dev-Workflow`

Important subpaths:

- `config.json`: active workflow, mobile access, and AI backend settings.
- `workflows/`: app-managed workflow DSL JSON files.
- `skills/`: app-managed skills.
- `tasks/`: task run state, uploads, phase logs, and output artifacts.

Legacy workflow JSON files from repo-root `workflows/` are migrated into the app-data workflow directory when possible.

## Commands

```bash
pnpm dev:desktop        # desktop UI + local server + connector
pnpm dev:desktop-stack  # local server + backend + connector
pnpm dev:mobile-stack   # local server + backend + connector
pnpm dev:all            # desktop stack plus backend
pnpm dev:backend        # relay backend only
pnpm build:desktop      # build React renderer
pnpm start:desktop      # start Electron from existing build
```

`pnpm test` is not configured and currently exits with an intentional error.

For mobile checks:

```bash
cd apps/mobile
flutter analyze
flutter run -d ios
flutter run -d android
```

## Current Limitations

- The backend stores relay state in memory.
- Mobile access has no production pairing or authentication layer yet.
- Workflow execution depends on the desktop machine staying online.
- Mobile supports remote task visibility and commands, not full workflow editing.
