---
name: unmerged-prs
description: >
  Check all open STRML and slab-nano PRs for commits not yet on the current
  branch. Run this after rebasing or cherry-picking to see what's still missing.
user_invocable: true
---

# Unmerged PRs Skill

Run `./scripts/unmerged-prs.sh` and present the results. This script:

1. Fetches all open PRs by STRML and slab-nano from GitHub
2. Fetches each PR branch from the `fork` remote
3. Compares PR commit messages against the current branch (HEAD)
4. Reports which commits are missing

## Steps

1. Run `./scripts/unmerged-prs.sh 2>&1 | cat` and present the output to the user.
2. Summarize: list PRs that are fully merged vs those with missing commits.
3. If the user wants to cherry-pick missing commits, identify the correct SHAs from the PR branches and cherry-pick them in order, resolving any conflicts.

## Options

The script accepts `--authors` and `--remote` flags:
- `--authors "user1,user2"` (default: `STRML,slab-nano`)
- `--remote fork` (default: `fork`)
