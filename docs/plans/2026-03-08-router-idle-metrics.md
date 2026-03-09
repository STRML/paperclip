# Router Idle Wakeup Metrics — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `wakeup_type` tracking to `heartbeat_runs` and expose idle wakeup% on the dashboard as a MetricCard.

**Architecture:** TaskRouter emits `PAPERCLIP_METRICS: <json>` in stdout. Server parses it from `stdoutExcerpt` at run completion, stores `wakeup_type` in a new column. Dashboard query aggregates idle vs total for last 7 days.

**Tech Stack:** Drizzle ORM, PostgreSQL, Express, React, TanStack Query, TypeScript

---

### Task 1: Add `wakeup_type` column to `heartbeat_runs` schema

**Files:**
- Modify: `packages/db/src/schema/heartbeat_runs.ts`

**Step 1: Add the column**

In `heartbeat_runs.ts`, add after `errorCode`:

```ts
    errorCode: text("error_code"),
    wakeupType: text("wakeup_type"),  // ← add this line
    externalRunId: text("external_run_id"),
```

**Step 2: Generate migration**

```bash
cd packages/db
pnpm build
DATABASE_URL=postgresql://localhost:5432/paperclip pnpm drizzle-kit generate
```

Expected: creates a new `src/migrations/XXXX_<name>.sql`. Note the actual filename — do not assume the number.

**Step 3: Verify migration file content**

```bash
ls packages/db/src/migrations/ | tail -1
```

Then read that file and confirm it contains:
```sql
ALTER TABLE "heartbeat_runs" ADD COLUMN "wakeup_type" text;
```

**Step 4: Commit (use the actual generated filename)**

```bash
git add packages/db/src/schema/heartbeat_runs.ts
git add packages/db/src/migrations/<actual-generated-filename>.sql
git commit -m "feat(db): add wakeup_type column to heartbeat_runs"
```

---

### Task 2: Parse router metrics from run stdout

**Files:**
- Modify: `server/src/services/heartbeat.ts`
- Create: `server/src/__tests__/router-metrics.test.ts`

**Step 1: Write the failing test**

Create `server/src/__tests__/router-metrics.test.ts`:

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
    const stdout = 'Done.\n\nPAPERCLIP_METRICS: {"wakeupType":"idle","issueId":"abc"}\n';
    expect(parseRouterMetrics(stdout)?.wakeupType).toBe("idle");
  });

  it("picks the last PAPERCLIP_METRICS line if multiple", () => {
    const stdout =
      'PAPERCLIP_METRICS: {"wakeupType":"productive"}\nmore output\nPAPERCLIP_METRICS: {"wakeupType":"idle"}\n';
    expect(parseRouterMetrics(stdout)?.wakeupType).toBe("idle");
  });

  it("returns null for malformed JSON", () => {
    expect(parseRouterMetrics("PAPERCLIP_METRICS: not-json\n")).toBeNull();
  });

  it("returns null for wakeupType outside allowed set", () => {
    expect(parseRouterMetrics('PAPERCLIP_METRICS: {"wakeupType":"bad_value"}\n')).toBeNull();
  });

  it("accepts all valid wakeupType values", () => {
    for (const type of ["idle", "productive", "initial"]) {
      const stdout = `PAPERCLIP_METRICS: {"wakeupType":"${type}"}\n`;
      expect(parseRouterMetrics(stdout)?.wakeupType).toBe(type);
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd server && pnpm test router-metrics
```

Expected: FAIL with "parseRouterMetrics is not exported"

**Step 3: Add `parseRouterMetrics` to heartbeat.ts**

Add after the import block in `server/src/services/heartbeat.ts`, before the first constant:

```ts
const VALID_WAKEUP_TYPES = new Set(["idle", "productive", "initial"]);

export function parseRouterMetrics(stdout: string): { wakeupType: string } | null {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("PAPERCLIP_METRICS: ")) continue;
    try {
      const parsed = JSON.parse(line.slice("PAPERCLIP_METRICS: ".length));
      if (typeof parsed?.wakeupType === "string" && VALID_WAKEUP_TYPES.has(parsed.wakeupType)) {
        return { wakeupType: parsed.wakeupType };
      }
    } catch {
      // malformed JSON — keep scanning
    }
  }
  return null;
}
```

**Step 4: Wire into run completion — use `stdoutExcerpt`**

In `server/src/services/heartbeat.ts`, locate the `setRunStatus` call where the run is finalized (around line 1394). The local variable `stdoutExcerpt` is in scope — it holds the raw process stdout captured via `onLog("stdout", chunk)`.

**IMPORTANT:** Use `stdoutExcerpt`, NOT `adapterResult.resultJson?.stdout`.
For successful `claude_local` runs, `resultJson` is the structured Claude JSON output — its `.stdout` field is `undefined`. `stdoutExcerpt` is the correct source.

Add immediately before the `setRunStatus` call:

```ts
const routerMetrics = parseRouterMetrics(stdoutExcerpt);
const wakeupType = routerMetrics?.wakeupType ?? null;
```

Add `wakeupType` to the patch object passed to `setRunStatus`:

```ts
await setRunStatus(run.id, status, {
  // ... existing fields ...
  wakeupType,
});
```

**Step 5: Run tests**

```bash
cd server
pnpm test router-metrics
pnpm typecheck
```

Expected: all PASS, no type errors.

**Step 6: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/__tests__/router-metrics.test.ts
git commit -m "feat(heartbeat): parse and store router wakeup_type from stdoutExcerpt"
```

---

### Task 3: Add router efficiency to dashboard service

**Files:**
- Modify: `packages/shared/src/types/dashboard.ts`
- Modify: `server/src/services/dashboard.ts`
- Create: `server/src/__tests__/dashboard-router-metrics.test.ts`

**Step 1: Update `DashboardSummary` type**

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

**Step 2: Write a test for the idlePercent computation**

Create `server/src/__tests__/dashboard-router-metrics.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("routerWakeupEfficiency idlePercent", () => {
  // Validates the exact formula used in dashboard.ts — if someone changes the
  // formula in the service, this test catches the regression.
  function compute(total: number, idle: number) {
    return total > 0 ? Math.round((idle / total) * 100) : 0;
  }

  it("returns 0 when totalWakeups is 0 (no division by zero)", () => {
    expect(compute(0, 0)).toBe(0);
  });

  it("computes correct percentage", () => {
    expect(compute(10, 3)).toBe(30);
  });

  it("rounds to nearest integer", () => {
    expect(compute(3, 1)).toBe(33);
  });

  it("returns 100 when all wakeups are idle", () => {
    expect(compute(5, 5)).toBe(100);
  });
});
```

**Step 3: Run test**

```bash
cd server && pnpm test dashboard-router-metrics
```

Expected: PASS

**Step 4: Add query to dashboard service**

In `server/src/services/dashboard.ts`:

Add `heartbeatRuns` to the existing import:
```ts
import { agents, approvals, companies, costEvents, issues, heartbeatRuns } from "@paperclipai/db";
```

Inside `summary()`, after the `staleTasks` query, add:

```ts
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
      isNotNull(heartbeatRuns.wakeupType),
    ),
  )
  .then((rows) => rows[0] ?? { totalWakeups: 0, idleWakeups: 0 });

const totalWakeups = Number(routerWakeupRows.totalWakeups);
const idleWakeups = Number(routerWakeupRows.idleWakeups);
const idlePercent = totalWakeups > 0 ? Math.round((idleWakeups / totalWakeups) * 100) : 0;
```

Add `isNotNull` to the drizzle-orm import at the top of `dashboard.ts`:
```ts
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
```

Add to the `return` object:
```ts
routerWakeupEfficiency: { totalWakeups, idleWakeups, idlePercent },
```

**Step 5: Typecheck**

```bash
cd server && pnpm typecheck
cd packages/shared && pnpm typecheck
```

Expected: no errors

**Step 6: Commit**

```bash
git add packages/shared/src/types/dashboard.ts server/src/services/dashboard.ts server/src/__tests__/dashboard-router-metrics.test.ts
git commit -m "feat(dashboard): add routerWakeupEfficiency to summary query"
```

---

### Task 4: Add idle wakeup MetricCard to Dashboard UI

**Files:**
- Modify: `ui/src/pages/Dashboard.tsx`

**Step 1: Add `Zap` to lucide-react import**

```ts
import { Bot, CircleDot, DollarSign, ShieldCheck, LayoutDashboard, Zap } from "lucide-react";
```

**Step 2: Update grid and add card**

Change the 4-card grid classname to 5 columns:
```tsx
<div className="grid grid-cols-2 xl:grid-cols-5 gap-1 sm:gap-2">
```

Add after the existing Pending Approvals `MetricCard`:

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

**Step 3: Typecheck**

```bash
cd ui && pnpm typecheck
```

Expected: no errors

**Step 4: Smoke-test visually**

Start dev server (`pnpm dev`), navigate to Dashboard.
- No TaskRouter runs: card shows "—"
- With runs having `wakeup_type` set: shows percentage

**Step 5: Commit**

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

Expected: "Migrations complete"

**Step 2: Verify column exists**

```bash
psql $DATABASE_URL -c "\d heartbeat_runs" | grep wakeup_type
```

Expected: `wakeup_type | text | ...`

**Step 3: Full test suite**

```bash
pnpm test && pnpm typecheck
```

Expected: all pass

---

## Cherry-pick instructions

4 clean commits in order:
1. `feat(db): add wakeup_type column to heartbeat_runs`
2. `feat(heartbeat): parse and store router wakeup_type from stdoutExcerpt`
3. `feat(dashboard): add routerWakeupEfficiency to summary query`
4. `feat(ui): add idle wakeup% MetricCard to dashboard`

This plan must be merged **before** the multi-agent-task-routing plan (migration ordering).
