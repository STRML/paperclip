# Agent Permissions API & UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose `principal_permission_grants` via API and UI so permissions like `tasks:assign` can be granted/revoked without direct DB access. Extend the existing `PATCH /api/agents/:id/permissions` endpoint and add a permissions panel to the agent configure tab.

**Tech Stack:** Drizzle ORM, PostgreSQL, Express, Zod, React, TanStack Query, TypeScript

**Authz pattern** (from `server/src/routes/agents.ts:861-870`): board users OR CEO agents only.

---

### Task 1: Extend shared types and validators

**Files:**
- Modify: `packages/shared/src/validators/agent.ts`
- Modify: `packages/shared/src/types/agent.ts`

**Step 1: Update `updateAgentPermissionsSchema`**

The current schema in `packages/shared/src/validators/agent.ts`:
```ts
export const updateAgentPermissionsSchema = z.object({
  canCreateAgents: z.boolean(),
});
```

Replace with:
```ts
import { PERMISSION_KEYS } from "../constants.js";

const permissionKeyEnum = z.enum(PERMISSION_KEYS as unknown as [string, ...string[]]);

export const updateAgentPermissionsSchema = z.object({
  canCreateAgents: z.boolean().optional(),
  grant: z.array(permissionKeyEnum).optional(),
  revoke: z.array(permissionKeyEnum).optional(),
});
```

**Step 2: Extend `AgentPermissions` type**

In `packages/shared/src/types/agent.ts`, update:
```ts
export interface AgentPermissions {
  canCreateAgents: boolean;
  grantedKeys: string[];  // ← add this
}
```

**Step 3: Typecheck**
```bash
cd packages/shared && pnpm typecheck
```

**Step 4: Commit**
```bash
git add packages/shared/src/validators/agent.ts packages/shared/src/types/agent.ts
git commit -m "feat(shared): extend agent permissions schema and type for granted permission keys"
```

---

### Task 2: Extend server route and service

**Files:**
- Modify: `server/src/routes/agents.ts`
- Modify: `server/src/services/agents.ts`

**Step 1: Extend `updatePermissions` service method**

In `server/src/services/agents.ts`, find the `updatePermissions` method. Extend it to:

```ts
async updatePermissions(
  agentId: string,
  data: { canCreateAgents?: boolean; grant?: string[]; revoke?: string[] },
  actorUserId?: string
) {
  // Existing canCreateAgents update (keep as-is)
  if (data.canCreateAgents !== undefined) {
    await db
      .update(agents)
      .set({ permissions: { canCreateAgents: data.canCreateAgents } })
      .where(eq(agents.id, agentId));
  }

  const agent = await this.getById(agentId);
  if (!agent) throw new Error("Agent not found");

  // Grant new permissions
  if (data.grant?.length) {
    for (const key of data.grant) {
      await db
        .insert(principalPermissionGrants)
        .values({
          companyId: agent.companyId,
          principalType: "agent",
          principalId: agentId,
          permissionKey: key,
          grantedByUserId: actorUserId ?? null,
        })
        .onConflictDoNothing();
    }
  }

  // Revoke permissions
  if (data.revoke?.length) {
    await db
      .delete(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.principalType, "agent"),
          eq(principalPermissionGrants.principalId, agentId),
          inArray(principalPermissionGrants.permissionKey, data.revoke)
        )
      );
  }

  return this.getById(agentId); // returns updated agent
}
```

Add `principalPermissionGrants` to the schema import at the top of `agents.ts` service if not already imported.

**Step 2: Update route handler to pass actor user ID and return grantedKeys**

In `server/src/routes/agents.ts`, in the `PATCH /api/agents/:id/permissions` handler (around line 852), after the existing authz check:

1. Pass `req.actor.type === "user" ? req.actor.userId : undefined` as `actorUserId` to `updatePermissions`
2. After calling `updatePermissions`, fetch current granted keys:

```ts
const updatedAgent = await svc.updatePermissions(id, req.body, actorUserId);

// Fetch current granted permission keys for this agent
const grants = await db
  .select({ permissionKey: principalPermissionGrants.permissionKey })
  .from(principalPermissionGrants)
  .where(
    and(
      eq(principalPermissionGrants.principalType, "agent"),
      eq(principalPermissionGrants.principalId, id)
    )
  );

const grantedKeys = grants.map((g) => g.permissionKey);

res.json({ ...updatedAgent, permissions: { ...updatedAgent?.permissions, grantedKeys } });
```

**Step 3: Log the change via logActivity**

After the grants/revokes in the route handler, add:
```ts
await logActivity({
  companyId: existing.companyId,
  action: "agent.permission_grant_updated",
  actorId: req.actor.type === "user" ? req.actor.userId : req.actor.agentId,
  actorType: req.actor.type,
  targetId: id,
  targetType: "agent",
  metadata: { grant: req.body.grant ?? [], revoke: req.body.revoke ?? [] },
});
```

Follow the existing `logActivity` usage pattern in `agents.ts` for the correct import and signature.

**Step 4: Add a GET endpoint to fetch current grants**

Add before the existing PATCH handler:
```ts
router.get("/:id/permissions", authenticate, async (req, res) => {
  const { id } = req.params;
  const existing = await svc.getById(id);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  // Same company check as other endpoints
  if (req.actor.type === "user") {
    const member = await companySvc.getMember(existing.companyId, req.actor.userId);
    if (!member) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const grants = await db
    .select({ permissionKey: principalPermissionGrants.permissionKey })
    .from(principalPermissionGrants)
    .where(
      and(
        eq(principalPermissionGrants.principalType, "agent"),
        eq(principalPermissionGrants.principalId, id)
      )
    );

  res.json({ grantedKeys: grants.map((g) => g.permissionKey) });
});
```

**Step 5: Typecheck and test**
```bash
cd server && pnpm typecheck
```

**Step 6: Commit**
```bash
git add server/src/routes/agents.ts server/src/services/agents.ts
git commit -m "feat(server): extend agent permissions endpoint to manage principal_permission_grants"
```

---

### Task 3: Extend API client

**Files:**
- Modify: `ui/src/api/agents.ts`

**Step 1: Add grant/revoke to updatePermissions**

In `ui/src/api/agents.ts`, update the `updatePermissions` call:
```ts
updatePermissions: (
  id: string,
  data: { canCreateAgents?: boolean; grant?: string[]; revoke?: string[] },
  companyId?: string
) => api.patch<Agent>(agentPath(id, companyId, "/permissions"), data),

getPermissions: (id: string, companyId?: string) =>
  api.get<{ grantedKeys: string[] }>(agentPath(id, companyId, "/permissions")),
```

**Step 2: Typecheck**
```bash
cd ui && pnpm typecheck
```

**Step 3: Commit**
```bash
git add ui/src/api/agents.ts
git commit -m "feat(ui/api): add grant/revoke and getPermissions to agent API client"
```

---

### Task 4: Add permissions panel to agent configure tab

**Files:**
- Modify: `ui/src/components/AgentConfigForm.tsx` (or `ui/src/pages/AgentDetail.tsx` — check where the configure tab renders permissions)

**Step 1: Add `AgentPermissionsPanel` component**

Create a new component inline or in a separate file `ui/src/components/AgentPermissionsPanel.tsx`:

```tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agents as agentsApi } from "../api/agents";
import { PERMISSION_KEYS } from "@paperclipai/shared/constants";

const PERMISSION_LABELS: Record<string, string> = {
  "agents:create": "Create Agents",
  "users:invite": "Invite Users",
  "users:manage_permissions": "Manage User Permissions",
  "tasks:assign": "Assign Tasks",
  "tasks:assign_scope": "Assign Task Scope",
  "joins:approve": "Approve Join Requests",
};

const PERMISSION_GROUPS: Record<string, string[]> = {
  "Tasks": ["tasks:assign", "tasks:assign_scope"],
  "Agents": ["agents:create"],
  "Users": ["users:invite", "users:manage_permissions"],
  "Joins": ["joins:approve"],
};

export function AgentPermissionsPanel({ agentId, companyId }: { agentId: string; companyId: string }) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["agent-permissions", agentId],
    queryFn: () => agentsApi.getPermissions(agentId, companyId),
  });

  const grantedKeys = new Set(data?.grantedKeys ?? []);

  const mutation = useMutation({
    mutationFn: (vars: { grant?: string[]; revoke?: string[] }) =>
      agentsApi.updatePermissions(agentId, vars, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-permissions", agentId] });
    },
  });

  const toggle = (key: string, currentlyGranted: boolean) => {
    if (currentlyGranted) {
      mutation.mutate({ revoke: [key] });
    } else {
      mutation.mutate({ grant: [key] });
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Permissions</h3>
      {Object.entries(PERMISSION_GROUPS).map(([group, keys]) => (
        <div key={group}>
          <p className="text-xs text-muted-foreground mb-2">{group}</p>
          <div className="space-y-2">
            {keys.map((key) => {
              const granted = grantedKeys.has(key);
              return (
                <div key={key} className="flex items-center justify-between">
                  <label className="text-sm">{PERMISSION_LABELS[key] ?? key}</label>
                  <button
                    role="switch"
                    aria-checked={granted}
                    onClick={() => toggle(key, granted)}
                    disabled={mutation.isPending}
                    className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
                      granted ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                        granted ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Add panel to agent configure tab**

In `AgentConfigForm.tsx` (or wherever the configure tab content renders), add `<AgentPermissionsPanel>` in a Card section below the existing config sections:

```tsx
import { AgentPermissionsPanel } from "./AgentPermissionsPanel";

// Inside the configure tab JSX, after the last existing Card:
<Card>
  <CardContent className="pt-6">
    <AgentPermissionsPanel agentId={agent.id} companyId={agent.companyId} />
  </CardContent>
</Card>
```

Follow the existing Card/CardContent pattern already used in the file.

**Step 3: Typecheck**
```bash
cd ui && pnpm typecheck
```

**Step 4: Commit**
```bash
git add ui/src/components/AgentPermissionsPanel.tsx ui/src/components/AgentConfigForm.tsx
git commit -m "feat(ui): add permissions panel with grant/revoke switches to agent configure tab"
```

---

### Task 5: Create draft PR and merge to sam

**Step 1: Verify tests pass**
```bash
cd server && pnpm test && pnpm typecheck
cd ui && pnpm typecheck
```

**Step 2: Push branch**
```bash
git push fork feat/agent-permissions-api -u
```

**Step 3: Create draft PR**
```bash
gh pr create \
  --repo STRML/paperclip \
  --base master \
  --head STRML:feat/agent-permissions-api \
  --draft \
  --title "feat: agent permissions API and UI panel" \
  --body "$(cat <<'EOF'
## Summary

- Extends `PATCH /api/agents/:id/permissions` to accept `{ grant, revoke }` arrays for managing `principal_permission_grants`
- Adds `GET /api/agents/:id/permissions` to fetch current granted keys
- Validates permission keys against the `PERMISSION_KEYS` constant in shared
- Requires board access or CEO agent role (existing authz pattern)
- Logs changes via `logActivity` with action `agent.permission_grant_updated`
- Returns `grantedKeys` array in permissions response
- Adds `AgentPermissionsPanel` to the agent configure tab: toggle switches grouped by category (Tasks, Agents, Users, Joins)

## Motivation

`tasks:assign` and other keys in `PERMISSION_KEYS` were only grantable via direct DB access. This unblocks TaskRouter (which needs `tasks:assign`) and makes the permission system fully manageable from the UI.

## Test Plan
- [ ] Grant `tasks:assign` to an agent via the UI toggle → verify row in `principal_permission_grants`
- [ ] Revoke it → verify row removed
- [ ] Invalid permission key returns 400
- [ ] Non-board, non-CEO caller gets 403
- [ ] `logActivity` entry created with correct action and metadata
EOF
)"
```

**Step 4: Merge to sam**
```bash
git checkout sam
git merge feat/agent-permissions-api --no-ff -m "Merge feat/agent-permissions-api into sam"
git push fork sam
```

---

## Files Changed

| File | Change |
|---|---|
| `packages/shared/src/validators/agent.ts` | Add `grant`/`revoke` arrays to schema, validated against `PERMISSION_KEYS` |
| `packages/shared/src/types/agent.ts` | Add `grantedKeys: string[]` to `AgentPermissions` |
| `server/src/routes/agents.ts` | Extend PATCH handler; add GET handler; log via logActivity |
| `server/src/services/agents.ts` | Extend `updatePermissions` to insert/delete `principal_permission_grants` rows |
| `ui/src/api/agents.ts` | Add `grant`/`revoke` params; add `getPermissions` |
| `ui/src/components/AgentPermissionsPanel.tsx` | New component: permission toggle switches grouped by category |
| `ui/src/components/AgentConfigForm.tsx` | Mount `AgentPermissionsPanel` in configure tab |

## Cherry-pick instructions

5 clean commits in order:
1. `feat(shared): extend agent permissions schema and type for granted permission keys`
2. `feat(server): extend agent permissions endpoint to manage principal_permission_grants`
3. `feat(ui/api): add grant/revoke and getPermissions to agent API client`
4. `feat(ui): add permissions panel with grant/revoke switches to agent configure tab`
5. (PR creation and sam merge — not a commit)

This plan should be implemented **before** the pipeline-routing-onboarding plan (TaskRouter needs `tasks:assign` grantable from the UI on enable).
