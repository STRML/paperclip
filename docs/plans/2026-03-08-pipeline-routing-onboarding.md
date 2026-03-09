# Pipeline Routing Onboarding — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make TaskRouter a first-class, always-available feature — auto-created during onboarding, protected from deletion while active, manageable from Company Settings, and fully documented.

**Architecture:** DB schema adds `is_system` on agents and two boolean flags on companies. A new `pipeline-routing` service seeds all 8 agents in a transaction and handles enable/disable. Adapters are updated to read instructions from `adapterConfig.instructions` (DB-stored) before falling back to `instructionsFilePath` (filesystem). Three UI surfaces: Onboarding Wizard step 5, Company Settings section, Agents list badge/sort.

**Tech Stack:** Drizzle ORM, PostgreSQL, Express, React, TanStack Query, TypeScript, pnpm monorepo

**Prerequisites:**
- PR `feat/agent-permissions-api` must be merged first (TaskRouter needs `tasks:assign` grantable from the enable endpoint)
- Resolve any `0026_*` migration filename collision before running `drizzle-kit generate` — check `packages/db/src/migrations/` and rename duplicates so numbers are sequential

---

### Task 1: Schema — add `isSystem` to agents and two flags to companies

**Files:**
- Modify: `packages/db/src/schema/agents.ts`
- Modify: `packages/db/src/schema/companies.ts`

**Step 0: Resolve migration collision**

Two `0026_*` files already exist. Before generating anything, check:
```bash
ls packages/db/src/migrations/ | grep '^0026'
```

If you see two `0026_*` files, the last-numbered one is a draft that has NOT been applied. Rename it to the next available number AND update the Drizzle journal — both are required or `db:migrate` will fail:
```bash
# 1. Rename the unmerged file
mv packages/db/src/migrations/0026_scheduled_wake.sql packages/db/src/migrations/0027_scheduled_wake.sql

# 2. Update the journal to match — edit packages/db/src/migrations/meta/_journal.json
#    Find the entry with "tag": "0026_scheduled_wake" and change its "idx" from 26 to 27
#    and its "tag" from "0026_scheduled_wake" to "0027_scheduled_wake".
#    Read the file first to see exact field names, then edit with the correct values.

git add packages/db/src/migrations/
git commit -m "chore(db): rename duplicate 0026 migration to 0027 to unblock generation"
```

Verify only one `0026_*` file remains and the journal entries are sequential before proceeding.

**Step 1: Add `isSystem` to agents**

In `packages/db/src/schema/agents.ts`, first check the imports at the top of the file:
```ts
import { ..., boolean } from "drizzle-orm/pg-core";
```

Add `boolean` to the destructure if it isn't already there. Then add the column after `permissions`:
```ts
    isSystem: boolean("is_system").notNull().default(false),
```

**Step 2: Add flags to companies**

In `packages/db/src/schema/companies.ts`, add after `requireBoardApprovalForNewAgents`:
```ts
    pipelineRoutingEnabled: boolean("pipeline_routing_enabled").notNull().default(false),
    pipelineRoutingOnboardingSkipped: boolean("pipeline_routing_onboarding_skipped").notNull().default(false),
```

**Step 3: Build and generate migration**

```bash
cd packages/db
pnpm build
DATABASE_URL=postgresql://localhost:5432/paperclip pnpm drizzle-kit generate
```

Note the generated filename:
```bash
ls packages/db/src/migrations/ | tail -1
```

**Step 4: Verify migration content**

Read the generated file. Confirm it contains all three `ALTER TABLE` statements:
```sql
ALTER TABLE "agents" ADD COLUMN "is_system" boolean NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN "pipeline_routing_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN "pipeline_routing_onboarding_skipped" boolean NOT NULL DEFAULT false;
```

**Step 5: Typecheck**
```bash
cd packages/db && pnpm typecheck
```

**Step 6: Commit**
```bash
git add packages/db/src/schema/agents.ts packages/db/src/schema/companies.ts packages/db/src/migrations/<actual-filename>.sql
git commit -m "feat(db): add isSystem to agents and pipeline routing flags to companies"
```

---

### Task 2: Shared types and constants

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/shared/src/types/company.ts` (or wherever `Company` type is defined — read it first)

**Step 1: Add `task_router` to AGENT_ROLES**

In `packages/shared/src/constants.ts`, find `AGENT_ROLES` (currently ends with `"general"`). Add `"task_router"` to the array and add its label:

```ts
export const AGENT_ROLES = [
  "ceo", "cto", "cmo", "cfo", "engineer", "designer",
  "pm", "qa", "devops", "researcher", "general", "task_router",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  // ... existing entries ...
  task_router: "Task Router",
};
```

**Step 2: Add `isSystem` to Agent type**

In `packages/shared/src/types/agent.ts`, find the `Agent` interface and add:
```ts
isSystem: boolean;
```

**Step 3: Add pipeline routing fields to Company type**

Read `packages/shared/src/types/company.ts`. Add to the `Company` interface:
```ts
pipelineRoutingEnabled: boolean;
pipelineRoutingOnboardingSkipped: boolean;
```

**Step 4: Typecheck**
```bash
cd packages/shared && pnpm typecheck
```

Fix any errors (the `AGENT_ROLE_LABELS` Record type will enforce the new key).

**Step 5: Commit**
```bash
git add packages/shared/src/constants.ts packages/shared/src/types/agent.ts packages/shared/src/types/company.ts
git commit -m "feat(shared): add task_router role, isSystem agent field, pipeline routing company fields"
```

---

### Task 3: Delete and terminate guard for system agents

**Files:**
- Modify: `server/src/routes/agents.ts`

**Step 1: Read the current DELETE and terminate handlers**

Read `server/src/routes/agents.ts` around lines 1100–1200. Find:
- `router.delete("/agents/:id", ...)` — currently calls `svc.remove(id)` immediately
- `router.post("/agents/:id/terminate", ...)` — find this handler too

**Step 2: Add guard to DELETE handler**

Replace the DELETE handler with a version that fetches first:

```ts
router.delete("/agents/:id", async (req, res) => {
  assertBoard(req);
  const id = req.params.id as string;

  // Fetch before delete to check system guard
  const existing = await svc.getById(id);
  if (!existing) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  if (existing.isSystem) {
    res.status(409).json({ error: "Cannot delete a system agent. Disable pipeline routing first." });
    return;
  }

  const agent = await svc.remove(id);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  await logActivity(db, {
    companyId: agent.companyId,
    actorType: "user",
    actorId: req.actor.userId ?? "board",
    action: "agent.deleted",
    entityType: "agent",
    entityId: agent.id,
  });

  res.json({ ok: true });
});
```

**Step 3: Add same guard to terminate handler**

Find the terminate handler (POST `/agents/:id/terminate` or similar). Apply the same pattern:
```ts
// Before any termination logic:
const existing = await svc.getById(id);
if (!existing) { res.status(404).json({ error: "Not found" }); return; }
if (existing.isSystem) {
  res.status(409).json({ error: "Cannot terminate a system agent. Disable pipeline routing first." });
  return;
}
```

**Step 4: Typecheck and test**
```bash
cd server && pnpm typecheck
cd .. && pnpm -w test
```

All 178+ tests should pass.

**Step 5: Commit**
```bash
git add server/src/routes/agents.ts
git commit -m "feat(server): guard delete and terminate for system agents (isSystem check)"
```

---

### Task 4: Adapter instruction loading — read from `adapterConfig.instructions`

**Files:**
- Modify: `packages/adapters/claude-local/src/server/execute.ts`
- Modify: (check and modify if applicable) `packages/adapters/codex-local/src/server/execute.ts`
- Modify: (check and modify if applicable) `packages/adapters/opencode-local/src/server/execute.ts`
- Modify: (check and modify if applicable) `packages/adapters/cursor/src/server/execute.ts`

**Step 1: Read claude-local execute.ts**

Read `packages/adapters/claude-local/src/server/execute.ts`. Find the block that reads `instructionsFilePath` and creates `effectiveInstructionsFilePath` (currently around line 324–363 based on codebase exploration).

The current pattern:
```ts
const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
// ...
let effectiveInstructionsFilePath = instructionsFilePath;
if (instructionsFilePath) {
  const instructionsContent = await fs.readFile(instructionsFilePath, "utf-8");
  const pathDirective = `\nThe above agent instructions were loaded from ...`;
  const combinedPath = path.join(skillsDir, `agent-instructions-${runId}.md`);
  await fs.writeFile(combinedPath, instructionsContent + pathDirective, "utf-8");
  effectiveInstructionsFilePath = combinedPath;
}
```

**Step 2: Update to prefer `adapterConfig.instructions`**

Replace the block with:
```ts
const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
const instructionsFileDir = instructionsFilePath ? `${path.dirname(instructionsFilePath)}/` : "";
const inlineInstructions = asString(config.instructions, "").trim();

let effectiveInstructionsFilePath = instructionsFilePath;
if (inlineInstructions) {
  // DB-stored instructions take precedence over instructionsFilePath
  const combinedPath = path.join(skillsDir, `agent-instructions-${runId}.md`);
  await fs.writeFile(combinedPath, inlineInstructions, "utf-8");
  effectiveInstructionsFilePath = combinedPath;
} else if (instructionsFilePath) {
  const instructionsContent = await fs.readFile(instructionsFilePath, "utf-8");
  const pathDirective = `\nThe above agent instructions were loaded from ${instructionsFilePath}. Resolve any relative file references from ${instructionsFileDir}.`;
  const combinedPath = path.join(skillsDir, `agent-instructions-${runId}.md`);
  await fs.writeFile(combinedPath, instructionsContent + pathDirective, "utf-8");
  effectiveInstructionsFilePath = combinedPath;
}
```

Also update `commandNotes` to include the inline case:
```ts
const commandNotes = inlineInstructions
  ? ["Injected agent instructions from adapterConfig.instructions (DB-stored)"]
  : instructionsFilePath
    ? [`Injected agent instructions via --append-system-prompt-file ${instructionsFilePath}`]
    : [];
```

**Step 3: Repeat for other adapters**

For each of codex-local, opencode-local, and cursor adapters, read their execute.ts file. Find where they handle instructions/instructionsFilePath. Apply the same `inlineInstructions` check — prefer `config.instructions` if present, fall back to `instructionsFilePath`.

The exact code differs per adapter. Read each one before editing.

**Step 4: Typecheck**
```bash
cd packages/adapters/claude-local && pnpm typecheck
cd ../codex-local && pnpm typecheck
cd ../opencode-local && pnpm typecheck
```

**Step 5: Commit**
```bash
git add packages/adapters/claude-local/src/server/execute.ts \
        packages/adapters/codex-local/src/server/execute.ts \
        packages/adapters/opencode-local/src/server/execute.ts
# add cursor if applicable
git commit -m "feat(adapters): prefer adapterConfig.instructions over instructionsFilePath when set"
```

---

### Task 5: Pipeline routing service

**Files:**
- Create: `server/src/services/pipeline-routing.ts`
- Modify: `server/src/services/index.ts`

**Step 1: Read the agents service**

Read `server/src/services/agents.ts` lines 1–50 to understand the DB import pattern and how `agentService` is structured. Also read how the heartbeat service updates `adapterConfig` for an existing agent.

**Step 2: Create the service**

Create `server/src/services/pipeline-routing.ts`:

```ts
import path from "node:path";
import fs from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companies, principalPermissionGrants } from "@paperclipai/db";

import { fileURLToPath } from "node:url";

// Resolve the agents/ directory relative to this file's location (server/src/services/).
// Falls back to PIPELINE_AGENTS_DIR env var for Docker deployments.
const _thisDir = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR =
  process.env.PIPELINE_AGENTS_DIR ??
  path.resolve(_thisDir, "../../../agents"); // server/src/services/ → repo root

async function readAgentInstructions(agentDirName: string): Promise<string> {
  const filePath = path.join(AGENTS_DIR, agentDirName, "AGENTS.md");
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    console.warn(`[pipeline-routing] AGENTS.md not found at ${filePath} — agent will be seeded with empty instructions`);
    return "";
  }
}

const SPECIALIST_CONFIGS = [
  { name: "Brainstorm Agent", dirName: "brainstorm-agent", role: "researcher" },
  { name: "Plan Agent",       dirName: "plan-agent",       role: "pm" },
  { name: "Frontend Developer", dirName: "frontend-developer", role: "engineer" },
  { name: "Backend Architect",  dirName: "backend-architect",  role: "engineer" },
  { name: "Senior Developer",   dirName: "senior-developer",   role: "engineer" },
  { name: "Security Engineer",  dirName: "security-engineer",  role: "devops" },
  { name: "DevOps Automator",   dirName: "devops-automator",   role: "devops" },
] as const;

// db-compatible query helper: accepts the outer db or a transaction handle
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export function pipelineRoutingService(db: Db) {
  async function findAgentByRole(tx: DbOrTx, companyId: string, role: string) {
    const results = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.role, role)));
    return results[0] ?? null;
  }

  async function findAgentByName(tx: DbOrTx, companyId: string, name: string) {
    const results = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.name, name)));
    return results[0] ?? null;
  }

  return {
    async enable(companyId: string) {
      const taskRouterInstructions = await readAgentInstructions("task-router");
      const specialistInstructions = await Promise.all(
        SPECIALIST_CONFIGS.map((s) => readAgentInstructions(s.dirName))
      );

      return await db.transaction(async (tx) => {
        // Upsert TaskRouter (match by role = task_router, unique per company)
        // IMPORTANT: use tx for all reads inside the transaction to maintain isolation
        let taskRouter = await findAgentByRole(tx, companyId, "task_router");
        if (!taskRouter) {
          const [created] = await tx
            .insert(agents)
            .values({
              companyId,
              name: "TaskRouter",
              role: "task_router",
              isSystem: true,
              adapterType: "claude_local",
              adapterConfig: {
                instructions: taskRouterInstructions,
                heartbeat: {
                  enabled: true,
                  intervalSec: 60,
                  wakeOnDemand: true,
                  maxConcurrentRuns: 5,
                },
                maxTurnsPerRun: 200,
                dangerouslySkipPermissions: true,
              },
              permissions: {},
            })
            .returning();
          taskRouter = created!;
        } else {
          // Re-enable if previously disabled: restore isSystem
          await tx
            .update(agents)
            .set({ isSystem: true })
            .where(eq(agents.id, taskRouter.id));
        }

        // Grant tasks:assign to TaskRouter
        await tx
          .insert(principalPermissionGrants)
          .values({
            companyId,
            principalType: "agent",
            principalId: taskRouter.id,
            permissionKey: "tasks:assign",
          })
          .onConflictDoNothing();

        // Upsert specialists (match by name scoped to company)
        const specialistIds: string[] = [];
        for (let i = 0; i < SPECIALIST_CONFIGS.length; i++) {
          const cfg = SPECIALIST_CONFIGS[i]!;
          let specialist = await findAgentByName(tx, companyId, cfg.name);
          if (!specialist) {
            const [created] = await tx
              .insert(agents)
              .values({
                companyId,
                name: cfg.name,
                role: cfg.role,
                isSystem: false,
                adapterType: "claude_local",
                adapterConfig: {
                  instructions: specialistInstructions[i],
                  heartbeat: { enabled: false, wakeOnDemand: true },
                  maxTurnsPerRun: 200,
                  dangerouslySkipPermissions: true,
                },
                permissions: {},
              })
              .returning();
            specialist = created!;
          }
          specialistIds.push(specialist.id);
        }

        // Set flag
        await tx
          .update(companies)
          .set({ pipelineRoutingEnabled: true })
          .where(eq(companies.id, companyId));

        return { taskRouterId: taskRouter.id, specialistIds };
      });
    },

    async disable(companyId: string) {
      await db.transaction(async (tx) => {
        const taskRouter = await findAgentByRole(tx, companyId, "task_router");
        await tx
          .update(companies)
          .set({ pipelineRoutingEnabled: false })
          .where(eq(companies.id, companyId));

        if (taskRouter) {
          // Unprotect and stop heartbeat
          await tx
            .update(agents)
            .set({
              isSystem: false,
              adapterConfig: {
                ...(taskRouter.adapterConfig as Record<string, unknown>),
                heartbeat: {
                  ...((taskRouter.adapterConfig as Record<string, unknown>)?.heartbeat as Record<string, unknown>),
                  enabled: false,
                },
              },
            })
            .where(eq(agents.id, taskRouter.id));
        }
      });
    },

    async skipOnboarding(companyId: string) {
      await db
        .update(companies)
        .set({ pipelineRoutingOnboardingSkipped: true })
        .where(eq(companies.id, companyId));
    },
  };
}
```

**Step 3: Export from services index**

In `server/src/services/index.ts`, add:
```ts
export { pipelineRoutingService } from "./pipeline-routing.js";
```

**Step 4: Typecheck**
```bash
cd server && pnpm typecheck
```

Fix any import or type errors. Note: `findAgentByRole` and `findAgentByName` use `await` inside a transaction — Drizzle `tx` is also a full DB client.

**Step 5: Commit**
```bash
git add server/src/services/pipeline-routing.ts server/src/services/index.ts
git commit -m "feat(server): add pipeline routing service (enable/disable/skipOnboarding)"
```

---

### Task 6: Pipeline routing API endpoints

**Files:**
- Modify: `server/src/routes/companies.ts`

**Step 1: Read companies.ts**

Read `server/src/routes/companies.ts` fully. Note how `companyRoutes(db)` is called, how `assertBoard` is used, and how the router is structured.

**Step 2: Add the endpoints**

Import the new service at the top (inside `companyRoutes`, alongside other services):
```ts
const pipelineRouting = pipelineRoutingService(db);
```

Add the import to the top of the file:
```ts
import { pipelineRoutingService } from "../services/index.js";
```

Add these three routes (paths are relative to the mount point — no `/api/companies/` prefix):

```ts
router.post("/:id/pipeline-routing/enable", async (req, res) => {
  assertBoard(req);
  const companyId = req.params.id as string;
  // Verify company exists and actor has access
  const company = await svc.getById(companyId);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }

  const result = await pipelineRouting.enable(companyId);

  await logActivity(db, {
    companyId,
    actorType: "user",
    actorId: req.actor.userId ?? "board",
    action: "company.pipeline_routing_enabled",
    entityType: "company",
    entityId: companyId,
  });

  res.json(result);
});

router.post("/:id/pipeline-routing/disable", async (req, res) => {
  assertBoard(req);
  const companyId = req.params.id as string;
  const company = await svc.getById(companyId);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }

  await pipelineRouting.disable(companyId);

  await logActivity(db, {
    companyId,
    actorType: "user",
    actorId: req.actor.userId ?? "board",
    action: "company.pipeline_routing_disabled",
    entityType: "company",
    entityId: companyId,
  });

  res.json({ ok: true });
});

router.post("/:id/pipeline-routing/skip-onboarding", async (req, res) => {
  assertBoard(req);
  const companyId = req.params.id as string;
  await pipelineRouting.skipOnboarding(companyId);
  res.json({ ok: true });
});
```

**Step 3: Typecheck and test**
```bash
cd server && pnpm typecheck
cd .. && pnpm -w test
```

**Step 4: Commit**
```bash
git add server/src/routes/companies.ts
git commit -m "feat(server): add pipeline-routing enable/disable/skip-onboarding endpoints"
```

---

### Task 7: Agents list — sort system agents first and show badge

**Files:**
- Modify: `ui/src/pages/Agents.tsx`

**Step 1: Read Agents.tsx**

Read `ui/src/pages/Agents.tsx` in full. Find:
- Where agents are listed/rendered (look for `filteredAgents` or the map over agents)
- Where `EntityRow` is rendered for each agent
- How the agent name/title is displayed

**Step 2: Sort system agents first**

Find where agents are filtered (`filterAgents` function) and add a sort step. After filtering, sort `isSystem` agents to the top:

```ts
function sortWithSystemFirst(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    if (a.isSystem && !b.isSystem) return -1;
    if (!a.isSystem && b.isSystem) return 1;
    return a.name.localeCompare(b.name);
  });
}
```

Apply this sort wherever the flat agent list is rendered (look for `filterAgents(...)` call and wrap its result).

**Step 3: Add `[system]` badge**

In the agent row rendering, find where the agent name is displayed. Add a badge next to the name for system agents:

```tsx
{agent.isSystem && (
  <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
    system
  </span>
)}
```

The exact JSX location depends on how `EntityRow` renders — read the component to find the right insertion point.

**Step 4: Hide delete/terminate actions for system agents**

Find where the delete button or kebab menu actions are rendered for each agent. Wrap the delete/terminate actions in:
```tsx
{!agent.isSystem && (
  // delete button / terminate action
)}
```

**Step 5: Typecheck**
```bash
cd ui && pnpm typecheck
```

**Step 6: Commit**
```bash
git add ui/src/pages/Agents.tsx
git commit -m "feat(ui): sort system agents first, add [system] badge, hide delete for system agents"
```

---

### Task 8: Onboarding Wizard — Step 5

**Files:**
- Modify: `ui/src/components/OnboardingWizard.tsx`
- Modify: `ui/src/api/companies.ts` (add pipeline routing API calls)

**Step 1: Add pipeline routing API calls**

Read `ui/src/api/companies.ts`. Add:
```ts
enablePipelineRouting: (id: string) =>
  api.post<{ taskRouterId: string; specialistIds: string[] }>(`/companies/${id}/pipeline-routing/enable`),
disablePipelineRouting: (id: string) =>
  api.post<{ ok: boolean }>(`/companies/${id}/pipeline-routing/disable`),
skipPipelineRoutingOnboarding: (id: string) =>
  api.post<{ ok: boolean }>(`/companies/${id}/pipeline-routing/skip-onboarding`),
```

**Step 2: Read OnboardingWizard.tsx**

Read the full file. Note:
- `type Step = 1 | 2 | 3 | 4` — needs to become `1 | 2 | 3 | 4 | 5`
- `step === 4` is the "Launch" step — step 5 comes after
- The progress dots render `[1, 2, 3, 4].map(...)` — update to `[1, 2, 3, 4, 5]`
- The "Step X of 4" text — update to "of 5"
- `handleStep4Next` completes the wizard — the CTA in step 4 should now call `setStep(5)` instead of closing
- Need to understand: what happens when wizard closes? Replicate that for the step 5 skip path.

**Step 3: Update Step type and progress indicator**

```ts
type Step = 1 | 2 | 3 | 4 | 5;
```

Progress dots: change `[1, 2, 3, 4]` to `[1, 2, 3, 4, 5]` and "Step {step} of 4" to "of 5".

**Step 4: Update Step 4 CTA**

In the `handleStep4Next` or the step 4 "Continue" button handler, change it to advance to step 5 instead of closing the wizard:
```ts
setStep(5);
```

**Step 5: Add Step 5 content**

After the `{step === 4 && ...}` block, add:

```tsx
{step === 5 && (
  <div className="space-y-5">
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">Automate your issue pipeline</h2>
      <p className="text-sm text-muted-foreground">
        TaskRouter assigns issues to specialist agents — brainstorm, plan, implement, review, and merge — automatically.
      </p>
    </div>

    {/* Pipeline stage diagram */}
    <div className="flex items-center gap-1 flex-wrap text-xs text-muted-foreground font-mono bg-muted/40 rounded-md px-3 py-2">
      {["triage", "brainstorm?", "plan?", "code", "review", "PR", "merge"].map((stage, i, arr) => (
        <span key={stage} className="flex items-center gap-1">
          <span className={stage.endsWith("?") ? "opacity-60" : ""}>{stage}</span>
          {i < arr.length - 1 && <span className="opacity-40">→</span>}
        </span>
      ))}
    </div>

    <div className="space-y-2">
      <Button
        className="w-full"
        disabled={loading}
        onClick={handleEnablePipelineRouting}
      >
        {loading ? "Enabling..." : "Enable Pipeline Routing"}
      </Button>
      <Button
        variant="ghost"
        className="w-full"
        disabled={loading}
        onClick={handleSkipPipelineRouting}
      >
        Skip for now
      </Button>
    </div>
  </div>
)}
```

**Step 6: Add handlers**

Add `handleEnablePipelineRouting` and `handleSkipPipelineRouting` to the component. You'll need `createdCompanyId` (already in wizard state) for the API call. Find how the wizard closes (look for `onClose()` call or similar) and use the same mechanism:

```ts
async function handleEnablePipelineRouting() {
  if (!createdCompanyId) return;
  setLoading(true);
  setError(null);
  try {
    await companiesApi.enablePipelineRouting(createdCompanyId);
    // Navigate to agents list
    navigate(`/companies/${createdCompanyId}/agents`);
    onClose?.();
  } catch (err) {
    setError(err instanceof Error ? err.message : "Failed to enable pipeline routing");
  } finally {
    setLoading(false);
  }
}

async function handleSkipPipelineRouting() {
  if (!createdCompanyId) return;
  setLoading(true);
  try {
    await companiesApi.skipPipelineRoutingOnboarding(createdCompanyId);
  } catch {
    // non-fatal
  } finally {
    setLoading(false);
    onClose?.();
  }
}
```

**Step 7: Check if Step 5 should be shown**

Step 5 should NOT appear if the company has already skipped or enabled pipeline routing. Add a condition: if `selectedCompany?.pipelineRoutingEnabled || selectedCompany?.pipelineRoutingOnboardingSkipped`, skip directly from step 4 to close:

In `handleStep4Next` (or wherever step 4 CTA currently is), add logic:
```ts
// If company already has pipeline routing configured, skip step 5
if (company?.pipelineRoutingEnabled || company?.pipelineRoutingOnboardingSkipped) {
  onClose?.();
} else {
  setStep(5);
}
```

**Step 8: Typecheck**
```bash
cd ui && pnpm typecheck
```

**Step 9: Commit**
```bash
git add ui/src/components/OnboardingWizard.tsx ui/src/api/companies.ts
git commit -m "feat(ui): add pipeline routing step 5 to onboarding wizard"
```

---

### Task 9: Company Settings — Pipeline Routing section

**Files:**
- Modify: `ui/src/pages/CompanySettings.tsx`

**Step 1: Read CompanySettings.tsx in full**

Read the whole file. Understand how `ToggleField` is used for `requireBoardApprovalForNewAgents` (or similar toggle) — that's the pattern to follow for the Pipeline Routing toggle.

**Step 2: Add the Pipeline Routing section**

Add a new settings section after the existing agent settings area. Follow the same Card/section pattern used elsewhere in the file:

```tsx
{/* Pipeline Routing */}
<div className="space-y-4">
  <div>
    <h3 className="text-base font-semibold">Pipeline Routing</h3>
    <p className="text-sm text-muted-foreground">
      Automatically route issues through specialist agents — brainstorm, plan, implement, review, and merge.
    </p>
  </div>

  <ToggleField
    label="Enable Pipeline Routing"
    hint="Creates TaskRouter and 7 specialist agents for your company."
    value={selectedCompany?.pipelineRoutingEnabled ?? false}
    onChange={handleTogglePipelineRouting}
    disabled={pipelineRoutingMutation.isPending}
  />

  {selectedCompany?.pipelineRoutingEnabled && (
    <div className="mt-2">
      <p className="text-xs text-muted-foreground mb-2">Pipeline agents</p>
      <div className="text-sm text-muted-foreground">
        {/* Link to agents list filtered to pipeline agents */}
        <a
          href={`/companies/${selectedCompanyId}/agents`}
          className="underline underline-offset-2"
        >
          View agents →
        </a>
      </div>
    </div>
  )}
</div>
```

**Step 3: Add the mutation**

```ts
const pipelineRoutingMutation = useMutation({
  mutationFn: async (enable: boolean) => {
    if (!selectedCompanyId) return;
    if (enable) {
      await companiesApi.enablePipelineRouting(selectedCompanyId);
    } else {
      await companiesApi.disablePipelineRouting(selectedCompanyId);
    }
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.companies() });
  },
});

function handleTogglePipelineRouting(value: boolean) {
  pipelineRoutingMutation.mutate(value);
}
```

Add the `companiesApi` import if not already present (read the existing imports).

**Step 4: Typecheck**
```bash
cd ui && pnpm typecheck
```

**Step 5: Commit**
```bash
git add ui/src/pages/CompanySettings.tsx
git commit -m "feat(ui): add Pipeline Routing toggle section to Company Settings"
```

---

### Task 10: agents/README.md

**Files:**
- Create: `agents/README.md`

**Step 1: Verify the agents/ directory structure**

```bash
ls agents/
```

Confirm subdirectories: `task-router`, `brainstorm-agent`, `plan-agent`, `frontend-developer`, `backend-architect`, `senior-developer`, `security-engineer`, `devops-automator`.

**Step 2: Create the README**

Create `agents/README.md`:

```markdown
# Pipeline Routing Agents

This directory contains instructions for the 8 agents that power Paperclip's pipeline routing feature.

## What Pipeline Routing Does

When enabled, TaskRouter automatically routes issues through specialist agents based on the current issue state:

```
triage → brainstorm? → plan? → code → review → PR → merge
```

TaskRouter wakes every 60 seconds and on demand. It assigns issues to the right specialist, then the specialist executes the work and emits a `PAPERCLIP_METRICS` line on stdout to signal completion.

## How to Enable

Two ways:
1. **Onboarding Wizard** — Step 5 appears after the first agent launch
2. **Company Settings** → Pipeline Routing toggle

Both create all 8 agents and grant TaskRouter the `tasks:assign` permission.

## Agent Instructions

After seeding, agent instructions live in the DB (`adapterConfig.instructions`) and are editable from each agent's configure tab. The files in this directory are the initial seed content only — editing them after seeding has no effect unless you re-seed.

## Customizing Specialists

Edit any specialist's instructions from the agent configure tab in the UI. Changes take effect on the next run.

To add more specialists: use the standard agent creation flow. TaskRouter discovers all agents in the company at runtime via the API — it does not have a hardcoded list.

To remove a specialist: delete or terminate the agent normally. TaskRouter will stop routing to it.

## What TaskRouter Can Do

- Assign issues to any agent (`tasks:assign` permission)
- Create new agents (`agents:create` permission via `canCreateAgents`)
- Run up to 5 concurrent sessions (`maxConcurrentRuns: 5`)
- Wake every 60 seconds or on demand (`wakeOnDemand: true`)

## Programmatic Setup

Use the API directly if you prefer not to use the UI:

```bash
curl -X POST http://localhost:3100/api/companies/<your-company-id>/pipeline-routing/enable \
  -H "Authorization: Bearer <your-token>"
```

This is equivalent to clicking "Enable Pipeline Routing" in the UI.

## Docker Deployments

The enable endpoint reads AGENTS.md files at seed time via the filesystem. Set `PIPELINE_AGENTS_DIR` to an absolute path pointing to this directory if the default resolution fails:

```
PIPELINE_AGENTS_DIR=/app/agents
```

After seeding, instructions are stored in the DB and the filesystem is no longer needed.
```

**Step 3: Commit**
```bash
git add agents/README.md
git commit -m "docs: add agents/README.md covering pipeline routing setup and customization"
```

---

### Task 11: Apply migration and verify end-to-end

**Step 1: Apply migration**
```bash
DATABASE_URL=postgresql://localhost:5432/paperclip pnpm --filter @paperclipai/db db:migrate
```

Expected: "Migrations complete" (or similar success message).

**Step 2: Verify columns exist**
```bash
psql postgresql://localhost:5432/paperclip -c "\d agents" | grep is_system
psql postgresql://localhost:5432/paperclip -c "\d companies" | grep pipeline
```

Expected:
```
is_system | boolean | not null default false
pipeline_routing_enabled        | boolean | not null default false
pipeline_routing_onboarding_skipped | boolean | not null default false
```

**Step 3: Full test suite**
```bash
pnpm -w test && cd server && pnpm typecheck && cd ../ui && pnpm typecheck && cd ../packages/shared && pnpm typecheck
```

All tests must pass.

**Step 4: Smoke-test the enable endpoint (optional, requires running server)**

```bash
# Start dev server
pnpm dev

# Enable pipeline routing for your company
curl -X POST http://localhost:3100/api/companies/<your-company-id>/pipeline-routing/enable \
  -H "Cookie: <your-session-cookie>"
```

Expected: JSON with `taskRouterId` and `specialistIds`.

**Step 5: Final commit (if any cleanup needed)**
```bash
git add -A
git commit -m "chore: apply pipeline routing migration and fix any post-migration issues"
```

---

## Files Changed Summary

| File | Task | Change |
|---|---|---|
| `packages/db/src/schema/agents.ts` | 1 | Add `isSystem` column |
| `packages/db/src/schema/companies.ts` | 1 | Add `pipelineRoutingEnabled`, `pipelineRoutingOnboardingSkipped` |
| `packages/db/src/migrations/XXXX.sql` | 1 | Generated migration |
| `packages/shared/src/constants.ts` | 2 | Add `task_router` to `AGENT_ROLES` + label |
| `packages/shared/src/types/agent.ts` | 2 | Add `isSystem: boolean` |
| `packages/shared/src/types/company.ts` | 2 | Add `pipelineRoutingEnabled`, `pipelineRoutingOnboardingSkipped` |
| `server/src/routes/agents.ts` | 3 | Delete/terminate guard for `isSystem` agents |
| `packages/adapters/claude-local/src/server/execute.ts` | 4 | Prefer `adapterConfig.instructions` over file path |
| `packages/adapters/codex-local/src/server/execute.ts` | 4 | Same |
| `packages/adapters/opencode-local/src/server/execute.ts` | 4 | Same |
| `server/src/services/pipeline-routing.ts` | 5 | New service: enable/disable/skipOnboarding |
| `server/src/services/index.ts` | 5 | Export new service |
| `server/src/routes/companies.ts` | 6 | Add enable/disable/skip-onboarding endpoints |
| `ui/src/api/companies.ts` | 8 | Add pipeline routing API calls |
| `ui/src/pages/Agents.tsx` | 7 | Sort system agents first, badge, hide delete |
| `ui/src/components/OnboardingWizard.tsx` | 8 | Add Step 5 |
| `ui/src/pages/CompanySettings.tsx` | 9 | Add Pipeline Routing section |
| `agents/README.md` | 10 | New doc |

## Cherry-pick order

11 commits in order (Tasks 1–10 + migration apply). Tasks 1–6 are backend and must be sequential. Tasks 7–10 are UI/docs and are independent of each other after Task 6.
