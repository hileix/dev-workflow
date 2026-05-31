# Dev Workflow

Dev Workflow is a local web app for running AI-assisted development workflows on your own machine.

The daemon is the source of truth. It stores workflow definitions, selected project folders, task runs, AI agent execution state, uploaded context, generated outputs, skills, and optional Git worktrees under `~/.dev-workflow` by default. The web app talks to the stateless relay server, and the relay server forwards requests to the local daemon.

## What The App Does

The app turns repeatable development work into guided, inspectable workflow runs. You define a workflow made of agent steps, condition steps, and checkpoint steps, then start a task from the web UI against a local project folder. The daemon runs each phase and keeps state, logs, outputs, and decisions organized.

Typical use cases:

- Create workflows for planning, implementation, review, or documentation.
- Start a task against a real local project folder.
- Provide structured context fields and uploaded screenshots/images.
- Let Claude or Codex execute workflow phases from the local runtime.
- Review each phase in a graph-based run page.
- Approve, reject, or send follow-up messages at checkpoints.
- Save generated outputs and phase artifacts under the task run.
- Use managed skills to guide specific workflow steps.
- Optionally create a Git worktree so code changes stay isolated.

## Architecture

```txt
Web App
  |
  | HTTP / WebSocket
  v
Relay Server
  |
  | WebSocket
  v
Daemon
```

## Repository Layout

- `apps/web`: React web app.
- `apps/daemon`: local backend daemon that owns workflow/task data, JSON storage, workflow runtime, and outbound relay connection.
- `apps/server`: stateless in-memory relay server.
- `packages/protocol`: shared REST/WebSocket message contracts.
- `docs`: design notes and implementation plans.
- `references`: external source snapshots used for architecture research.

## Requirements

- Node.js from `.nvmrc`
- `pnpm`

Install dependencies:

```bash
pnpm install
```

## Development

Start the full local stack:

```bash
pnpm dev:all
```

Start only the relay server and daemon:

```bash
pnpm dev:stack
```

Start individual processes:

```bash
pnpm dev:web
pnpm dev:daemon
pnpm dev:relay-server
```

Useful checks:

```txt
http://127.0.0.1:5173
http://127.0.0.1:8787/health
http://127.0.0.1:8787/api/devices
```

## Runtime Data

Daemon data is stored under `~/.dev-workflow` by default.

Important subpaths:

- `config.json`: active workflow and AI backend settings.
- `workflows/`: app-managed workflow DSL JSON files.
- `skills/`: app-managed skills.
- `tasks/`: task run state, uploads, phase logs, and output artifacts.

## Commands

```bash
pnpm dev:web          # web app only
pnpm dev:stack        # relay server + daemon
pnpm dev:all          # web app + relay server + daemon
pnpm dev:daemon       # daemon only; connects outbound to relay server
pnpm dev:relay-server # relay server only
pnpm build:web        # build React web app
pnpm build:daemon     # check daemon package
pnpm build:server     # check relay server package
pnpm test             # web tests
pnpm test:protocol    # protocol tests
```

## Current Limitations

- The relay server stores coordination state in memory.
- There is no production authentication layer yet.
- Workflow execution depends on the daemon staying online.
