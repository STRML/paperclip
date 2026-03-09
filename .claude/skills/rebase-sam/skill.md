---
name: rebase-sam
description: >
  Rebase the sam branch onto the latest origin/master, resolving conflicts
  along the way. Use when you need to sync sam with upstream changes.
user_invocable: true
---

# Rebase Sam Skill

Rebase the `sam` branch onto the latest `origin/master`.

## Steps

1. Ensure we're on the `sam` branch: `git checkout sam` if needed.
2. Fetch latest master: `git fetch origin master`.
3. Start the rebase: `git rebase origin/master`.
4. If conflicts occur, resolve them:
   - For each conflicted file, read the conflict markers and determine the correct resolution.
   - **General conflict resolution principles:**
     - If HEAD (sam) adds a feature and incoming adds a different feature, keep both.
     - If HEAD wraps code in a new structure (e.g. try block, tracking set), keep the wrapper and merge incoming changes into it.
     - If both sides modify the same line, prefer the version with more functionality unless it's clearly a bug fix superseding old code.
     - Watch for duplicate imports after resolution — dedup them.
   - Stage resolved files with `git add` and continue with `git rebase --continue`.
5. After rebase completes, verify:
   - `pnpm -r build` passes (check for duplicate imports, missing exports, type errors).
   - `pnpm test` passes.
   - Fix any issues found (duplicate imports, missing re-exports, etc.).
6. Report summary: how many commits replayed, how many conflicts resolved, any commits dropped as already upstream.
7. After successful rebase, run `/unmerged-prs` to check if any PR commits need cherry-picking onto the rebased branch.

## Common conflict patterns in this repo

- **heartbeat.ts `executeRun`**: sam wraps the body in `activeRunExecutions.add(run.id)` + try block. Incoming commits often have the code without that wrapper. Resolution: keep `activeRunExecutions.add(run.id)`, then merge incoming additions (new fields, enrichments) into the indented try block below.
- **adapter execute.ts files**: `buildWakeContextSuffix(context)` vs `buildWakeContextSuffix(context, env)` — take the two-arg version.
- **Duplicate imports**: cherry-picks and rebases often produce duplicate named imports (e.g. `buildWakeContextSuffix` twice). Always dedup after resolution.
- **sidebar-badges.ts**: `badges.inbox = explicit_sum` vs `badges.inbox += partial_sum` — the `+=` version is correct when the service already computes the base count.
