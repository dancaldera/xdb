# PixQL

PixQL is a local web database client for PostgreSQL, MySQL, and SQLite built with Node, React, and Vite. The app runs in your browser and talks to a small local server (Node + tsx) that owns all database access and state.

This repository is a pnpm workspace:

- `apps/web` contains the web app (React renderer + local API server).
- `apps/landing` contains the static Astro landing page.
- The root package delegates workspace commands and keeps shared docs/tooling.

## Features

- Local saved connection profiles persisted as JSON in the PixQL data directory (`PIXQL_DATA_DIR`, default `~/.pixql`)
- PostgreSQL and MySQL connection pooling in the local API server, plus local SQLite database files (uploaded copies are stored in the data directory)
- Tables/views sidebar, including PostgreSQL materialized views and foreign tables
- Table data grid with pagination, CSV export, JSON row inserts, primary-key row edits, and row deletes
- SQL editor with execution results, duration, row counts, and statement history
- Table structure view with columns, primary keys, defaults, nullability, and indexes
- Built-in PostgreSQL backup and restore (plain SQL with COPY data) with progress and cancellation — no pg_dump or client tools required; backups land in `<data dir>/backups`
- Typed fetch bridge (`window.pixql`) between React and the local server, plus live progress events over SSE

## Commands

```bash
pnpm install
pnpm dev
pnpm start
pnpm landing:dev
pnpm landing:build
pnpm landing:preview
pnpm typecheck
pnpm test
pnpm build
```

`pnpm dev` starts the API server (port `4595` by default) together with the Vite dev server at `http://localhost:5173/`, which proxies `/api` to the server.

`pnpm build` compiles the web app into `apps/web/dist/web`. `pnpm start` then serves the production build at `http://127.0.0.1:4595`.

## Versioning

The app version lives in `apps/web/package.json` and follows SemVer. The build embeds it as `__APP_VERSION__`.

```bash
pnpm version:show
pnpm version:set 0.1.0
pnpm version:patch
pnpm version:minor
pnpm version:major
```

## Scope

This version supports PostgreSQL, MySQL, and SQLite for core browsing, querying, and row-level edits. It does not yet package installers, create/alter table schemas from forms, include SSH tunneling, or provide MySQL/SQLite backup and restore actions. Custom-format PostgreSQL archives (`pg_dump -Fc` `.dump`/`.backup` files) are not supported; PixQL creates and restores plain `.sql` backups.
