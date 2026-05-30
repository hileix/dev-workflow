# Server

Stateless relay server for the daemon-server-web architecture.

The server keeps only short-lived coordination state in memory:

- connected daemon sockets
- connected web UI sockets
- pending daemon query requests
- pending command status

Persistent workflow, task, artifact, settings, and runtime data stays daemon-owned.

Run:

```sh
pnpm --filter @dev-workflow/server start
```

The server listens on `RELAY_SERVER_PORT`, `BACKEND_PORT`, `PORT`, or `8787`.
