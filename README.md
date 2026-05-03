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

- `apps/desktop/electron`: Electron main process, preload bridge, and workflow runtime
- `apps/desktop/renderer`: React renderer for the desktop app
- `apps/desktop/local-server-controllers`: local Express and WebSocket controllers for workflow execution
- `apps/backend`: cloud relay backend
- `apps/desktop/connector`: local bridge process that syncs local workflow state to the backend and forwards remote commands
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

## Local Development Flow

### 1. Develop the Electron App

Use this flow when you are working only on the desktop app experience.

Start the Electron renderer and shell:

```bash
pnpm dev:desktop
```

Build the renderer:

```bash
pnpm build:desktop
```

Run Electron with the existing build:

```bash
pnpm start:desktop
```

Use this mode for:

- desktop UI changes
- Electron main/preload changes
- local workflow runtime changes
- workflow editor and task UI changes

### 2. Develop the Backend and Mobile App

Use this flow when you are working on the cloud relay, connector, or Flutter app.

Start the backend/mobile development stack:

```bash
pnpm dev:mobile-stack
```

Then start Flutter in a separate terminal:

```bash
pnpm dev:mobile
```

### Local mobile development

`pnpm dev:mobile-stack` starts these three processes:

- `pnpm dev:server`
  Runs the local workflow server on your computer. This is the process that knows about local tasks, local workflow state, local files, and the workflow runtime.

- `pnpm dev:backend`
  Runs the cloud relay backend. The mobile app talks to this service over HTTP and WebSocket.

- `pnpm dev:connector`
  Runs the local connector. It bridges the local workflow server and the cloud backend by syncing task state upward and forwarding mobile commands back down.

So the chain is:

```txt
mobile app -> backend -> connector -> local workflow server
```

This is why mobile development needs all three:

- without `server`, there is no local workflow state to read or control
- without `backend`, the mobile app has nothing to connect to
- without `connector`, the backend and your local machine are not linked

Before running the app, make sure the stack is already up:

```bash
pnpm dev:mobile-stack
```

The terminal output is prefixed by process name:

- `server`
- `backend`
- `connector`

So if one process fails, the error will appear with its prefix in the same terminal.

Then start Flutter from `apps/mobile`:

```bash
cd apps/mobile
flutter run
```

Useful commands:

```bash
cd apps/mobile
flutter devices
flutter run -d ios
flutter run -d android
flutter analyze
```

### Prepare a local mobile device target

If `flutter run` only shows something like:

```txt
Mac Designed for iPad
```

that means there is no active iOS simulator, Android emulator, or physical phone connected yet.

#### iOS Simulator

Start the simulator:

```bash
open -a Simulator
```

Then check devices again:

```bash
cd apps/mobile
flutter devices
flutter run -d ios
```

#### Android Emulator

List available emulators:

```bash
flutter emulators
```

Launch one:

```bash
flutter emulators --launch <emulator_id>
```

Then run:

```bash
cd apps/mobile
flutter devices
flutter run -d android
```

#### Real device

You can also run on a real iPhone or Android phone after enabling the usual platform developer options and trusting the machine.

### Backend URL for mobile

Set the backend URL inside the mobile app to one of the following:

#### iOS Simulator

```txt
http://127.0.0.1:8787
```

#### Android Emulator

```txt
http://10.0.2.2:8787
```

#### Real iPhone or Android device on the same LAN

```txt
http://<your-host-ip>:8787
```

Example:

```txt
http://192.168.1.23:8787
```

### Mobile development notes

- The phone or simulator only talks to the cloud backend.
- The desktop connector must stay connected, or the mobile app will not see any active device.
- If you use a real device, make sure the phone and your computer are on the same local network when testing locally.
- If the app connects but shows no device, check `http://127.0.0.1:8787/api/devices` on your computer.

Use this mode for:

- cloud backend API and WebSocket changes
- desktop connector changes
- mobile UI and command flow changes
- remote task sync debugging

### Recommended local checks

For backend/mobile development, verify:

- local workflow server: `http://127.0.0.1:3000`
- cloud backend health: `http://127.0.0.1:8787/health`
- backend device list: `http://127.0.0.1:8787/api/devices`

If the connector is working, the device list should show `desktop-local` as `online`.

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
pnpm dev:desktop
```

Build the renderer:

```bash
pnpm build:desktop
```

Start Electron with the existing build:

```bash
pnpm start:desktop
```

## Run the Local Workflow Server

This exposes the local workflow API and WebSocket used by the connector.

```bash
pnpm dev:server
```

Default port:

```txt
http://127.0.0.1:3000
```

## Run the Cloud Backend

```bash
pnpm dev:backend
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
pnpm dev:connector
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

If the mobile app shows `Device metadata is incomplete` after tapping `Add`, the connector did not report any available work folder. Either add at least one work folder in the local workflow server, or set `DEFAULT_WORK_FOLDER` before starting `pnpm dev:connector`.

## Run the Mobile App

```bash
pnpm dev:mobile
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
- `pnpm build:desktop`
- `cd apps/mobile && flutter pub get`
- `cd apps/mobile && flutter analyze`
- `node --check` for backend, connector, local server, and Electron runtime files
- Local smoke test for backend + connector command relay

## Notes

- Workflow execution still depends on your local machine being online.
- The backend currently keeps device/task state in memory.
- The local workflow server and connector are separate processes in this first version.
