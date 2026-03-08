# Backend Codemap
_Updated: 2026-03-05_

## Server (`server/src/`)

Express.js API server. Entry: `index.ts` → `createApp()` in `app.ts`.

### Middleware (applied in order)
```
express.json()
httpLogger              - pino HTTP logging
privateHostnameGuard    - blocks non-allowlisted hostnames (authenticated+private mode)
actorMiddleware         - resolves actor: board user (session) or agent (JWT)
boardMutationGuard      - prevents write operations in read-only board mode
```

### Route Groups (`/api/*`)
| Route | File | Key operations |
|-------|------|----------------|
| `/health` | routes/health.ts | deployment info, bootstrap status |
| `/companies` | routes/companies.ts | CRUD, portability export/import |
| agents (nested) | routes/agents.ts | CRUD, API keys, runtime state, config revisions, wakeup |
| `/assets` | routes/assets.ts | file upload/download via storage service |
| projects | routes/projects.ts | CRUD, workspaces |
| issues | routes/issues.ts | CRUD, assignments, comments, attachments, approvals |
| goals | routes/goals.ts | CRUD, tree structure |
| approvals | routes/approvals.ts | CRUD, comments |
| secrets | routes/secrets.ts | CRUD per company |
| costs | routes/costs.ts | cost events, burn rate |
| activity | routes/activity.ts | activity log |
| dashboard | routes/dashboard.ts | aggregated stats |
| sidebar-badges | routes/sidebar-badges.ts | unread counts |
| llms | routes/llms.ts | LLM proxy/config |
| access | routes/access.ts | invites, join requests, memberships |
| `/api/auth/*` | auth/better-auth.ts | better-auth handler (authenticated mode only) |

### Services (`server/src/services/`)
Business logic layer, 1:1 with routes. Key services:
- `agents.ts` - agent CRUD, heartbeat tracking
- `issues.ts` - issue lifecycle, execution locking
- `approvals.ts` / `issue-approvals.ts` - approval flow
- `live-events.ts` - event emission to WebSocket subscribers
- `costs.ts` - cost event recording, budget checks
- `company-portability.ts` - full company export/import
- `secrets.ts` - secret CRUD via provider registry

### Adapter System (`server/src/adapters/`)
- `registry.ts` - maps adapter type strings to implementations
- `types.ts` - shared adapter interfaces
- `http/` - HTTP webhook adapter
- `process/` - local subprocess adapter
- `codex-models.ts` - Codex model definitions

### Storage (`server/src/storage/`)
- `provider-registry.ts` - selects provider from config
- `local-disk-provider.ts` - filesystem storage
- `s3-provider.ts` - AWS S3 / compatible storage
- `service.ts` - storage service wrapper

### Secrets (`server/src/secrets/`)
- `provider-registry.ts` - selects provider from config
- `local-encrypted-provider.ts` - AES-encrypted local file
- `external-stub-providers.ts` - external secret manager stubs

### Auth (`server/src/auth/`)
- `better-auth.ts` - better-auth instance (email/password, sessions)
- `agent-auth-jwt.ts` - JWT issuance/verification for agent-to-server auth

### Realtime
- `realtime/live-events-ws.ts` - WebSocket server, pushes live update events to connected boards

## CLI (`cli/src/`)

Setup and management tool. Entry: `index.ts`.

### Commands
| Command | Purpose |
|---------|---------|
| `onboard` | Interactive first-run setup wizard |
| `configure` | Edit config values |
| `doctor` | Health check diagnostics |
| `run` | Start the server |
| `env` | Show resolved environment |
| `heartbeat-run` | Manual agent heartbeat trigger |
| `auth bootstrap-ceo` | Generate first admin invite |
| `allowed-hostname` | Manage allowed hostnames |
| `client/*` | Client-side sub-commands (agent management) |

### Config (`cli/src/config/`)
- Config stored at `~/.paperclip/instances/default/paperclip.yaml`
- Schema: `packages/shared/src/config-schema.ts` (Zod)
- Sections: llm, database, logging, server, auth, storage, secrets

### Checks (`cli/src/checks/`)
Health check modules: config, database, deployment-auth, agent-jwt-secret, llm, log, path, port, secrets, storage.
