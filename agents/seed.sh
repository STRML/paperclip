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
