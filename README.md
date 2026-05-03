# Dev Workflow Monorepo

This repository contains the desktop workflow app, a cloud relay backend, a local desktop connector, and a Flutter mobile client.

The current architecture is designed so workflows still run on your own computer, while the mobile app can view task state and send workflow commands through a cloud backend.

## Architecture

```txt
Flutter Mobile App
        |
        | HTTPS / WebSocket
        v
Cloud Backend
        |
        | WebSocket
        v
Desktop Connector
        |
        | Local HTTP / WebSocket
        v
Local Workflow Server + Electron App
```

## Repository Layout

- `apps/desktop-electron`: Electron main process, preload bridge, and workflow runtime
- `apps/desktop-renderer`: React renderer for the desktop app
- `apps/local-server-controllers`: local Express and WebSocket controllers for workflow execution
- `apps/backend`: cloud relay backend
- `apps/desktop-connector`: local bridge process that syncs local workflow state to the backend and forwards remote commands
- `apps/mobile`: Flutter mobile app for iOS and Android
- `packages/core-models`: shared workflow, config, state, and storage modules
- `packages/core-lib`: shared runtime helpers
- `workflows`: workflow definitions
- `docs`: design notes and internal documentation

## Requirements

- Node.js from `.nvmrc`
- `pnpm`
- Flutter for `apps/mobile`

## Install

```bash
pnpm install
cd apps/mobile && flutter pub get
```

## One-Command Startup by Platform

### macOS

Full local stack:

```bash
pnpm install && (cd apps/mobile && flutter pub get) && pnpm dev:all
```

Backend relay stack only:

```bash
pnpm install && pnpm dev:desktop-stack
```

### Linux

Full local stack:

```bash
pnpm install && (cd apps/mobile && flutter pub get) && pnpm dev:all
```

Backend relay stack only:

```bash
pnpm install && pnpm dev:desktop-stack
```

Note:

- Electron and file-picker related behavior in this repo is primarily tuned for macOS.
- The mobile, backend, connector, and local server parts are still standard Node/Flutter processes.

### Windows PowerShell

Full local stack:

```powershell
pnpm install; Set-Location apps/mobile; flutter pub get; Set-Location ../..; pnpm dev:all
```

Backend relay stack only:

```powershell
pnpm install; pnpm dev:desktop-stack
```

Note:

- Some local desktop workflow behavior may need adjustment on Windows because the current local folder picker and workflow assumptions are macOS-oriented.

### iOS App

From the Flutter app directory:

```bash
cd apps/mobile && flutter run -d ios
```

Set the backend URL inside the app to:

```txt
http://<your-mac-ip>:8787
```

### Android App

From the Flutter app directory:

```bash
cd apps/mobile && flutter run -d android
```

Set the backend URL inside the app to:

```txt
http://<your-host-ip>:8787
```

For Android emulators, use the host machine IP instead of `127.0.0.1`.

## Run the Desktop App

Start the desktop renderer and Electron shell:

```bash
pnpm dev
```

Build the renderer:

```bash
pnpm build
```

Start Electron with the existing build:

```bash
pnpm start
```

## Run the Local Workflow Server

This exposes the local workflow API and WebSocket used by the connector.

```bash
pnpm server
```

Default port:

```txt
http://127.0.0.1:3000
```

## Run the Cloud Backend

```bash
pnpm backend:dev
```

Default port:

```txt
http://127.0.0.1:8787
```

Useful endpoints:

- `GET /health`
- `GET /api/devices`
- `GET /api/tasks`
- `GET /api/tasks/:deviceId/:ticketId`
- `POST /api/tasks/:deviceId/:ticketId/commands`

WebSocket endpoints:

- `/ws/desktop`
- `/ws/mobile`

## Run the Desktop Connector

The connector links the local workflow server to the cloud backend.

```bash
pnpm connector:dev
```

Default environment values:

```txt
CLOUD_BACKEND_WS_URL=ws://127.0.0.1:8787/ws/desktop
LOCAL_WORKFLOW_WS_URL=ws://127.0.0.1:3000/ws
LOCAL_WORKFLOW_API_BASE=http://127.0.0.1:3000/api
DEVICE_ID=desktop-local
DEVICE_NAME=Desktop Local
DEFAULT_WORK_FOLDER=
```

## Run the Mobile App

```bash
cd apps/mobile
flutter run
```

## Current MVP Scope

Implemented:

- Monorepo structure for desktop app, backend, connector, and mobile app
- Cloud backend for device/task state relay
- Desktop connector for local workflow synchronization
- Flutter mobile UI to connect to the backend, list tasks, inspect task state, send `approve`, send `message`, and refresh task data
- Existing Electron app still works in the monorepo layout

Not implemented yet:

- Authentication and device pairing
- Persistent cloud database
- Production-ready command authorization
- Mobile file upload flow
- Background push notifications
- Full mobile workflow editing UX

## Verification

Verified in this repo:

- `pnpm install`
- `pnpm build`
- `cd apps/mobile && flutter pub get`
- `cd apps/mobile && flutter analyze`
- `node --check` for backend, connector, local server, and Electron runtime files
- Local smoke test for backend + connector command relay

## Notes

- Workflow execution still depends on your local machine being online.
- The backend currently keeps device/task state in memory.
- The local workflow server and connector are separate processes in this first version.
