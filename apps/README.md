# Monorepo Apps

## Directory layout

- `apps/desktop/electron`: Electron main/preload/runtime
- `apps/desktop/renderer`: React renderer
- `apps/desktop/local-server-controllers`: existing local workflow HTTP/WebSocket controllers
- `apps/backend`: cloud relay backend
- `apps/desktop/connector`: local connector between local workflow server and cloud backend
- `apps/mobile`: Flutter mobile app
- `packages/core-models`: shared workflow/config/state models
- `packages/core-lib`: shared runtime helpers

## Local development

### Existing desktop app

```bash
pnpm dev:desktop
```

### Local workflow server

```bash
pnpm dev:server
```

### Cloud backend

```bash
pnpm dev:backend
```

### Desktop connector

```bash
pnpm dev:connector
```

### Flutter mobile app

```bash
pnpm dev:mobile
```

Set backend URL in the app to:

```txt
http://<your-host>:8787
```
