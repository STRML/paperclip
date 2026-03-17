---
name: rebase-sam
description: Rebase the sam branch onto the latest origin/master
---

# Rebase Sam Skill

Rebase the `sam` branch onto the latest `origin/master`.

## Steps

1. Ensure we're on the `sam` branch: `git checkout sam` if needed.
2. Fetch latest master: `git fetch origin master`.
3. Summarize new upstream commits before rebasing — count, key themes, overlap with sam features.
4. Start the rebase: `git rebase origin/master`.
5. If conflicts occur, resolve them:
   - For each conflicted file, read the conflict markers and determine the correct resolution.
   - **General conflict resolution principles:**
     - If HEAD (upstream) adds a feature and incoming (sam) adds a different feature, keep both.
     - If HEAD wraps code in a new structure (e.g. try block, tracking set), keep the wrapper and merge incoming changes into it.
     - If both sides modify the same line, prefer the version with more functionality unless it's clearly a bug fix superseding old code.
     - Watch for duplicate imports after resolution — dedup them.
   - Stage resolved files with `git add` and continue with `git rebase --continue`.
6. After rebase completes, verify:
   - `pnpm install` (new upstream packages may need installing)
   - `pnpm -r build` passes (check for duplicate imports, missing exports, type errors).
   - `pnpm test` passes.
   - Fix any issues found (duplicate imports, missing re-exports, etc.).
7. Report summary: how many commits replayed, how many conflicts resolved, any commits dropped as already upstream.
8. After successful rebase, run `/unmerged-prs` to check if any PR commits need cherry-picking onto the rebased branch.

## Common conflict patterns in this repo

### registry.ts (adapter registry)
Upstream adds new adapters (gemini, hermes, etc.), sam adds imports like `listClaudeModels`. Resolution: keep both sets of imports and adapter registrations. Watch for duplicate imports.

### app.ts (Express app setup)
Upstream has a large plugin system setup (pluginRoutes, workerManager, eventBus, etc.). Sam adds routes like `fsRoutes()`. Resolution: keep HEAD's plugin setup block, add sam's routes (`api.use(fsRoutes())`) alongside them. Two conflict zones: imports and route mounting.

### AgentDetail.tsx (run detail page)
Upstream uses `RunTranscriptView` component from `ui/src/components/transcript/RunTranscriptView.tsx` instead of inline transcript rendering. Sam's terminal chrome (border, header bar, collapsible pane) wraps the transcript. Resolution: keep sam's terminal chrome wrapper but use `RunTranscriptView` inside it instead of inline `.map()` rendering. Also keep upstream's `redactHomePathUserSegments` calls and `transcriptMode` state.

### Adapter execute.ts files (claude-local, codex-local, cursor-local, opencode-local, pi-local)
- Upstream has `joinPromptSections()` for building prompts, `bootstrapPromptTemplate`, `sessionHandoffNote`, and `promptMetrics` tracking.
- Sam adds `buildWakeContextSuffix(context, env)` appended to the prompt, and `PAPERCLIP_FOCUSED_TASK_MODE` env injection.
- Resolution: keep HEAD's `joinPromptSections([...])` structure, append `+ buildWakeContextSuffix(context, env)` after it. Add `PAPERCLIP_FOCUSED_TASK_MODE` env logic into the `if (wakeTaskId)` block.
- **Duplicate imports**: cherry-picks often produce duplicate `buildWakeContextSuffix` in the import block. Always dedup.

### heartbeat.ts (executeRun)
Upstream wraps the body in `activeRunExecutions.add(run.id)` + try block, has `appendRunEvent` lifecycle events, and uses `redactCurrentUserText`. Sam adds `focusedTaskMode`, `wakeupType`/`parseRouterMetrics`, and runtime service intents.
- Resolution: keep HEAD's structure (try block, redactCurrentUserText, appendRunEvent), merge sam's additions:
  - Add `parseRouterMetrics(stdoutExcerpt)` + `wakeupType` before the main `setRunStatus` call
  - Add `wakeupType` to the `setRunStatus` field list
  - Add `focusedTaskMode` context assignment near projectId assignment
  - Add `runtimeServiceIntents` context from HEAD's workspace config

### server-utils.ts (adapter-utils)
Upstream has `joinPromptSections`, `buildPaperclipEnv`, `redactEnvForLogs`, `stripParentCliEnv`. Sam adds `buildWakeContextSuffix(context, env)` (with env param for API URL injection, agent identity, task summary).
- If both add `buildWakeContextSuffix`, keep the 2-arg version `(context, env)` which includes API URL and identity injection.
- Keep `joinPromptSections` — it's used by all adapters upstream.

### index.ts (server entry)
Upstream has full shutdown handler (`SIGINT`/`SIGTERM`), trusted origins (`deriveAuthTrustedOrigins`), plugin dev watcher, and `.unref()` on timers. If sam commits touch this, take HEAD — upstream's version is comprehensive.

### DB migrations
Upstream's latest migration index determines the starting number for sam's migrations. Currently upstream is at 0029. Sam's migrations must be renumbered to 0030+.
- Rename SQL files: `git mv 0026_foo.sql 0030_foo.sql`
- Rename snapshot files: `git mv meta/0026_snapshot.json meta/0030_snapshot.json`
- Update `meta/_journal.json`: change `idx` and `tag` to match new numbers
- **Critical**: don't overwrite upstream's snapshots when renaming — upstream 0028/0029 snapshots must stay.

### IssuesList.tsx
Upstream extracted shared `IssueRow` component, added "Me"/"Unassigned" assignee filters, user-assignee support. Sam adds project column/group-by-project. Resolution: keep HEAD's `IssueRow` usage and assignee filters, add sam's project column within the new row structure.

### OnboardingWizard.tsx
Upstream has clickable tab navigation, adapter recommendations, animation. Sam adds pipeline routing step 5. Resolution: extend HEAD's tab array with step 5 entry, add step 5 content JSX.

### sidebar-badges.ts
`badges.inbox = explicit_sum` (HEAD) vs `badges.inbox += partial_sum` (sam). The explicit sum version is correct when all terms are enumerated. Add any new sam terms (like `staleIssueCount`) to the explicit sum.

### Company type test mocks
When `DashboardSummary` or `Company` shared types gain new required fields, test mocks will fail typecheck. Add missing fields with sensible defaults.

## After rebase: always verify

```bash
pnpm install
pnpm -r build
pnpm test
```

Fix any issues before pushing. Common post-rebase failures:
1. Duplicate imports (buildWakeContextSuffix, joinPromptSections) in adapter execute.ts files
2. Missing new type fields in test mocks (DashboardSummary.staleTasks, routerWakeupEfficiency)
3. Duplicate function implementations (e.g. two handleLaunch in OnboardingWizard)
4. DB migration number collisions — renumber sam's to follow upstream's latest
5. Accidentally committed worktrees/codemaps — `git rm -r --cached` to clean
