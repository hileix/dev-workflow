# Repository Guidelines

## Project Structure & Module Organization

This repo is now a monorepo centered around the desktop workflow app, a cloud relay backend, a desktop connector, and a Flutter mobile client.

- `apps/desktop/electron/`: Electron entrypoints, preload bridge, and workflow runtime.
- `apps/desktop/renderer/src/`: React UI. `pages/` holds route screens, `components/` holds shared UI, `stores/` contains Zustand state, and `lib/` contains renderer helpers.
- `apps/desktop/local-server-controllers/`: local Express/WebSocket controllers used by the desktop workflow server.
- `apps/backend/`: cloud relay backend for remote mobile access.
- `apps/desktop/connector/`: local bridge process that syncs local workflow state to the cloud backend and forwards remote commands.
- `apps/mobile/`: Flutter app for iOS and Android.
- `packages/core-models/`, `packages/core-lib/`: shared Node-side state, config, workflow, and runtime helpers.
- `workflows/`: JSON workflow definitions shipped with the app.
- `docs/` and `references/`: internal notes and reference material.

## Build, Test, and Development Commands

Use `pnpm` at the repo root.

- `pnpm install`: install workspace dependencies.
- `pnpm dev:renderer`: start the Vite desktop renderer for UI work.
- `pnpm build:desktop`: build the renderer into `apps/desktop/renderer/dist`.
- `pnpm dev:desktop`: build the renderer, then launch Electron.
- `pnpm start:desktop`: open Electron using the existing renderer build.
- `pnpm dev:server`: run the local Express server from `apps/desktop/server.mjs`.
- `pnpm dev:backend`: run the cloud relay backend.
- `pnpm dev:connector`: run the local desktop connector.

Mobile app commands:

- `cd apps/mobile && flutter pub get`
- `cd apps/mobile && flutter analyze`
- `cd apps/mobile && flutter run`

There is no real automated test suite yet. The current `pnpm test` script intentionally fails.

## Coding Style & Naming Conventions

- Use ES modules (`.mjs`, `.js`, `.jsx`) for Node/React code and keep changes surgical.
- Match the existing style: 2-space indentation, double quotes, and semicolons.
- Use `PascalCase` for React components (`HomePage.jsx`), `camelCase` for functions/variables, and lowercase descriptive filenames for Node modules (`workflowController.mjs`).
- For Flutter, follow Dart defaults and keep widgets and state management straightforward.
- Keep new abstractions minimal; prefer extending the current file structure over introducing new layers.

## Testing Guidelines

- For desktop UI changes, verify `pnpm build:desktop` succeeds and smoke-test the Electron flow with `pnpm dev:desktop` or `pnpm start:desktop`.
- For backend or connector changes, manually verify the affected API/WebSocket path with `pnpm dev:backend`, `pnpm dev:connector`, and `pnpm dev:server`.
- For Flutter changes, run `flutter analyze` under `apps/mobile`.
- If you add tests later, place them next to the feature or under a dedicated `tests/` folder and name them `*.test.*`.

## Commit & Pull Request Guidelines

- Follow the existing history: short, imperative commit subjects such as `update title and link text`.
- Keep each commit focused on one change.
- PRs should include: what changed, how it was verified, and screenshots for renderer UI updates.
- Link the related issue or workflow task when one exists.

## Configuration Notes

- Use Node `25` from `.nvmrc`.
- Treat `apps/desktop/renderer/dist` as build output; edit source files under `apps/desktop/renderer/src` instead.
- The cloud backend defaults to port `8787`.
- The local workflow server defaults to port `3000`.

请用中文回复。
