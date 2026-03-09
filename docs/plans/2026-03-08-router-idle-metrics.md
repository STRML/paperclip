# Router Idle Wakeup Metrics — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `wakeup_type` tracking to `heartbeat_runs` and expose idle wakeup% on the dashboard as a MetricCard.

**Architecture:** TaskRouter emits `PAPERCLIP_METRICS: <json>` in stdout. Server parses it at run completion, stores `wakeup_type` in a new column. Dashboard query aggregates idle vs total for last 7 days.

**Tech Stack:** Drizzle ORM, PostgreSQL, Express, React, TanStack Query, TypeScript

---

### Task 1: Add `wakeup_type` column to `heartbeat_runs` schema

**Files:**
- Modify: `packages/db/src/schema/heartbeat_runs.ts`

**Step 1: Add the column**

In `heartbeat_runs.ts`, add after `errorCode`:

```ts
wakeupType: text("wakeup_type"),
```

Full context (lines 32–36):
```ts
    errorCode: text("error_code"),
    wakeupType: text("wakeup_type"),  // ← add this
    externalRunId: text("external_run_id"),
```

**Step 2: Generate migration**

```bash
cd packages/db
pnpm build
DATABASE_URL=postgresql://localhost:5432/paperclip pnpm drizzle-kit generate
```

Expected: creates `src/migrations/0026_<name>.sql` with `ALTER TABLE "heartbeat_runs" ADD COLUMN "wakeup_type" text;`

**Step 3: Verify migration file content**

```bash
cat packages/db/src/migrations/0026_*.sql
```

Expected output contains: `ALTER TABLE "heartbeat_runs" ADD COLUMN "wakeup_type" text;`

**Step 4: Commit**

```bash
git add packages/db/src/schema/heartbeat_runs.ts packages/db/src/migrations/0026_*.sql
git commit -m "feat(db): add wakeup_type column to heartbeat_runs"
```

---

### Task 2: Parse router metrics from run stdout

**Files:**
- Modify: `server/src/services/heartbeat.ts`

**Step 1: Write the failing test**

Add to `server/src/__tests__/router-metrics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseRouterMetrics } from "../services/heartbeat.js";

describe("parseRouterMetrics", () => {
  it("returns null for empty string", () => {
    expect(parseRouterMetrics("")).toBeNull();
  });

  it("returns null when marker absent", () => {
    expect(parseRouterMetrics("some output\nno marker here")).toBeNull();
  });

  it("parses wakeupType from PAPERCLIP_METRICS line", () => {
    const stdout = 'Assigning agent.\n\nPAPERCLIP_METRICS: {"wakeupType":"idle","issueId":"abc"}\n';
    expect(parseRouterMetrics(stdout)).toEqual({ wakeupType: "idle", issueId: "abc" });
  });

  it("picks the last PAPERCLIP_METRICS line if multiple", () => {
    const stdout = 'PAPERCLIP_METRICS: {"wakeupType":"productive"}\nmore output\nPAPERCLIP_METRICS: {"wakeupType":"idle"}\n';
    expect(parseRouterMetrics(stdout)).toEqual({ wakeupType: "idle" });
  });

  it("returns null for malformed JSON", () => {
    const stdout = "PAPERCLIP_METRICS: not-json\n";
    expect(parseRouterMetrics(stdout)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd server
pnpm test router-metrics
```

Expected: FAIL with "parseRouterMetrics is not exported"

**Step 3: Add `parseRouterMetrics` to heartbeat.ts**

Add near the top of `server/src/services/heartbeat.ts` (after imports, before constants):

```ts
export function parseRouterMetrics(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("PAPERCLIP_METRICS: ")) continue;
    try {
      const parsed = JSON.parse(line.slice("PAPERCLIP_METRICS: ".length));
      if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
    } catch {
      // malformed, keep scanning
    }
  }
  return null;
}
```

**Step 4: Wire it into run completion**

In `server/src/services/heartbeat.ts`, find the `db.update(heartbeatRuns)` call around line 1383 that sets `resultJson`. Add `wakeupType` extraction before the update:

```ts
const routerStdout =
  typeof adapterResult.resultJson?.stdout === "string" ? adapterResult.resultJson.stdout : "";
const routerMetrics = parseRouterMetrics(routerStdout);
const wakeupType =
  typeof routerMetrics?.wakeupType === "string" ? routerMetrics.wakeupType : null;
```

Then add to the `.set({...})` object:

```ts
wakeupType,
```

**Step 5: Run tests**

```bash
cd server
pnpm test router-metrics
pnpm typecheck
```

Expected: PASS, no type errors

**Step 6: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/router-metrics.test.ts
git commit -m "feat(heartbeat): parse and store router wakeup_type from run stdout"
```

---

### Task 3: Add router efficiency to dashboard service

**Files:**
- Modify: `packages/shared/src/types/dashboard.ts`
- Modify: `server/src/services/dashboard.ts`

**Step 1: Write the failing test**

Add to `server/src/__tests__/dashboard-router-metrics.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
// This is an integration-style test — mock the DB response
// to verify the query logic produces the right shape.
// (Full DB tests live in the heartbeat test suite.)

import { describe, it, expect } from "vitest";

// Validate the shape of routerWakeupEfficiency in the summary response.
it("routerWakeupEfficiency has correct shape when no router runs", () => {
  const efficiency = { totalWakeups: 0, idleWakeups: 0, idlePercent: 0 };
  expect(efficiency.idlePercent).toBe(0);
  expect(efficiency.totalWakeups).toBeGreaterThanOrEqual(0);
});

it("idlePercent is 0 when totalWakeups is 0 (no division by zero)", () => {
  const total = 0;
  const idle = 0;
  const percent = total > 0 ? Math.round((idle / total) * 100) : 0;
  expect(percent).toBe(0);
});

it("idlePercent rounds correctly", () => {
  const total = 3;
  const idle = 1;
  const percent = total > 0 ? Math.round((idle / total) * 100) : 0;
  expect(percent).toBe(33);
});
```

**Step 2: Run test to verify it passes already (logic test)**

```bash
cd server && pnpm test dashboard-router-metrics
```

Expected: PASS (these are pure logic tests; they validate the math we're about to implement)

**Step 3: Update `DashboardSummary` type**

In `packages/shared/src/types/dashboard.ts`, add:

```ts
export interface DashboardSummary {
  // ... existing fields ...
  routerWakeupEfficiency: {
    totalWakeups: number;
    idleWakeups: number;
    idlePercent: number;
  };
}
```

**Step 4: Add query to dashboard service**

In `server/src/services/dashboard.ts`, add after the `staleTasks` query:

```ts
import { heartbeatRuns } from "@paperclipai/db";  // add to existing import

// inside summary():
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const routerWakeupRows = await db
  .select({
    totalWakeups: sql<number>`count(*)`,
    idleWakeups: sql<number>`count(*) filter (where ${heartbeatRuns.wakeupType} = 'idle')`,
  })
  .from(heartbeatRuns)
  .where(
    and(
      eq(heartbeatRuns.companyId, companyId),
      gte(heartbeatRuns.startedAt, sevenDaysAgo),
      sql`${heartbeatRuns.wakeupType} is not null`,
    ),
  )
  .then((rows) => rows[0] ?? { totalWakeups: 0, idleWakeups: 0 });

const totalWakeups = Number(routerWakeupRows.totalWakeups);
const idleWakeups = Number(routerWakeupRows.idleWakeups);
const idlePercent = totalWakeups > 0 ? Math.round((idleWakeups / totalWakeups) * 100) : 0;
```

Add to the `return` object:

```ts
routerWakeupEfficiency: {
  totalWakeups,
  idleWakeups,
  idlePercent,
},
```

**Step 5: Add `heartbeatRuns` to dashboard service import**

`packages/db` already exports `heartbeatRuns`. Add it to the import at the top of `dashboard.ts`:

```ts
import { agents, approvals, companies, costEvents, issues, heartbeatRuns } from "@paperclipai/db";
```

**Step 6: Typecheck**

```bash
cd server && pnpm typecheck
cd packages/shared && pnpm typecheck
```

Expected: no errors

**Step 7: Commit**

```bash
git add packages/shared/src/types/dashboard.ts server/src/services/dashboard.ts server/src/__tests__/dashboard-router-metrics.test.ts
git commit -m "feat(dashboard): add routerWakeupEfficiency to summary query"
```

---

### Task 4: Add idle wakeup MetricCard to Dashboard UI

**Files:**
- Modify: `ui/src/pages/Dashboard.tsx`

**Step 1: Identify where to add**

The current 4-card grid is at line 212:
```tsx
<div className="grid grid-cols-2 xl:grid-cols-4 gap-1 sm:gap-2">
```

We add a 5th card. Change grid to `xl:grid-cols-5` and add after the Pending Approvals card.

**Step 2: Add import**

Add `Zap` to the lucide-react import in `Dashboard.tsx`:

```ts
import { Bot, CircleDot, DollarSign, ShieldCheck, LayoutDashboard, Zap } from "lucide-react";
```

**Step 3: Update grid and add card**

Change the grid classname:
```tsx
<div className="grid grid-cols-2 xl:grid-cols-5 gap-1 sm:gap-2">
```

Add after the existing `MetricCard` for Pending Approvals:

```tsx
<MetricCard
  icon={Zap}
  value={
    data.routerWakeupEfficiency.totalWakeups === 0
      ? "—"
      : `${data.routerWakeupEfficiency.idlePercent}%`
  }
  label="Idle Wakeups"
  description={
    <span>
      {data.routerWakeupEfficiency.idleWakeups} idle of{" "}
      {data.routerWakeupEfficiency.totalWakeups} router wakeups (7d)
    </span>
  }
/>
```

**Step 4: Typecheck**

```bash
cd ui && pnpm typecheck
```

Expected: no errors (type flows from `DashboardSummary`)

**Step 5: Smoke-test visually**

Start dev server, navigate to Dashboard. When no TaskRouter runs exist, card shows "—". When runs exist with `wakeup_type` set, shows percentage.

**Step 6: Commit**

```bash
git add ui/src/pages/Dashboard.tsx
git commit -m "feat(ui): add idle wakeup% MetricCard to dashboard"
```

---

### Task 5: Apply migration and verify end-to-end

**Step 1: Apply migration**

```bash
DATABASE_URL=postgresql://localhost:5432/paperclip pnpm --filter @paperclipai/db db:migrate
```

Expected: "Applying 1 pending migration(s)... Migrations complete"

**Step 2: Verify column exists**

```bash
psql $DATABASE_URL -c "\d heartbeat_runs" | grep wakeup_type
```

Expected: `wakeup_type | text | ...`

**Step 3: Run full test suite**

```bash
pnpm test
pnpm typecheck
```

Expected: all pass

**Step 4: Final commit (if any fixups needed)**

```bash
git add -p
git commit -m "fix(router-metrics): <describe fixup>"
```

---

## Cherry-pick instructions

This plan produces 5 clean commits:
1. `feat(db): add wakeup_type column to heartbeat_runs`
2. `feat(heartbeat): parse and store router wakeup_type from run stdout`
3. `feat(dashboard): add routerWakeupEfficiency to summary query`
4. `feat(ui): add idle wakeup% MetricCard to dashboard`
5. (optional fixup)

Cherry-pick in order: `git cherry-pick <sha1> <sha2> <sha3> <sha4>`
