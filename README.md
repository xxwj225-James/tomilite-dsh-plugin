# tomilite-dsh-plugin

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that gives your DSH agent access to your local [TomiLite](https://github.com/xxwj225-James/tomilite) — tasks, notes, and project stats.

The agent creates a task in TomiLite and it shows up in your Tasks panel instantly. Your DSH agent becomes the hands, TomiLite stays the workspace.

## 🚀 Get TomiLite

This plugin needs the **TomiLite desktop app** running on the same machine.

**Windows one-liner** (skips install if TomiLite is already running, otherwise downloads + installs + starts it):

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/xxwj225-James/tomilite-dsh-plugin/main/scripts/install-tomilite.ps1 | iex"
```

Or download the installer manually: [TomiLite Releases](https://github.com/xxwj225-James/tomilite/releases/latest)

If TomiLite is not running, the tools fail with an actionable message (with the download link) — the agent will relay it to you.

## Prerequisites

- **DeepSeek Harness** installed (`npx @deepseek-ai/dsh web`, or built from source)
- **TomiLite desktop app running** — the plugin talks to its local API at `http://localhost:3192` (localhost calls are token-exempt; no API key needed)
- Node.js 22.19+ (matches DSH requirements)

## Install

```bash
# npm (recommended once published)
dsh plugin --profile web add tomilite-dsh-plugin

# git (installs from this repository)
dsh plugin --profile web add github:xxwj225-James/tomilite-dsh-plugin

# local checkout
dsh plugin --profile web add ./tomilite-dsh-plugin
```

Restart the DSH web UI (or `dsh` CLI) after installing.

## Configuration

Defaults work out of the box for the local TomiLite app. Override in your profile's `cordis.patch.yml`:

```yaml
- id: tomilite
  name: tomilite-dsh-plugin
  config:
    baseUrl: http://localhost:3192   # default
    apiToken: ''                     # only for remote instances (Settings → API Keys)
    projectId: proj-default          # default single-user project
```

`apiToken` can also come from the `TOMILITE_API_TOKEN` environment variable. For remote instances prefer HTTPS — the token travels in plain HTTP otherwise.

## Tools

| Tool | Description |
|------|-------------|
| `tomilite_list_tasks` | List tasks, optional `status` filter (todo / in_progress / done). Returns compact rows (description truncated to 300 chars) |
| `tomilite_create_task` | Create a task (title, description, type, priority, story points) |
| `tomilite_update_task` | Update status / priority / description |
| `tomilite_list_notes` | List knowledge-base notes, optional category filter. Returns compact rows (content preview truncated to 500 chars) |
| `tomilite_create_note` | Create a Markdown note |
| `tomilite_get_stats` | Board statistics — counts per status / priority / type — handy before writing daily reports |

If TomiLite is not running, tools fail with an actionable message (the agent will tell you to start TomiLite). Every HTTP call carries a 15-second timeout so a hung TomiLite never stalls an agent turn.

## How it works

The plugin is a host-side Cordis plugin that speaks the same tRPC wire format as TomiLite's own web frontend (`apps/web/src/lib/api.ts`):

- Reads: `GET /api/<router>.<procedure>?input=<urlencoded JSON>`
- Mutations: `POST /api/<router>.<procedure>` with a JSON body
- Responses: tRPC envelope `{ result: { data: ... } }`
- Auth: `x-tl-token` header, only needed for non-localhost instances

The tools registered by this plugin (`ctx.tools.register` + `defineTool` from `@deepseek-ai/dsh-tools`) become regular model-visible tools — schemas are enforced before `execute` runs, results are rendered as compact JSON blocks.

## Language

Tool descriptions and result messages are in **English**. DSH's locale service is browser-side only, so host-side tool plugins (including every official DSH tool package) ship static English copy; translations can be added once DSH exposes a host-side locale.

## Development

```bash
npm install
npm run build                 # tsc → lib/
npm test                      # smoke + real-Cordis load tests (no network)
npm run test:integration      # round-trips against a RUNNING TomiLite on :3192
```

- `test/smoke.mjs` — registration + model-surface checks with a mock context (no network)
- `test/cordis-load.mjs` — boots a real `@deepseek-ai/cordis` context, loads the plugin through `ctx.plugin()`, verifies inject resolution, tool registration, and Config-schema rejection of invalid config (no network)
- `test/integration.mjs` — live round-trips against a running TomiLite; creates and deletes its own rows, no user data touched

`lib/` is committed so git installs work without a build step; CI rebuilds it to guarantee freshness (`npm run build` before committing).

## Notes

- DeepSeek Harness is in developer preview (rc releases) and may break plugin APIs between releases; this plugin is pinned to `dsh-tools@0.1.0-rc.7`.
- GitHub topic: `dsh-plugin` (for plugin ecosystem discovery)

## License

[MIT](LICENSE) © 2026 Tomatovector
