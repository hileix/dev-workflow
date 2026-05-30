# Monorepo Apps

## Directory Layout

- `apps/web`: React web app.
- `apps/daemon`: local backend daemon for workflow/task data, storage, runtime, and outbound relay connection.
- `apps/server`: stateless relay server.
- `packages/protocol`: shared daemon/server/web protocol contracts.

## Local Development

### Full Stack

```bash
pnpm dev:all
```

### Web App

```bash
pnpm dev:web
```

### Relay Server

```bash
pnpm dev:relay-server
```

### Daemon

```bash
pnpm dev:daemon
```

The daemon does not expose the app API. It connects outbound to the relay server.
