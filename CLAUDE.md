# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- Install dependencies: `pnpm install`
- Start full local stack: `pnpm dev:all`
- Start web app only: `pnpm dev:web`
- Start relay server and daemon: `pnpm dev:stack`
- Start relay server only: `pnpm dev:relay-server`
- Start daemon only: `pnpm dev:daemon`
- Build web app: `pnpm build:web`
- Build daemon: `pnpm build:daemon`
- Build relay server: `pnpm build:server`

## Testing Commands

- Run web test suite: `pnpm test`
- Run web tests directly: `pnpm --dir apps/web test`
- Run a single test file: `pnpm --dir apps/web vitest run src/path/to/file.test.ts`
- Run tests matching a name: `pnpm --dir apps/web vitest run -t "test name"`
- Run protocol tests: `pnpm test:protocol`

## Current Command Gaps

- No root `lint` script is currently defined in `package.json`.

## Architecture Overview

This is a `pnpm` monorepo for a local AI workflow runner.

Primary runtime path:

1. The React web app in `apps/web` talks to the relay server over HTTP/WebSocket.
2. The relay server in `apps/server` stays stateless and forwards UI requests to a connected daemon.
3. The daemon in `apps/daemon` owns workflow/task data, JSON storage, local APIs, and workflow runtime execution.
4. Shared protocol contracts live in `packages/protocol`.

## Key Module Responsibilities

- `apps/web`: React UI for workflows, tasks, settings, and skills.
- `apps/daemon`: local source of truth for config, workflows, skills, workfolders, tasks, artifacts, runtime, and worktrees.
- `apps/server`: in-memory relay for daemon presence, task snapshots/events, and UI commands.
- `packages/protocol`: shared REST/WebSocket message contracts.

## Data and Storage Notes

- Daemon data is stored under `~/.dev-workflow` by default.
- The relay server stores only short-lived coordination state in memory.
- Workflow execution depends on the daemon staying online.

## Practical Development Notes

- For web behavior changes, run `pnpm build:web` and smoke-test with `pnpm dev:all`.
- For daemon/server behavior changes, verify the affected API or WebSocket path with the relevant `pnpm dev:*` command.
- Treat `apps/web/dist` as build output; edit web source under `apps/web/src`.
