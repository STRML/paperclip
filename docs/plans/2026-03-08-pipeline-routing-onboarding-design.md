# Pipeline Routing Onboarding — Design

_Date: 2026-03-08_

## Goal

Make TaskRouter a first-class, always-available feature: auto-created during onboarding, protected from deletion while active, manageable from Company Settings, and fully documented.

---

## Schema Changes

### 1. `agents` table

```sql
ALTER TABLE agents ADD COLUMN is_system boolean NOT NULL DEFAULT false;
```

Marks an agent as system-protected. When `is_system = true`, the server rejects `DELETE /agents/:id` and `POST /agents/:id/terminate` with 409 — unconditionally. The guard does NOT check `pipelineRoutingEnabled`; `is_system` alone is the signal. The disable endpoint is responsible for setting `is_system = false` on TaskRouter when pipeline routing is turned off.

### 2. `companies` table

```sql
ALTER TABLE companies ADD COLUMN pipeline_routing_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN pipeline_routing_onboarding_skipped boolean NOT NULL DEFAULT false;
```

`pipeline_routing_enabled`: tracks whether pipeline routing is on. Controls UI badge/pinning and the Pipeline Routing section state in Company Settings.

`pipeline_routing_onboarding_skipped`: set to `true` when the user clicks "Skip for now" on the onboarding wizard Step 5. Prevents the step from reappearing for any admin in that company (shared state, not localStorage).

### 3. `AGENT_ROLES` constant (`packages/shared/src/constants.ts`)

Add `"task_router"` to the `AGENT_ROLES` array and `AGENT_ROLE_LABELS`. Gives TaskRouter a distinct label and enables role-based pinning/badging. The `task_router` role string is already present in `agents/seed.sh` as free-text; adding it to the typed constant makes it official.

**Note for implementer:** After adding `task_router` to the constant, verify that `createAgentSchema` / `updateAgentSchema` in `packages/shared` derive the role enum from `AGENT_ROLES` (not a hardcoded subset). Grep for `z.enum` near `role` in the shared package.

---

## Agent Instructions Storage

Specialist instructions (AGENTS.md content) are stored in `adapterConfig.instructions` as a text string. Adapters prefer this over `instructionsFilePath` when present. `instructionsFilePath` continues to work as a fallback for manually-configured agents (legacy compatibility).

The seed/enable process reads each `agents/<name>/AGENTS.md` file from the repo at server startup and writes the content into `adapterConfig.instructions` when creating the agent. After creation, instructions live in the DB and are editable via the agent config UI (a textarea field in the claude_local adapter config form).

**Critical:** Every adapter's execution path must be updated to check `adapterConfig.instructions` first. This change is required in `packages/adapters/claude-local/src/index.ts`, `packages/adapters/codex-local/src/index.ts`, `packages/adapters/opencode-local/src/index.ts`, and `packages/adapters/cursor/src/index.ts` (and any others). The `adapter-utils` `renderTemplate` helper or the instruction-loading step at the start of each adapter's `execute` function is the right place. Without this, all seeded agents silently run with no instructions.

**Docker consideration:** The server must be able to read `agents/<name>/AGENTS.md` at seed time. In Docker deployments, ensure the `agents/` directory is mounted or copied into the container. After seed, instructions live in the DB and the filesystem is no longer needed.

---

## New API Endpoints

```
POST /api/companies/:id/pipeline-routing/enable
POST /api/companies/:id/pipeline-routing/disable
```

**Authorization:** Board access required for both (same as agent creation governance). In the route handler, use the existing `assertBoard(req)` or equivalent pattern.

**Enable:** Creates TaskRouter + 7 specialist agents (if they don't already exist), sets `pipelineRoutingEnabled = true`. All 8 agent creations are wrapped in a single DB transaction — if any creation fails, the whole operation rolls back and `pipelineRoutingEnabled` is not set.

Idempotency: TaskRouter is matched by `role = 'task_router'` (unique per company), not by name. Specialists are matched by name scoped to the company (`WHERE name = ? AND company_id = ?`). Returns the created/existing agent IDs.

**Disable:** Sets `pipelineRoutingEnabled = false`, sets `is_system = false` on TaskRouter, and sets `adapterConfig.heartbeat.enabled = false` on TaskRouter (to stop it from continuing to wake up). Does NOT delete agents. Agents remain active until manually removed. TaskRouter becomes deletable.

### TaskRouter agent config (seeded values)

| Field | Value |
|---|---|
| `role` | `task_router` |
| `isSystem` | `true` |
| `adapterConfig.heartbeat.enabled` | `true` |
| `adapterConfig.heartbeat.intervalSec` | `60` |
| `adapterConfig.heartbeat.wakeOnDemand` | `true` |
| `adapterConfig.heartbeat.maxConcurrentRuns` | `5` |
| `adapterConfig.maxTurnsPerRun` | `200` |
| `adapterConfig.dangerouslySkipPermissions` | `true` |
| `permissions.tasks:assign` | `true` (via `principal_permission_grants`) |

TaskRouter discovers specialist agents at runtime via `GET /api/companies/$PAPERCLIP_COMPANY_ID/agents` and can create new ones via `POST /api/companies/:id/agents`.

### Specialist agent config (seeded values, all 7)

| Field | Value |
|---|---|
| `role` | Closest valid role (`researcher`, `pm`, `engineer`, `qa`, `devops`) |
| `isSystem` | `false` |
| `adapterConfig.heartbeat.enabled` | `false` |
| `adapterConfig.heartbeat.wakeOnDemand` | `true` |
| `adapterConfig.maxTurnsPerRun` | `200` |
| `adapterConfig.dangerouslySkipPermissions` | `true` |

---

## Onboarding Wizard — Step 5

After the existing Step 4 (launch), a new optional **Step 5: "Enable Pipeline Routing"** appears.

**Contents:**
- Headline: "Automate your issue pipeline"
- One-line explanation: "TaskRouter assigns issues to specialist agents — brainstorm, plan, implement, review, and merge — automatically."
- Pipeline stage diagram: `triage → brainstorm? → plan? → code → review → PR → merge`
- Two CTAs: **"Enable Pipeline Routing"** (primary) and **"Skip for now"** (secondary)

**On enable:** calls `POST /api/companies/:id/pipeline-routing/enable`, then navigates to the agents list. TaskRouter appears pinned at top with `[system]` badge.

**On skip:** sets `company.pipelineRoutingOnboardingSkipped = true` via an API call, then closes wizard normally. Step 5 is never shown again for any admin in that company. The feature remains accessible via Company Settings at any time.

---

## Company Settings — Pipeline Routing Section

New section in Company Settings:

- **Toggle**: "Pipeline Routing" on/off
  - On → `POST /api/companies/:id/pipeline-routing/enable`
  - Off → `POST /api/companies/:id/pipeline-routing/disable`
- **Agent roster**: lists the 8 pipeline agents with status badges, links to their config pages (static fetch, no real-time requirement)
- **"Add specialist"** button: opens create-agent dialog pre-filled with `adapterConfig.heartbeat.wakeOnDemand = true` and an `instructions` textarea

---

## Agents List UI Changes

- TaskRouter sorts first when `isSystem = true` (server returns sorted by `is_system DESC, name ASC`)
- `[system]` badge displayed next to TaskRouter's name
- Delete and terminate buttons **hidden** (not disabled) for system agents (`isSystem = true`)
- All other pipeline agents are normal — fully editable, deletable, no badge

**Note:** The sort change affects all API consumers of the agents list. If this is unacceptable for existing consumers, make it UI-only (client-side sort).

The agents list page is `ui/src/pages/Agents.tsx` (not `AgentList.tsx`).

---

## agents/README.md

A short doc covering:
1. What pipeline routing does (stage diagram)
2. How to enable: via the onboarding wizard or Company Settings → Pipeline Routing
3. How to customize specialist instructions: edit in the agent config UI
4. How to add/remove specialists: standard agent management — TaskRouter discovers them at runtime
5. What TaskRouter can do: assign issues, create new agents, run up to 5 concurrent sessions
6. The seed script (`agents/seed.sh`) for programmatic setup outside the UI

---

## Files Changed

| File | Change |
|---|---|
| `packages/db/src/schema/agents.ts` | Add `isSystem` column |
| `packages/db/src/schema/companies.ts` | Add `pipelineRoutingEnabled` and `pipelineRoutingOnboardingSkipped` columns |
| `packages/db/src/migrations/XXXX.sql` | Generated migration — do NOT hardcode number; use `ls packages/db/src/migrations/ | tail -1` to find actual filename. **Note:** resolve any duplicate `0026_*` files before generating. |
| `packages/shared/src/constants.ts` | Add `task_router` role |
| `server/src/routes/agents.ts` | Delete/terminate guard: fetch agent first, check `agent.isSystem`, return 409 if true — guard is unconditional, does not check `pipelineRoutingEnabled` |
| `server/src/routes/companies.ts` | Add `/:id/pipeline-routing/enable` and `/:id/pipeline-routing/disable` (paths relative to mount point, no `/api/companies/` prefix in route definition) |
| `server/src/services/pipeline-routing.ts` | New service: transactional agent seed, toggle flag, disable sets `isSystem=false` + `heartbeat.enabled=false` |
| `packages/adapters/claude-local/src/index.ts` | Read `adapterConfig.instructions` first, fall back to `instructionsFilePath` |
| `packages/adapters/codex-local/src/index.ts` | Same instruction-loading change |
| `packages/adapters/opencode-local/src/index.ts` | Same instruction-loading change |
| `packages/adapters/cursor/src/index.ts` | Same instruction-loading change (if applicable) |
| `ui/src/components/OnboardingWizard.tsx` | Add Step 5 |
| `ui/src/pages/CompanySettings.tsx` | Add Pipeline Routing section |
| `ui/src/pages/Agents.tsx` | Sort/badge system agents |
| `ui/src/adapters/claude-local/config-fields.tsx` | Add `instructions` textarea |
| `agents/README.md` | New doc |
| `agents/task-router/AGENTS.md` | Update: note agent-creation capability, runtime discovery |

---

## What This Is Not

- No automatic issue assignment on create (TaskRouter wakes on demand when assigned)
- No changes to how specialists execute (they remain standard claude_local agents)
- No removal of `instructionsFilePath` support (legacy compat preserved)

---

## Implementation Prerequisites

This plan depends on the **agent permissions API/UI** plan (`2026-03-08-agent-permissions-api.md`) being merged first. TaskRouter needs `tasks:assign` grantable from the enable endpoint without direct DB access.
