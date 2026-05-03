# Monorepo Apps

## Directory layout

- `apps/desktop-electron`: Electron main/preload/runtime
- `apps/desktop-renderer`: React renderer
- `apps/local-server-controllers`: existing local workflow HTTP/WebSocket controllers
- `apps/backend`: cloud relay backend
- `apps/desktop-connector`: local connector between local workflow server and cloud backend
- `apps/mobile`: Flutter mobile app
- `packages/core-models`: shared workflow/config/state models
- `packages/core-lib`: shared runtime helpers

## Local development

### Existing desktop app

```bash
pnpm dev
```

### Local workflow server

```bash
pnpm server
```

### Cloud backend

```bash
pnpm backend:dev
```

### Desktop connector

```bash
pnpm connector:dev
```

### Flutter mobile app

```bash
cd apps/mobile
flutter run
```

Set backend URL in the app to:

```txt
http://<your-host>:8787
```
