# Data Models Codemap
_Updated: 2026-03-05_

## Database
PostgreSQL via Drizzle ORM. Package: `packages/db/`. 24 migrations (0000–0023).

## Schema Tables

### Company & Identity
| Table | Key Columns | Notes |
|-------|-------------|-------|
| `companies` | id, name, issuePrefix, brandColor | issuePrefix is URL key (e.g. "ABC") |
| `company_memberships` | companyId, userId, role | Board user membership |
| `instance_user_roles` | userId, role | Instance-level admin roles |
| `principal_permission_grants` | principalId, principalType, resource, action | Fine-grained permissions |
| `invites` | companyId, email, token, role | Invite links |
| `join_requests` | companyId, userId | Pending join requests |

### Auth (better-auth managed)
| Table | Purpose |
|-------|---------|
| `auth_users` | User accounts |
| `auth_sessions` | Active sessions |
| `auth_accounts` | OAuth / credential accounts |
| `auth_verifications` | Email verification tokens |

### Agents
| Table | Key Columns | Notes |
|-------|-------------|-------|
| `agents` | id, companyId, name, role, title, icon, status, reportsTo, adapterType, adapterConfig, runtimeConfig, budgetMonthlyCents, spentMonthlyCents, permissions | Core agent record; self-referential `reportsTo` for org chart |
| `agent_api_keys` | agentId, keyHash | JWT signing keys |
| `agent_config_revisions` | agentId, config, createdAt | Config change history |
| `agent_runtime_state` | agentId, state | Current runtime metadata |
| `agent_task_sessions` | agentId, issueId, runId | Active task sessions |
| `agent_wakeup_requests` | agentId, requestedAt | Pending wakeup queue |

### Work Tracking
| Table | Key Columns | Notes |
|-------|-------------|-------|
| `projects` | id, companyId, name, color, archived | Work containers |
| `project_workspaces` | projectId, agentId, config | Agent workspace per project |
| `project_goals` | projectId, goalId | M:M project↔goal |
| `goals` | id, companyId, title, description, status, parentId | Hierarchical goal tree |
| `issues` | id, companyId, projectId, goalId, parentId, title, description, status, priority, assigneeAgentId, assigneeUserId, issueNumber, identifier, requestDepth | Core task/issue record; nested via parentId |
| `labels` | id, companyId, name, color | Issue labels |
| `issue_labels` | issueId, labelId | M:M |
| `issue_comments` | issueId, authorAgentId, authorUserId, body | Thread comments |
| `issue_attachments` | issueId, assetId | File attachments |
| `issue_approvals` | issueId, approvalId | Links issues to approvals |

### Approvals
| Table | Key Columns | Notes |
|-------|-------------|-------|
| `approvals` | id, companyId, agentId, issueId, type, payload, status | Board approval gate |
| `approval_comments` | approvalId, authorUserId, body | Review comments |

### Agent Execution
| Table | Key Columns | Notes |
|-------|-------------|-------|
| `heartbeat_runs` | id, agentId, issueId, status, startedAt, completedAt | One run per agent task execution |
| `heartbeat_run_events` | runId, type, payload, createdAt | Granular run event log |
| `cost_events` | id, agentId, companyId, issueId, runId, inputTokens, outputTokens, costCents | LLM token cost tracking |

### Assets & Secrets
| Table | Key Columns | Notes |
|-------|-------------|-------|
| `assets` | id, companyId, filename, mimeType, storageKey | File/asset storage |
| `company_secrets` | id, companyId, name, description | Secret definitions |
| `company_secret_versions` | secretId, encryptedValue, createdAt | Secret version history |
| `activity_log` | id, companyId, actorType, actorId, action, resource, resourceId | Audit trail |

## Key Relationships

```
companies
  └── agents (companyId, reportsTo → agents.id)
  └── projects (companyId)
      └── issues (projectId)
          └── issues (parentId - subtasks)
          └── issue_comments
          └── issue_attachments → assets
          └── heartbeat_runs (checkoutRunId, executionRunId)
  └── goals (companyId, parentId - tree)
      └── project_goals → projects
  └── approvals (companyId)
      └── approval_comments
  └── company_secrets → company_secret_versions
  └── cost_events → agents, issues, heartbeat_runs
  └── activity_log
```

## Shared Types (`packages/shared/src/types/`)
TypeScript types matching DB schema, shared across server, UI, and CLI:
access, activity, agent, approval, asset, company, company-portability, cost, dashboard, goal, heartbeat, issue, live, project, secrets, sidebar-badges.

## Config Schema (`packages/shared/src/config-schema.ts`)
Zod-validated YAML config at `~/.paperclip/instances/default/paperclip.yaml`:
- `llm` - provider + API key
- `database` - embedded-postgres or external postgres
- `logging` - file or cloud
- `server` - deploymentMode, exposure, host, port, allowedHostnames
- `auth` - baseUrlMode, publicBaseUrl
- `storage` - local_disk or s3
- `secrets` - local_encrypted or external
