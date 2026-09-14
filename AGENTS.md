## PixQL

PixQL is a local web database client for PostgreSQL, MySQL, and SQLite. It is a pnpm workspace.

### Project Layout

* `apps/web`: React web app served by a local Node server (database access, storage, and state stay on the server).
* `apps/landing`: Astro landing page.
* Root scripts delegate to workspace app scripts.

### Commands

```bash
pnpm install
pnpm dev                  # Local web app (API server + Vite dev server)
pnpm start                # Serve the built app with the API server
pnpm landing:dev          # Astro site
pnpm typecheck
pnpm test
pnpm build
```

Use pnpm for installs, scripts, and tests. Prefer root scripts unless a task is clearly scoped to one app.

### Development Notes

* Keep all database access in the local server (`apps/web/src/server`, shared services under `src/main`).
* The renderer only talks to the server through the typed fetch bridge (`src/renderer/lib/pixql-client.ts`); never call services from UI code.
* State (connections, history, saved queries, settings) is persisted as JSON in the data directory (`PIXQL_DATA_DIR`, default `~/.pixql`).
* Keep changes scoped to the relevant app and run the narrowest useful check before handing off.
