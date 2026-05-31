# Daemon

Local backend daemon for workflow/task storage and execution.

The daemon is the persistent source of truth for workflow data. It stores JSON files under `~/.dev-workflow` by default, runs workflow tasks, and owns the outbound relay connection.

Current responsibilities:

- connect outbound to the stateless relay server
- publish device/workflow/work folder metadata
- run workflow commands through the daemon runtime
- publish task snapshots and workflow events
- keep local daemon data in JSON-file storage

Current source layout:

- `src/services`: business orchestration
- `src/repositories`: JSON-file storage
- `src/runtime`: workflow runtime, worktree helpers, and agent adapters
- `src/relay`: outbound relay-server client, command/query handlers, and task snapshots

Run:

```sh
pnpm --filter @dev-workflow/daemon start
```

Optional diagnostics:

```sh
DAEMON_DIAGNOSTICS_PORT=3099 pnpm --filter @dev-workflow/daemon start
```

This exposes only `GET /health` on `127.0.0.1` by default. It is diagnostics-only, not the app API.
