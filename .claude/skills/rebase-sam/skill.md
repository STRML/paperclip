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
  - **Critical**: When resolving heartbeat.ts conflicts, take the INCOMING version as-is. Do NOT try to merge HEAD (empty) with incoming (large block). The incoming version is the complete correct implementation; HEAD being empty means the content was restructured upstream. Taking the incoming version may produce a duplicate section — see post-rebase checks below.
  - **Post-rebase heartbeat.ts check**: After resolving, run `pnpm --filter @paperclipai/server typecheck`. If you see `'catch' or 'finally' expected` / `'try' expected` errors, there is a duplicate code block in the try body. Look for code at the wrong indentation level (6-space when it should be 8-space inside the try block). Remove the duplicate section and re-indent if needed. Also watch for a missing closing `}` for `if (finalizedRun)` before `} catch`.
- **adapter execute.ts files**: `buildWakeContextSuffix(context)` vs `buildWakeContextSuffix(context, env)` — take the two-arg version.
- **Duplicate imports**: cherry-picks and rebases often produce duplicate named imports (e.g. `buildWakeContextSuffix` twice). Always dedup after resolution.
- **sidebar-badges.ts**: `badges.inbox = explicit_sum` vs `badges.inbox += partial_sum` — the `+=` version is correct when the service already computes the base count.
- **IssuesList.tsx mobile layout conflicts**: Upstream made GitHub-style mobile row changes (adding `sm:hidden` time display, restructuring trailing content). Our commits add a project name column. Resolution: keep HEAD's mobile time display (`sm:hidden` spans) + keep HEAD's `</span></span>` closings for metadata/right-column, then add the project name `<FolderOpen>` span from the incoming version into the desktop trailing area. Remove any duplicate Live badge from the trailing area (upstream moved it to the metadata row). Check that the labels `</span>` and `)}` closing tags are present after the labels section — they're easy to miss.
- **Company type test mocks**: When the `Company` shared type gains new required fields (`pipelineRoutingEnabled`, `pipelineRoutingOnboardingSkipped`), test mocks in `cli/src/__tests__/` will fail typecheck. Add the missing fields with sensible defaults (`false`).

## After rebase: always verify

```bash
pnpm -r typecheck
pnpm test
```

Fix any issues before pushing. Common post-rebase failures:
1. Structural TS errors in heartbeat.ts (try/catch brace mismatch) — see above
2. Missing JSX closing tags in UI components from partial conflict resolutions
3. Test mocks missing new required type fields
