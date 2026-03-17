#!/usr/bin/env bash
# Show unmerged commits from STRML/slab-nano open PRs not yet on the current branch.
# Usage: ./scripts/unmerged-prs.sh [--authors "user1,user2"] [--remote fork]
#
# Defaults: authors=STRML,slab-nano, remote=fork

set -euo pipefail

AUTHORS="STRML,slab-nano"
REMOTE="fork"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --authors) AUTHORS="$2"; shift 2 ;;
    --remote)  REMOTE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

IFS=',' read -ra AUTHOR_LIST <<< "$AUTHORS"

# Collect all open PRs for the given authors
pr_json="[]"
for author in "${AUTHOR_LIST[@]}"; do
  batch=$(gh pr list --state open --author "$author" --json number,title,headRefName --limit 100)
  pr_json=$(echo "$pr_json" "$batch" | jq -s '.[0] + .[1]')
done

count=$(echo "$pr_json" | jq length)
if [[ "$count" -eq 0 ]]; then
  echo "No open PRs found for authors: $AUTHORS"
  exit 0
fi

# Fetch all PR branches from remote
branches=$(echo "$pr_json" | jq -r '.[].headRefName' | sort -u)
echo "Fetching $count PR branches from $REMOTE..."
for b in $branches; do
  git fetch "$REMOTE" "$b" 2>/dev/null || true
done
echo ""

# Cache all commit subjects on the current branch for fast lookup
head_subjects=$(mktemp)
trap 'rm -f "$head_subjects"' EXIT
git log HEAD --format="%s" > "$head_subjects"

current_branch=$(git branch --show-current 2>/dev/null || echo "HEAD")

# Compare each PR's commits against HEAD
all_clean=true
for row in $(echo "$pr_json" | jq -r '.[] | @base64'); do
  number=$(echo "$row" | base64 -d | jq -r '.number')
  title=$(echo "$row" | base64 -d | jq -r '.title')
  branch=$(echo "$row" | base64 -d | jq -r '.headRefName')

  ref="$REMOTE/$branch"
  if ! git rev-parse "$ref" >/dev/null 2>&1; then
    echo "PR #$number ($branch): branch not found on $REMOTE — skipping"
    echo ""
    continue
  fi

  # Get PR commits not on origin/master (i.e. the PR's own commits)
  missing=""
  while IFS= read -r msg; do
    [[ -z "$msg" ]] && continue
    if ! grep -qFx "$msg" "$head_subjects"; then
      missing+="  $msg"$'\n'
    fi
  done < <(git log "$ref" --not origin/master --format="%s")

  if [[ -z "$missing" ]]; then
    echo "PR #$number — $title"
    echo "  ALL ON $current_branch"
  else
    all_clean=false
    echo "PR #$number — $title"
    echo "  MISSING:"
    printf "%s" "$missing"
  fi
  echo ""
done

if $all_clean; then
  echo "All PR commits are on the current branch."
fi
