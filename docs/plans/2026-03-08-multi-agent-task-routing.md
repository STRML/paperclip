# Multi-Agent Task Routing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A TaskRouter agent that owns the pipeline state machine for each issue (triage to merge), backed by a roster of specialist agents.

**Architecture:** TaskRouter is a `claude_local` Paperclip agent with a 60s heartbeat. It resumes a persistent Claude session on each wake. On each wake, the `promptTemplate` injects `context.taskId` (the assigned issue ID) and `context.wakeReason`. TaskRouter fetches full issue state via the Paperclip API using the auto-injected `PAPERCLIP_API_KEY` and `PAPERCLIP_API_URL` env vars. It then assigns the right specialist and emits `PAPERCLIP_METRICS:` for observability.

When TaskRouter assigns an issue (`PATCH assigneeAgentId + status: "in_progress"`), Paperclip's existing `wakeOnDemand` mechanism automatically wakes the specialist — no separate wakeup call needed. The auto-wake only fires when `status !== "backlog"`, so both fields must be PATCHed together.

**Ordering:** Deploy and merge `router-idle-metrics` plan first. This plan's migrations (if any) follow sequentially.

**Tech Stack:** Drizzle ORM, PostgreSQL, Claude (claude_local adapter), Paperclip heartbeat/wakeup system, shell (curl for API calls)

---

### Task 1: Create specialist agent AGENTS.md files

**Files:**
- Create: `agents/brainstorm-agent/AGENTS.md`
- Create: `agents/plan-agent/AGENTS.md`
- Create: `agents/frontend-developer/AGENTS.md`
- Create: `agents/backend-architect/AGENTS.md`
- Create: `agents/senior-developer/AGENTS.md`
- Create: `agents/security-engineer/AGENTS.md`
- Create: `agents/devops-automator/AGENTS.md`

**Step 1: Create directories**

```bash
mkdir -p agents/brainstorm-agent agents/plan-agent agents/frontend-developer \
  agents/backend-architect agents/senior-developer agents/security-engineer \
  agents/devops-automator
```

**Step 2: `agents/brainstorm-agent/AGENTS.md`**

```markdown
# Brainstorm Agent

You are a brainstorming specialist. Your job is to explore user intent,
requirements, and design options before any implementation begins.

## Your Role in the Pipeline

Called by TaskRouter when a new issue needs ideation.

## Process

1. Read the issue title and description carefully.
2. Identify what is being asked, constraints, and success criteria.
3. Propose 2-3 approaches with trade-offs.
4. Post a brainstorm summary as a comment on the issue via:
   curl -X POST "$PAPERCLIP_API_URL/api/issues/$PAPERCLIP_WAKE_TASK_ID/comments" \
     -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"body": "..."}'
5. End your response with:
PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"brainstorm","actionTaken":"brainstorm_complete"}

## Output Format

Post a comment with:
- **Goal**: one sentence
- **Approaches**: 2-3 options with pros/cons
- **Recommendation**: which approach and why
- **Open questions**: anything needing human input before planning

Do NOT assign the issue. TaskRouter handles all assignments.
```

**Step 3: `agents/plan-agent/AGENTS.md`**

```markdown
# Plan Agent

You turn a well-defined problem into a detailed, bite-sized implementation plan.

## Process

1. Read the issue and any brainstorm comments.
2. Identify all files that will need to change.
3. Write a step-by-step implementation plan (exact file paths, what changes, test strategy, commit sequence).
4. Post the plan as a comment on the issue.
5. End with:
PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"plan","actionTaken":"plan_complete"}

Do NOT start implementing. TaskRouter assigns the coding agent next.
```

**Step 4: `agents/frontend-developer/AGENTS.md`**

```markdown
# Frontend Developer

Expert frontend engineer: React, TypeScript, Tailwind CSS, Paperclip UI design system.

## Process

1. Read the issue and any plan/brainstorm comments.
2. Implement changes following existing patterns in `ui/src/`.
3. Run `pnpm typecheck` and `pnpm test` — fix all failures before continuing.
4. Commit. Create PR with `gh pr create`.
5. Post a completion comment on the issue.
6. End with:
PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"code","actionTaken":"implementation_complete"}

## Style Guide

- Follow `ui/src/components/` patterns
- Use existing MetricCard, EmptyState, StatusIcon where appropriate
- Tailwind only — no custom CSS files

Do NOT self-assign the next stage. TaskRouter handles handoff.
```

**Step 5: `agents/backend-architect/AGENTS.md`**

```markdown
# Backend Architect

Expert backend engineer: Express, Drizzle ORM, PostgreSQL, Paperclip server architecture.

## Process

1. Read the issue and any plan/brainstorm comments.
2. Check existing patterns in `server/src/routes/` and `server/src/services/`.
3. For DB changes: modify schema in `packages/db/src/schema/`, run `pnpm build && pnpm drizzle-kit generate` in `packages/db`, verify the migration SQL, apply.
4. For routes: no `/api/` prefix in route paths (router is mounted at `/api`).
5. Run `pnpm typecheck` and `pnpm test` — fix all failures.
6. Commit. Create PR.
7. Post completion comment on the issue.
8. End with:
PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"code","actionTaken":"implementation_complete"}

## Key Conventions

- `vi.mock` factories are hoisted — use `vi.hoisted()` for variables inside them
- Service functions return plain objects, not ORM rows

Do NOT self-assign the next stage. TaskRouter handles handoff.
```

**Step 6: `agents/senior-developer/AGENTS.md`**

```markdown
# Senior Developer

Experienced full-stack developer for complex issues spanning frontend and backend.
Also serves as secondary code reviewer.

## As Implementer

1. Read issue and all comments.
2. Implement frontend and backend changes.
3. Run `pnpm typecheck` and `pnpm test`. Fix all failures.
4. Commit. Create PR.
5. Post completion comment.
6. End with:
PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"code","actionTaken":"implementation_complete"}

## As Code Reviewer

1. Read the PR diff.
2. Check: logic errors, missing edge cases, N+1 queries, missing tests, type unsafety, style issues.
3. Post review comments on the PR.
4. End with:
PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"code_review","actionTaken":"review_complete","approved":true}

Do NOT self-assign the next stage. TaskRouter handles handoff.
```

**Step 7: `agents/security-engineer/AGENTS.md`**

```markdown
# Security Engineer

Security specialist. Primary code reviewer for every PR before merge.

## Review Checklist

- SQL injection: Drizzle ORM parameterized queries only
- Authentication: assertBoard/assertCompanyAccess on all protected routes
- Sensitive data: nothing leaks in logs or responses (see redaction.ts)
- Path traversal: no user-controlled path.join
- SSRF: validate URLs before fetch
- Secrets: no hardcoded keys or tokens

## Process

1. Read the PR diff.
2. Apply the checklist to each changed file.
3. `gh pr review <number> --approve` if clean, or `--request-changes -b "..."` if issues found.
4. End with:
PAPERCLIP_METRICS: {"wakeupType":"productive","pipelineStage":"code_review","actionTaken":"security_review_complete","approved":true}

Do NOT self-assign the next stage. TaskRouter handles handoff.
```

**Step 8: `agents/devops-automator/AGENTS.md`**

```markdown
# DevOps Automator

Handles PR management and merge operations.

## Process

1. `gh pr view <number>` — check status.
2. `gh pr checks <number>` — wait for all CI checks to pass.
3. If CI failing: read logs, fix if straightforward, post comment if not.
4. If merge conflicts: pull latest, resolve, push.
5. `gh pr merge <number> --squash`
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

### Task 2: Create TaskRouter AGENTS.md

**Files:**
- Create: `agents/task-router/AGENTS.md`

**Step 1: Create directory**

```bash
mkdir -p agents/task-router
```

**Step 2: Write `agents/task-router/AGENTS.md`**

```markdown
# TaskRouter

You are the pipeline orchestrator for Paperclip. You own the state machine
for each issue from creation to merge. You never do implementation work.

## Environment Variables (auto-injected by Paperclip)

- `PAPERCLIP_API_URL` — base URL of the Paperclip server (e.g. http://localhost:3100)
- `PAPERCLIP_API_KEY` — bearer token for API calls
- `PAPERCLIP_AGENT_ID` — your agent ID
- `PAPERCLIP_COMPANY_ID` — your company ID

## On First Wake (session start)

Fetch all agent IDs and store them for the session:

```bash
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agents"
```

Remember each agent's name and ID. You will reference them for assignments.

## Fetching Current Issue State

Your prompt includes `task_id` (the issue ID) in the wake context block.
On each wake, fetch the full issue state:

```bash
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/api/issues/$TASK_ID"
```

Also fetch recent comments to determine pipeline stage:

```bash
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/api/issues/$TASK_ID/comments"
```

## Pipeline Stages

triage -> [brainstorm?] -> [plan?] -> code -> review -> PR -> [address-comments?] -> merge -> done

Skip brainstorm+plan for: bug fixes, typos, config changes, small tweaks.
Skip brainstorm only for: well-specified medium features.
Full pipeline for: new features, architecture changes, anything ambiguous.

## On Every Wake

Based on fetched issue state and comments, decide:

1. **Nothing changed** (same assignee, no new comments): emit idle metrics. Do nothing.
2. **Stage completed** (assignee cleared + completion comment posted): assign next specialist.
3. **Specialist still working** (assignee set, no completion yet): check elapsed time.
   - If > 30 minutes with no activity, post a check-in comment and wait one more cycle.
   - If > 60 minutes with no activity after check-in, see case 6 (failure detection).
4. **Review feedback present** (PR has review comments requesting changes): assign coding agent back.
5. **PR merged or issue closed/cancelled**: post completion summary. Emit idle. Done.
6. **Specialist failure detected** (assignee unchanged but last run errored, or > 60 min silence after check-in):
   - First occurrence: clear the assignee, reassign to the same specialist.
   - Second occurrence on same stage: clear the assignee, post a comment explaining the stall,
     emit escalated metrics. A human must intervene.

## Assigning Agents

```bash
# Assign specialist and set status to in_progress (required for auto-wake to fire)
curl -X PATCH -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  "$PAPERCLIP_API_URL/api/issues/$TASK_ID" \
  -d '{"assigneeAgentId": "<specialistId>", "status": "in_progress"}'
```

IMPORTANT: Always PATCH both `assigneeAgentId` AND `status: "in_progress"` together.
The automatic wake only fires when status is not "backlog".

Coding agent selection:
- UI/React/CSS -> frontend-developer
- API/DB/backend only -> backend-architect
- Full-stack or unclear -> senior-developer

## At Triage

Post a pipeline plan comment:

```bash
curl -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  "$PAPERCLIP_API_URL/api/issues/$TASK_ID/comments" \
  -d '{"body": "Pipeline: triage -> code -> review -> PR -> merge (reason for any skips)"}'
```

## Handling Multiple Issues

If multiple issues are assigned to you, work oldest-first. Handle one per wake —
fetch state, take action, emit metrics. On next wake, check all issues and act on any that changed.

## Metrics Emission (required on every response)

PAPERCLIP_METRICS: {"wakeupType":"initial","issueId":"<id>","pipelineStage":"triage","actionTaken":"pipeline_decided"}
PAPERCLIP_METRICS: {"wakeupType":"productive","issueId":"<id>","pipelineStage":"<stage>","actionTaken":"assigned:<agent>"}
PAPERCLIP_METRICS: {"wakeupType":"idle","issueId":"<id>","pipelineStage":"<stage>","actionTaken":null}
PAPERCLIP_METRICS: {"wakeupType":"productive","issueId":"<id>","pipelineStage":"<stage>","actionTaken":"escalated"}
```

**Step 3: Commit**

```bash
git add agents/task-router/AGENTS.md
git commit -m "feat(agents): add TaskRouter orchestration agent"
```

---

### Task 3: Create agent seed script

**Files:**
- Create: `agents/seed.sh`

**Step 1: Write the seed script**

```bash
#!/usr/bin/env bash
# agents/seed.sh — Create all pipeline agents in Paperclip
# Usage: PAPERCLIP_API_URL=http://localhost:3100 PAPERCLIP_API_KEY=<token> ./agents/seed.sh <companyId>
set -euo pipefail

COMPANY_ID="${1:?Usage: seed.sh <companyId>}"
API_URL="${PAPERCLIP_API_URL:?PAPERCLIP_API_URL required}"
API_KEY="${PAPERCLIP_API_KEY:?PAPERCLIP_API_KEY required}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

post_agent() {
  local name="$1" role="$2" instructions="$3" max_turns="${4:-200}"
  local heartbeat_enabled="${5:-false}"
  local interval="${6:-0}"

  echo "Creating agent: $name..."
  curl -sf -X POST "$API_URL/api/companies/$COMPANY_ID/agents" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(printf '{
      "name": "%s",
      "role": "%s",
      "adapterType": "claude_local",
      "adapterConfig": {
        "instructionsFilePath": "%s",
        "heartbeat": {
          "enabled": %s,
          "intervalSec": %d,
          "wakeOnDemand": true
        },
        "dangerouslySkipPermissions": true,
        "maxTurnsPerRun": %d
      }
    }' "$name" "$role" "$instructions" "$heartbeat_enabled" "$interval" "$max_turns")" \
    | jq -r '"  -> id: " + .id'
}

post_agent "Brainstorm Agent"   "brainstorm_agent"    "$SCRIPT_DIR/brainstorm-agent/AGENTS.md"
post_agent "Plan Agent"         "plan_agent"          "$SCRIPT_DIR/plan-agent/AGENTS.md"
post_agent "Frontend Developer" "frontend_developer"  "$SCRIPT_DIR/frontend-developer/AGENTS.md"
post_agent "Backend Architect"  "backend_architect"   "$SCRIPT_DIR/backend-architect/AGENTS.md"
post_agent "Senior Developer"   "senior_developer"    "$SCRIPT_DIR/senior-developer/AGENTS.md"
post_agent "Security Engineer"  "security_engineer"   "$SCRIPT_DIR/security-engineer/AGENTS.md"
post_agent "DevOps Automator"   "devops_automator"    "$SCRIPT_DIR/devops-automator/AGENTS.md"
post_agent "TaskRouter"         "task_router"         "$SCRIPT_DIR/task-router/AGENTS.md" 20 true 60

echo ""
echo "All agents created. Copy the IDs above into task-router/AGENTS.md if you want to hardcode them,"
echo "or leave TaskRouter to discover them via GET /api/companies/$COMPANY_ID/agents at runtime."
```

**Step 2: Make executable**

```bash
chmod +x agents/seed.sh
```

**Step 3: Run it**

```bash
PAPERCLIP_API_URL=http://localhost:3100 \
PAPERCLIP_API_KEY=<your-token> \
./agents/seed.sh <your-company-id>
```

Expected: each agent prints its new ID. Verify in the Paperclip agents list.

**Step 4: Commit**

```bash
git add agents/seed.sh
git commit -m "feat(agents): add seed script for creating all pipeline agents"
```

---

### Task 4: Verify

**Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors (this plan has no TypeScript changes — agents are config/docs only)

**Step 2: Run tests**

```bash
pnpm test
```

Expected: all pass

**Step 3: Verify promptTemplate variables at runtime**

When TaskRouter first runs, confirm `context.taskId` is populated by checking the run log.
The template renders `context` fields — the `[Paperclip wake context]` block appended by
`buildWakeContextSuffix` (in `packages/adapter-utils/src/server-utils.ts:98`) provides:
- `task_id` from `context.taskId`
- `wake_reason` from `context.wakeReason`
- `wake_comment_id` from `context.wakeCommentId`

TaskRouter reads `task_id` from the wake context block and uses it for API calls.

---

## Commit Summary

4 commits:
1. `feat(agents): add specialist agent AGENTS.md files`
2. `feat(agents): add TaskRouter orchestration agent`
3. `feat(agents): add seed script for creating all pipeline agents`
4. (Task 4 is verification only — no commit)

**Deploy order:** `router-idle-metrics` plan first, then this plan.
