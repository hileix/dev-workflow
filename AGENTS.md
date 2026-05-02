# Repository Guidelines

## Project Structure & Module Organization

This repo is an Electron app with a React renderer.

- `electron/`: Electron entrypoints, preload bridge, and workflow runtime.
- `renderer/src/`: UI code. `pages/` holds route screens, `components/` holds shared UI, `stores/` contains Zustand state, and `lib/` contains renderer helpers.
- `controllers/`, `models/`, `lib/`: Node-side API handlers, persistence, and workflow logic used by the desktop app and local server.
- `workflows/`: JSON workflow definitions shipped with the app.
- `docs/` and `references/`: internal notes and reference material.

## Build, Test, and Development Commands

Use `pnpm` at the repo root.

- `pnpm install`: install workspace dependencies.
- `pnpm dev:renderer`: start the Vite renderer for UI work.
- `pnpm build`: build the renderer into `renderer/dist`.
- `pnpm dev`: build the renderer, then launch Electron.
- `pnpm start`: open Electron using the existing renderer build.
- `pnpm server`: run the local Express server from `server.mjs`.

There is no real automated test suite yet. The current `pnpm test` script intentionally fails.

## Coding Style & Naming Conventions

- Use ES modules (`.mjs`, `.js`, `.jsx`) and keep changes surgical.
- Match the existing style: 2-space indentation, double quotes, and semicolons.
- Use `PascalCase` for React components (`HomePage.jsx`), `camelCase` for functions/variables, and lowercase descriptive filenames for Node modules (`workflowController.mjs`).
- Keep new abstractions minimal; prefer extending the current file structure over introducing new layers.

## Testing Guidelines

- For UI changes, verify `pnpm build` succeeds and smoke-test the Electron flow with `pnpm dev` or `pnpm start`.
- For server or workflow changes, manually verify the affected API or runtime path.
- If you add tests later, place them next to the feature or under a dedicated `tests/` folder and name them `*.test.*`.

## Commit & Pull Request Guidelines

- Follow the existing history: short, imperative commit subjects such as `update title and link text`.
- Keep each commit focused on one change.
- PRs should include: what changed, how it was verified, and screenshots for renderer UI updates.
- Link the related issue or workflow task when one exists.

## Configuration Notes

- Use Node `25` from `.nvmrc`.
- Treat `renderer/dist` as build output; edit source files under `renderer/src` instead.

请用中文回复。
