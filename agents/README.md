# Pipeline Routing Agents

This directory contains instructions for the 8 agents that power Paperclip's pipeline routing feature.

## What Pipeline Routing Does

When enabled, TaskRouter automatically routes issues through specialist agents based on the current issue state:

triage → brainstorm? → plan? → code → review → PR → merge

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

    curl -X POST http://localhost:3100/api/companies/<your-company-id>/pipeline-routing/enable \
      -H "Authorization: Bearer <your-token>"

This is equivalent to clicking "Enable Pipeline Routing" in the UI.

## Docker Deployments

The enable endpoint reads AGENTS.md files at seed time via the filesystem. Set `PIPELINE_AGENTS_DIR` to an absolute path pointing to this directory if the default resolution fails:

    PIPELINE_AGENTS_DIR=/app/agents

After seeding, instructions are stored in the DB and the filesystem is no longer needed.
