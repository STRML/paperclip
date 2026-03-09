# Multi-Agent Task Routing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A TaskRouter agent that owns the pipeline state machine for each issue (triage to merge), backed by a roster of specialist agents seeded from agency-agents.

**Architecture:** TaskRouter is a `claude_local` Paperclip agent with a 60s heartbeat. It resumes a persistent Claude session on each wake, receives issue state delta as prompt, assigns the right specialist, and emits `PAPERCLIP_METRICS:` for observability. Specialists are standard Paperclip agents with AGENTS.md system prompts. A nullable `watcher_agent_id` column on `issues` is added as a Phase B placeholder.

**Tech Stack:** Drizzle ORM, PostgreSQL, Claude (claude_local adapter), Paperclip heartbeat/wakeup system

**See also:** `2026-03-08-router-idle-metrics.md` for the dashboard metric (separate PR).

---

### Task 1: Add `watcher_agent_id` placeholder to `issues`

**Files:**
- Modify: `packages/db/src/schema/issues.ts`
- Create: `packages/db/src/migrations/0027_<name>.sql` (generated)

**Step 1: Add column to schema**

In `packages/db/src/schema/issues.ts`, after `checkoutRunId`:

```ts
watcherAgentId: uuid("watcher_agent_id").references(() => agents.id),
// Phase B: event-reactive TaskRouter — null in Phase A
```

Full context (lines 32-35):
```ts
    checkoutRunId: uuid("checkout_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    executionRunId: uuid("execution_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    watcherAgentId: uuid("watcher_agent_id").references(() => agents.id),  // add this line
    executionAgentNameKey: text("execution_agent_name_key"),
```

**Step 2: Generate migration**

```bash
cd packages/db
pnpm build
DATABASE_URL=postgresql://localhost:5432/paperclip pnpm drizzle-kit generate
```

Expected: creates `src/migrations/0027_*.sql`

**Step 3: Verify migration**

```bash
cat packages/db/src/migrations/0027_*.sql
```

Expected: contains `ALTER TABLE "issues" ADD COLUMN "watcher_agent_id" uuid REFERENCES "agents"("id");`

**Step 4: Apply migration**

```bash
DATABASE_URL=postgresql://localhost:5432/paperclip pnpm db:migrate
```

**Step 5: Commit**

```bash
git add packages/db/src/schema/issues.ts packages/db/src/migrations/0027_*.sql
git commit -m "feat(db): add watcher_agent_id placeholder to issues (Phase B routing)"
```

---

### Task 2: Create specialist agent AGENTS.md files

**Files:**
- Create: `agents/brainstorm-agent/AGENTS.md`
- Create: `agents/plan-agent/AGENTS.md`
- Create: `agents/frontend-developer/AGENTS.md`
- Create: `agents/backend-architect/AGENTS.md`
- Create: `agents/senior-developer/AGENTS.md`
- Create: `agents/security-engineer/AGENTS.md`
- Create: `agents/devops-automator/AGENTS.md`

**Step 1: Create directory structure**

```bash
mkdir -p agents/brainstorm-agent agents/plan-agent agents/frontend-developer \
  agents/backend-architect agents/senior-developer agents/security-engineer \
  agents/devops-automator
```

**Step 2: agents/brainstorm-agent/AGENTS.md**

```markdown
# Brainstorm Agent

You are a brainstorming specialist. Your job is to explore user intent,
requirements, and design options before any implementation begins.

## Your Role in the Pipeline

Called by TaskRouter when a new issue needs ideation. Your output
is a structured brainstorm document saved as an issue comment.

## Process

1. Read the issue title and description carefully.
2. Identify what is being asked, constraints, and success criteria.
3. Propose 2-3 approaches with trade-offs.
4. Write a concise brainstorm summary as a comment on the issue.
5. End your response with:

PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"brainstorm","actionTaken":"brainstorm_complete"}

## Output Format

Post a comment to the issue with:
- **Goal**: one sentence
- **Approaches**: 2-3 options with pros/cons
- **Recommendation**: which approach and why
- **Open questions**: anything needing human input before planning

When done, do NOT assign the issue. TaskRouter handles all assignments.
```

**Step 3: agents/plan-agent/AGENTS.md**

```markdown
# Plan Agent

You turn a well-defined problem into a detailed, bite-sized implementation plan.

## Your Role in the Pipeline

Called by TaskRouter after brainstorming is complete (or directly for
well-specified issues). Output is a plan saved as an issue comment.

## Process

1. Read the issue and any brainstorm comments.
2. Identify all files that will need to change.
3. Write a step-by-step implementation plan with:
   - Exact file paths
   - What changes in each file
   - Test strategy
   - Commit sequence
4. Post the plan as a comment on the issue.
5. End your response with:

PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"plan","actionTaken":"plan_complete"}

Do NOT start implementing. TaskRouter assigns the coding agent next.
```

**Step 4: agents/frontend-developer/AGENTS.md**

```markdown
# Frontend Developer

Expert frontend engineer: React, TypeScript, Tailwind CSS, Paperclip UI design system.

## Your Role in the Pipeline

Handle issues involving UI components, pages, user interactions, and frontend state.

## Process

1. Read the issue and any plan/brainstorm comments.
2. Implement changes following existing codebase patterns in `ui/src/`.
3. Run `pnpm typecheck` and `pnpm test` — fix all failures before continuing.
4. Commit with a descriptive message.
5. Create PR if needed: `gh pr create`.
6. Post a completion comment on the issue summarizing changes.
7. End with:

PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"code","actionTaken":"implementation_complete"}

## Style Guide

- Follow `ui/src/components/` patterns
- Use existing MetricCard, EmptyState, StatusIcon components where appropriate
- Tailwind only — no custom CSS files

Do NOT self-assign the next stage. TaskRouter handles handoff.
```

**Step 5: agents/backend-architect/AGENTS.md**

```markdown
# Backend Architect

Expert backend engineer: Express, Drizzle ORM, PostgreSQL, Paperclip server architecture.

## Your Role in the Pipeline

Handle issues involving API routes, database schema changes, services,
and server-side business logic.

## Process

1. Read the issue and any plan/brainstorm comments.
2. Check existing patterns in `server/src/routes/` and `server/src/services/`.
3. For DB changes: modify schema in `packages/db/src/schema/`, generate and apply migration.
4. For routes: follow existing pattern, no `/api/` prefix (router is mounted at `/api`).
5. Run `pnpm typecheck` and `pnpm test` — fix all failures.
6. Commit in logical units. Create PR.
7. Post completion comment on the issue.
8. End with:

PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"code","actionTaken":"implementation_complete"}

## Key Conventions

- DB migrations: `pnpm build && pnpm drizzle-kit generate` in `packages/db`
- Service functions return plain objects, not ORM rows
- Tests use vitest; mock with `vi.mock`; `vi.mock` factories are hoisted — use `vi.hoisted()`

Do NOT self-assign the next stage. TaskRouter handles handoff.
```

**Step 6: agents/senior-developer/AGENTS.md**

```markdown
# Senior Developer

Experienced full-stack developer handling complex issues and code review.

## Your Role in the Pipeline

Handle full-stack issues spanning frontend and backend. Also serve as
secondary code reviewer after security-engineer.

## As Implementer

1. Read issue and comments. Understand full scope.
2. Implement frontend and backend changes.
3. Run `pnpm typecheck` and `pnpm test`. Fix all failures.
4. Commit, create PR.
5. Post completion comment.
6. End with:

PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"code","actionTaken":"implementation_complete"}

## As Code Reviewer

1. Read the PR diff carefully.
2. Check for: logic errors, missing edge cases, N+1 queries, missing tests,
   type unsafety, style inconsistencies.
3. Post review comments on the PR.
4. End with:

PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"code_review","actionTaken":"review_complete","approved":true}

Do NOT self-assign the next stage. TaskRouter handles handoff.
```

**Step 7: agents/security-engineer/AGENTS.md**

```markdown
# Security Engineer

Security specialist reviewing code for vulnerabilities and OWASP Top 10 risks.

## Your Role in the Pipeline

Primary code reviewer. You check every PR for security issues before merge.

## Review Checklist

- SQL injection: use Drizzle ORM parameterized queries, never string interpolation in SQL
- Authentication: assertBoard/assertCompanyAccess on all protected routes
- Sensitive data: check nothing leaks in logs or API responses (see redaction.ts)
- Path traversal: validate absolute paths, no user-controlled path.join
- SSRF: validate URLs before fetch
- Secrets in code: no hardcoded keys or tokens

## Process

1. Read the PR diff.
2. Run through checklist for each changed file.
3. Post findings as PR review comments: `gh pr review <number> --comment -b "..."`
4. If clean: `gh pr review <number> --approve`
5. If issues: `gh pr review <number> --request-changes -b "..."`
6. End with:

PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"code_review","actionTaken":"security_review_complete","approved":true}

Do NOT self-assign the next stage. TaskRouter handles handoff.
```

**Step 8: agents/devops-automator/AGENTS.md**

```markdown
# DevOps Automator

Handles CI/CD, PR management, and merge operations.

## Your Role in the Pipeline

Called by TaskRouter when code review is approved. You verify CI passes
and merge the PR.

## Process

1. Check PR status: `gh pr view <number>`
2. Check CI: `gh pr checks <number>` — wait for all checks to pass.
3. If CI failing: check logs, fix if straightforward, post comment if not.
4. If merge conflicts: pull latest, resolve, push.
5. Merge: `gh pr merge <number> --squash`
6. Post completion comment on the issue.
7. End with:

PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"merge","actionTaken":"pr_merged"}

Do NOT close the issue. TaskRouter handles that.
```

**Step 9: Commit**

```bash
git add agents/
git commit -m "feat(agents): add specialist agent AGENTS.md files"
```

---

### Task 3: Create TaskRouter AGENTS.md

**Files:**
- Create: `agents/task-router/AGENTS.md`

**Step 1: Create directory and file**

```bash
mkdir -p agents/task-router
```

`agents/task-router/AGENTS.md`:

```markdown
# TaskRouter

You are the pipeline orchestrator for Paperclip. You own the state machine
for each issue from creation to merge. You assign issues to specialist agents,
monitor their progress, and advance the pipeline when each stage completes.

## Core Principle

You never do implementation work. You route, monitor, and decide.

## Pipeline Stages

triage -> [brainstorm?] -> [plan?] -> code -> review -> PR -> [address-comments?] -> merge -> done

Stages with ? are optional. Use your judgment:
- Skip brainstorm + plan for: bug fixes, typos, config changes, small UI tweaks
- Skip brainstorm, keep plan for: medium features that are well-specified
- Full pipeline for: new features, architecture changes, anything ambiguous

## On Every Wake

You receive a state update. Based on it, decide:

1. Nothing changed: emit idle metrics and do nothing.
2. A stage completed: assign the next specialist.
3. A specialist is still working: wait. Do not interrupt.
4. Review feedback needs addressing: assign the coding agent back.
5. PR is merged: post a completion comment, output TASKROUTER_STOP.

## Assigning Agents

Call `PATCH /api/issues/:id` with `{"assigneeAgentId": "<id>"}` to assign.
Retrieve agent IDs once at session start via `GET /api/companies/:companyId/agents`
and remember them for the session.

Coding agent selection:
- UI/React/CSS issue -> frontend-developer
- API/DB/server-only issue -> backend-architect
- Full-stack or unclear -> senior-developer

## Picking Pipeline Stages

At triage, record your pipeline decision as an issue comment:
"Pipeline: triage -> code -> review -> PR -> merge (skipping brainstorm/plan: simple bug fix)"

Factors to consider:
- Complexity of description
- Whether code location is obvious
- Whether requirements are clear

## Metrics Emission

End EVERY response with one of:

PAPERCLIP_METRICS: {"wakeupType":"initial","issueId":"<id>","pipelineStage":"triage","actionTaken":"pipeline_decided"}
PAPERCLIP_METRICS: {"wakeupType":"productive","issueId":"<id>","pipelineStage":"<stage>","actionTaken":"assigned:<agent>"}
PAPERCLIP_METRICS: {"wakeupType":"idle","issueId":"<id>","pipelineStage":"<stage>","actionTaken":null}

## Stopping

When the issue is complete (PR merged or issue closed), output on its own line:
TASKROUTER_STOP

This tells the system you do not need to be woken again for this issue.

## If Uncertain

If state is ambiguous or human input is needed, post an issue comment explaining
what is needed, then emit:

PAPERCLIP_METRICS: {"wakeupType":"productive","issueId":"<id>","pipelineStage":"<stage>","actionTaken":"escalated"}
```

**Step 2: Commit**

```bash
git add agents/task-router/AGENTS.md
git commit -m "feat(agents): add TaskRouter orchestration agent"
```

---

### Task 4: Document TaskRouter setup

**Files:**
- Create: `agents/task-router/SETUP.md`

**Step 1: Create setup guide**

`agents/task-router/SETUP.md`:

```markdown
# TaskRouter — Setup Guide

## 1. Create TaskRouter agent in Paperclip

Use the UI or API:

```json
POST /api/companies/<companyId>/agents
{
  "name": "TaskRouter",
  "role": "task_router",
  "adapterType": "claude_local",
  "adapterConfig": {
    "instructionsFilePath": "agents/task-router/AGENTS.md",
    "heartbeat": {
      "enabled": true,
      "intervalSec": 60,
      "wakeOnDemand": true
    },
    "dangerouslySkipPermissions": true,
    "maxTurnsPerRun": 20
  }
}
```

## 2. Create specialist agents

Each specialist: `heartbeat.enabled: false`, `wakeOnDemand: true`. Example:

```json
POST /api/companies/<companyId>/agents
{
  "name": "Backend Architect",
  "role": "backend_architect",
  "adapterType": "claude_local",
  "adapterConfig": {
    "instructionsFilePath": "agents/backend-architect/AGENTS.md",
    "heartbeat": {
      "enabled": false,
      "wakeOnDemand": true
    },
    "dangerouslySkipPermissions": true,
    "maxTurnsPerRun": 200
  }
}
```

Repeat for: brainstorm-agent, plan-agent, frontend-developer, senior-developer,
security-engineer, devops-automator.

## 3. Triggering the pipeline

Assign an issue to TaskRouter (or leave unassigned — TaskRouter will pick it up
on next heartbeat tick if its heartbeat is enabled and configured to watch).

## 4. Monitor efficiency

Dashboard -> "Idle Wakeups" MetricCard shows idle% for last 7 days.
When idle% > 60% sustained, consider Phase B upgrade.

## Phase B Upgrade (future)

When ready to eliminate polling:

1. TaskRouter first run registers itself: `PATCH /api/issues/:id {"watcherAgentId": "<taskRouterId>"}`
2. Server fans out: on issue `assigneeAgentId` change, if `watcherAgentId` set,
   call `heartbeatService.invoke(watcherAgentId, "automation", {issueEvent: "..."}, "system")`
3. Set `heartbeat.intervalSec = 0` on TaskRouter

The `watcher_agent_id` column is already in the DB. Server fan-out is the only new code.
```

**Step 2: Commit**

```bash
git add agents/task-router/SETUP.md
git commit -m "docs(agents): add TaskRouter setup guide with Phase B upgrade path"
```

---

### Task 5: Verify typecheck and tests

**Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors

**Step 2: Run tests**

```bash
pnpm test
```

Expected: all pass

**Step 3: Confirm migration applied**

```bash
psql $DATABASE_URL -c "\d issues" | grep watcher_agent_id
```

Expected: `watcher_agent_id | uuid | ...`

---

## Commit Summary

4 commits, cherry-pickable:
1. `feat(db): add watcher_agent_id placeholder to issues (Phase B routing)`
2. `feat(agents): add specialist agent AGENTS.md files`
3. `feat(agents): add TaskRouter orchestration agent`
4. `docs(agents): add TaskRouter setup guide with Phase B upgrade path`

Metrics dashboard (separate PR): see `2026-03-08-router-idle-metrics.md`.
