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

Marks an agent as system-protected. When `true` and `company.pipelineRoutingEnabled` is `true`, the server rejects `DELETE /agents/:id` and `POST /agents/:id/terminate` with 409.

### 2. `companies` table

```sql
ALTER TABLE companies ADD COLUMN pipeline_routing_enabled boolean NOT NULL DEFAULT false;
```

Tracks whether pipeline routing is on. Controls:
- System agent delete guard
- UI badge/pinning for TaskRouter
- Pipeline Routing section state in Company Settings

### 3. `AGENT_ROLES` constant (`packages/shared/src/constants.ts`)

Add `"task_router"` to the `AGENT_ROLES` array and `AGENT_ROLE_LABELS`. Gives TaskRouter a distinct label and enables role-based pinning/badging without coupling to `isSystem`.

---

## Agent Instructions Storage

Specialist instructions (AGENTS.md content) are stored in `adapterConfig.instructions` as a text string. Adapters prefer this over `instructionsFilePath` when present. `instructionsFilePath` continues to work as a fallback for manually-configured agents (legacy compatibility).

The seed/enable process reads each `agents/<name>/AGENTS.md` file from the repo at server startup and writes the content into `adapterConfig.instructions` when creating the agent. After creation, instructions live in the DB and are editable via the agent config UI (a textarea field in the claude_local adapter config form).

---

## New API Endpoint

```
POST /api/companies/:id/pipeline-routing/enable
POST /api/companies/:id/pipeline-routing/disable
```

**Enable:** Creates TaskRouter + 7 specialist agents (if they don't already exist), sets `pipelineRoutingEnabled = true`. Idempotent — skips agents that already exist by name. Returns the created/existing agent IDs.

**Disable:** Sets `pipelineRoutingEnabled = false`. Does NOT delete agents. TaskRouter becomes deletable. Agents remain active until manually removed.

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
| `permissions.tasks:assign` | `true` |

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

**On skip:** closes wizard normally. Step 5 is never shown again after being explicitly skipped (store in `localStorage` or a `company.onboardingState` field). Accessible via Company Settings at any time.

---

## Company Settings — Pipeline Routing Section

New section in Company Settings:

- **Toggle**: "Pipeline Routing" on/off
  - On → `POST /api/companies/:id/pipeline-routing/enable`
  - Off → `POST /api/companies/:id/pipeline-routing/disable`
- **Agent roster**: lists the 8 pipeline agents with status badges, links to their config pages
- **"Add specialist"** button: opens create-agent dialog pre-filled with `adapterConfig.heartbeat.wakeOnDemand = true` and an `instructions` textarea

---

## Agents List UI Changes

- TaskRouter sorts first when `isSystem = true` (server returns sorted by `isSystem DESC, name ASC`)
- `[system]` badge displayed next to TaskRouter's name
- Delete and terminate buttons **hidden** (not disabled) for system agents when `pipelineRoutingEnabled = true`
- All other pipeline agents are normal — fully editable, deletable, no badge

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
| `packages/db/src/schema/companies.ts` | Add `pipelineRoutingEnabled` column |
| `packages/db/src/migrations/XXXX.sql` | Generated migration |
| `packages/shared/src/constants.ts` | Add `task_router` role |
| `server/src/routes/agents.ts` | Guard DELETE/terminate for system agents |
| `server/src/routes/companies.ts` | Add pipeline-routing enable/disable endpoints |
| `server/src/services/pipeline-routing.ts` | New service: seed agents, toggle flag |
| `ui/src/components/OnboardingWizard.tsx` | Add Step 5 |
| `ui/src/pages/CompanySettings.tsx` | Add Pipeline Routing section |
| `ui/src/pages/AgentList.tsx` | Sort/badge system agents |
| `ui/src/adapters/claude-local/config-fields.tsx` | Add `instructions` textarea |
| `agents/README.md` | New doc |
| `agents/task-router/AGENTS.md` | Update: note agent-creation capability, runtime discovery |

---

## What This Is Not

- No automatic issue assignment on create (TaskRouter wakes on demand when assigned)
- No changes to how specialists execute (they remain standard claude_local agents)
- No removal of `instructionsFilePath` support (legacy compat preserved)
