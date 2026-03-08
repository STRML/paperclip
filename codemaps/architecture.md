# Paperclip Architecture
_Updated: 2026-03-05_

## Overview

Paperclip is a control plane for autonomous AI companies. A single instance can host multiple companies, each with AI agents (employees), org structure, goals, projects, issues, budgets, and governance.

## Monorepo Structure (pnpm workspaces)

```
paperclip/
  cli/          - CLI tool (onboard, configure, doctor, run)
  server/       - Express API server + WebSocket realtime
  ui/           - React SPA (Vite)
  packages/
    db/          - Drizzle ORM schema + migrations (PostgreSQL)
    shared/      - Shared types (Zod validators) used by server+ui+cli
    adapter-utils/ - Utilities for building agent adapters
    adapters/
      claude-local/ - Claude Code adapter
      codex-local/  - OpenAI Codex adapter
      openclaw/     - OpenClaw adapter
  skills/       - Claude Code skills for agent/adapter creation
  doc/          - Internal design docs and plans
  docs/         - Public documentation (Mintlify)
```

## Two-Layer Architecture

### 1. Control Plane (server + ui + db)
- Central nervous system managing agent registry, task assignment, budgets, goals, governance
- Agents are external; they "phone home" via API
- Board (human operator) interacts via the web UI

### 2. Execution Services (adapters)
- Adapters connect AI runtimes to the control plane
- Agent runs wherever it runs; adapter bridges the communication
- Adapter types: `process` (spawn local), `http` (webhook), `claude-local`, `codex-local`, `openclaw`

## Deployment Modes

| Mode | Auth | Exposure |
|------|------|----------|
| `local_trusted` | None (implicit local board) | Private only |
| `authenticated` | better-auth (email/password) | Private or Public |

## Cross-Cutting Concerns

- **Auth**: `actorMiddleware` resolves every request to an actor (board user or agent JWT)
- **Secrets**: pluggable provider (`local_encrypted` or external stubs)
- **Storage**: pluggable provider (`local_disk` or S3)
- **Realtime**: WebSocket (`live-events-ws.ts`) pushes live updates to UI
- **Cost tracking**: `cost_events` table + per-agent monthly budget enforcement
- **Approvals**: Board-gated approval flow for agent actions

## Key Entry Points

| Package | Entry |
|---------|-------|
| server | `server/src/index.ts` → `createApp()` in `app.ts` |
| ui | `ui/src/main.tsx` → `App.tsx` |
| cli | `cli/src/index.ts` |
| db | `packages/db/src/index.ts` |
| shared | `packages/shared/src/index.ts` |
