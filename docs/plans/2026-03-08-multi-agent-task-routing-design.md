# Multi-Agent Task Routing — Design

**Date:** 2026-03-08

## Problem

Issues in Paperclip get assigned manually. There is no routing intelligence: no automatic assignment to the right specialist, no pipeline progression from idea → code → PR → merge, and no feedback loop for humans to see how efficient the system is.

## Goals

1. **Always use the best agent for the job** — when an issue has no assignee, a TaskRouter decides which specialist gets it.
2. **Determined pipeline** — idea → (brainstorm) → (plan) → code → code review → PR → address review → merge. Steps in parens are skippable for small fixes.
3. **Single issue** — no issue log pollution. One issue, one pipeline run.
4. **Measurable** — track idle wakeup% so we know when to upgrade the polling mechanism.

## Architecture

### TaskRouter Agent

A Paperclip agent (`claude_local`, role `task_router`) that runs concurrently with the assigned specialist. It owns the pipeline state machine for one issue's lifetime.

- **Heartbeat:** 60s interval (configurable). Backs off by self-patching `adapterConfig.heartbeat.intervalSec` when it detects idle.
- **Session resumption:** stores `sessionId` in `runtimeState`. Each wake resumes the same Claude session; new context injected as the prompt delta — token cost per wake is small.
- **Termination:** when issue is closed, cancelled, or reassigned to a human (Board), TaskRouter does nothing on next wake and stops self-scheduling by setting `intervalSec = 0`.

### Specialist Agents

Configured as standard Paperclip agents. AGENTS.md provides system prompt + role. Based on agency-agents roster; only engineering-relevant ones imported:

| Agent shortname | Source | Role |
|---|---|---|
| `brainstorm-agent` | new | Brainstorming skill |
| `plan-agent` | new | Writing-plans skill |
| `frontend-developer` | engineering-frontend-developer.md | React/Vue/UI |
| `backend-architect` | engineering-backend-architect.md | API/DB/infra |
| `senior-developer` | engineering-senior-developer.md | General, review |
| `security-engineer` | engineering-security-engineer.md | Code review |
| `devops-automator` | engineering-devops-automator.md | CI/CD, merge |

### Pipeline State Machine

```
          ┌─────────────────────────────────┐
          │         TaskRouter              │
          │  owns state, assigns agents     │
          └──┬──────────────────────────────┘
             │
             ▼
        [triage]  ←── reads issue, decides which stages apply
             │
     ┌───────┴────────┐
     │                │
  small fix        full feature
     │                │
     └──────┐   ┌─────┘
            ▼   ▼
         [brainstorm?]  — skip if simple
             │
          [plan?]       — skip if simple
             │
          [code]        — frontend / backend / senior-dev
             │
          [review]      — security-engineer + senior-dev
             │
          [PR]          — devops-automator or coding agent
             │
     [address comments] — loops until approved
             │
          [merge]
             │
         [done → reassign to Board]
```

### Session Protocol

Each TaskRouter wake injects state delta as prompt:

```
[resume session]

Issue #42 state update (2026-03-08T14:32:11Z):
- Previous assignee: backend-architect → now unassigned (run completed)
- Latest comment: "Implementation complete. PR #37 opened."
- PR #37 status: open, 1 review requested

What is the next step?
```

TaskRouter responds with action + emits metrics marker:

```
Assigning security-engineer for code review of PR #37.

PAPERCLIP_METRICS: {"wakeupType":"productive","issueId":"abc123","pipelineStage":"code_review","actionTaken":"assigned:security-engineer"}
```

### Observability

TaskRouter emits `PAPERCLIP_METRICS: <json>` in its stdout on every wake. Server parses this and stores `wakeupType` in `heartbeat_runs.wakeup_type` column. Dashboard aggregates idle% for router runs over the last 7 days.

**Upgrade signal for Phase B:** when idle% > 60% sustained over a week, add `watcher_agent_id` FK on issues with server-side event fan-out to eliminate polling. Column is added as a nullable placeholder in Phase A.

## What This Is Not

- Not a multi-issue orchestration system (one issue, one pipeline)
- Not replacing GitHub PR reviews — humans still review PRs, router monitors status
- Not adding new wakeup infrastructure in Phase A (polling only)

## Phase A Scope (This Plan)

1. DB: `watcher_agent_id` nullable on `issues` (placeholder)
2. DB: `wakeup_type` on `heartbeat_runs` + dashboard metric **(separate PR)**
3. Agent AGENTS.md files for all 8 specialists + TaskRouter
4. TaskRouter configuration guide

## Phase B (Future)

- `watcher_agent_id` becomes active: server fans out wakeups to watcher on issue update/assignment/PR event
- TaskRouter converts from polling to pure event-reactive
- Heartbeat interval on TaskRouter set to 0 (disabled) once event fan-out works
