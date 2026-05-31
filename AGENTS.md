# Repository Guidelines

## Project Structure & Module Organization

This `pnpm` monorepo contains a web workflow app, local daemon, and stateless relay server.

- `apps/web/src/`: React UI: `pages/`, `components/`, `stores/`, and `lib/`.
- `apps/daemon/`: local daemon for workflow/task data and outbound relay connection.
- `apps/server/`: stateless relay server, default port `8787`.
- `packages/protocol/`: shared daemon/server/web protocol contracts.
- `docs/`, `references/`, `examples/`, and demo folders hold notes and experiments.

## Build, Test, and Development Commands

Use Node `25` from `.nvmrc`; run `pnpm` at the repo root.

- `pnpm install`: install workspace dependencies.
- `pnpm dev:web`: start Vite on `127.0.0.1:5173`.
- `pnpm dev:all`: run web app, relay server, and daemon.
- `pnpm dev:stack`: run relay server and daemon.
- `pnpm dev:relay-server`: start the relay server.
- `pnpm dev:server`: alias for the stateless relay server.
- `pnpm dev:daemon`: start the local daemon; it connects outbound to the relay server.
- `pnpm build:web`: build `apps/web/dist`.
- `pnpm build:daemon`: check the daemon package.
- `pnpm build:server`: check the relay server package.

`pnpm test` fails intentionally because no Node test suite is configured.

## Coding Style & Naming Conventions

Keep changes surgical and match nearby code. Use ES modules for Node and React. JavaScript and JSX use 2-space indentation, double quotes, and semicolons. Name React components with `PascalCase`, such as `HomePage.jsx`; use `camelCase` for variables and functions; keep Node filenames lowercase, such as `workflowController.mjs`.

## Testing Guidelines

For web UI changes, run `pnpm build:web`; smoke-test with `pnpm dev:all` when behavior changes. For daemon or server changes, manually verify the affected API or WebSocket path with the relevant `pnpm dev:*` command. If tests are added, place them near the feature or under `tests/` as `*.test.*`.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects. History includes plain subjects like `update title and link text` and Conventional Commit style such as `feat: enhance task deletion process`. Keep commits focused. PRs should describe changes, verification, and screenshots for renderer UI updates. Link related issues or workflow tasks.

## Configuration Notes

Treat `apps/web/dist` as build output; edit source under `apps/web/src`.
