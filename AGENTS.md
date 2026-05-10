# Repository Guidelines

## Project Structure & Module Organization

This `pnpm` monorepo contains a desktop-first workflow app, relay backend, connector, and Flutter client.

- `apps/desktop/electron/`: Electron main process and preload.
- `apps/desktop/renderer/src/`: React UI: `pages/`, `components/`, `stores/`, and `lib/`.
- `apps/desktop/local-server-controllers/`: Express/WebSocket controllers.
- `apps/desktop/connector/`: bridge for local state sync and remote commands.
- `apps/backend/`: cloud relay backend, default port `8787`.
- `apps/mobile/`: Flutter app, including `lib/` and `test/`.
- `packages/core-models/`, `packages/core-lib/`: shared models and runtime helpers.
- `docs/`, `references/`, `examples/`, and demo folders hold notes and experiments.

## Build, Test, and Development Commands

Use Node `25` from `.nvmrc`; run `pnpm` at the repo root.

- `pnpm install`: install workspace dependencies.
- `pnpm dev:renderer`: start Vite on `127.0.0.1:5173`.
- `pnpm dev:desktop`: run renderer, local server, connector, and Electron.
- `pnpm dev:desktop-stack`: run server, backend, and connector.
- `pnpm dev:backend`: start the relay backend.
- `pnpm dev:server`: start the local workflow server on port `3000`.
- `pnpm dev:connector`: start the desktop connector.
- `pnpm build:desktop`: build `apps/desktop/renderer/dist`.
- `pnpm start:desktop`: open Electron with the existing renderer build.
- `cd apps/mobile && flutter pub get && flutter analyze`: install and check Flutter code.

`pnpm test` fails intentionally because no Node test suite is configured.

## Coding Style & Naming Conventions

Keep changes surgical and match nearby code. Use ES modules for Node and React. JavaScript and JSX use 2-space indentation, double quotes, and semicolons. Name React components with `PascalCase`, such as `HomePage.jsx`; use `camelCase` for variables and functions; keep Node filenames lowercase, such as `workflowController.mjs`. For Flutter, follow standard Dart formatting.

## Testing Guidelines

For desktop UI changes, run `pnpm build:desktop`; smoke-test with `pnpm dev:desktop` or `pnpm start:desktop` when behavior changes. For backend, connector, or server changes, manually verify the affected API or WebSocket path with the relevant `pnpm dev:*` command. For mobile changes, run `flutter analyze` under `apps/mobile`. If tests are added, place them near the feature or under `tests/` as `*.test.*`.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects. History includes plain subjects like `update title and link text` and Conventional Commit style such as `feat: enhance task deletion process`. Keep commits focused. PRs should describe changes, verification, and screenshots for renderer UI updates. Link related issues or workflow tasks.

## Configuration Notes

Treat `apps/desktop/renderer/dist` as build output; edit source under `apps/desktop/renderer/src`. Keep mobile access and relay behavior desktop-first unless the task expands backend or mobile ownership.
