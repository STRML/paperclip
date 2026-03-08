# Frontend Codemap
_Updated: 2026-03-05_

## Stack
React 18 + React Router + TanStack Query + Vite. UI components: shadcn/ui (Radix primitives + Tailwind CSS).

Entry: `ui/src/main.tsx` → `App.tsx`

## Route Structure

```
/auth                         - Login page (authenticated mode)
/board-claim/:token           - Board claim flow
/invite/:token                - Invite landing

<CloudAccessGate>             - Checks health + session before rendering
  /                           - CompanyRootRedirect → /:prefix/dashboard
  /:companyPrefix/            - Layout (sidebar + breadcrumb)
    dashboard
    companies
    company/settings
    org                       - OrgChart
    agents/all|active|paused|error
    agents/:agentId[/:tab[/runs/:runId]]
    projects
    projects/:projectId[/overview|/issues[/:filter]]
    issues[/:issueId]
    goals[/:goalId]
    approvals/pending|all[/:approvalId]
    costs
    activity
    inbox/new|all
```

## Pages (`ui/src/pages/`)
| Page | Purpose |
|------|---------|
| Dashboard | Aggregated company stats, active agents panel |
| Agents / AgentDetail | Agent list, detail with runs/config tabs |
| Projects / ProjectDetail | Project list + kanban/issue views |
| Issues / IssueDetail | Issue list + detail panel |
| Goals / GoalDetail | Goal tree + detail |
| Approvals / ApprovalDetail | Board approval queue |
| Costs | Token spend tracking |
| Activity | Activity log feed |
| Inbox | Unread approvals/mentions |
| OrgChart | Visual org chart |
| CompanySettings | Company config |
| Auth / BoardClaim / InviteLanding | Auth flows |

## Key Components (`ui/src/components/`)
- `Layout.tsx` - Main shell (sidebar + breadcrumb + outlet)
- `Sidebar.tsx` + `SidebarAgents/Projects/NavItem/Section` - Navigation rail
- `KanbanBoard.tsx` - Drag-and-drop issue board
- `GoalTree.tsx` - Hierarchical goal display
- `AgentConfigForm.tsx` - Agent creation/edit form
- `ApprovalCard.tsx` / `ApprovalPayload.tsx` - Approval review UI
- `LiveRunWidget.tsx` - Real-time agent run display
- `CommandPalette.tsx` - Keyboard-driven command search
- `OnboardingWizard.tsx` - First-run company creation
- `PropertiesPanel.tsx` - Slide-in detail panel
- `MarkdownEditor.tsx` / `MarkdownBody.tsx` - Rich text editing/rendering
- `CompanyRail.tsx` / `CompanySwitcher.tsx` - Multi-company navigation
- `FilterBar.tsx` - Issue/agent filtering

## API Layer (`ui/src/api/`)
One module per resource, thin wrappers over fetch. All use `api/client.ts` base client.
Modules: access, activity, agents, approvals, assets, auth, companies, costs, dashboard, goals, health, heartbeats, issues, projects, secrets, sidebarBadges.

## Context Providers (`ui/src/context/`)
| Provider | Purpose |
|----------|---------|
| CompanyContext | Selected company + company list |
| DialogContext | Onboarding wizard open state |
| LiveUpdatesProvider | WebSocket connection, invalidates React Query caches |
| BreadcrumbContext | Dynamic breadcrumb state |
| PanelContext | Slide-in panel open/close |
| SidebarContext | Sidebar collapse state |
| ThemeContext | Light/dark theme |
| ToastContext | Toast notification queue |

## Adapter System (`ui/src/adapters/`)
Client-side adapter registry mirrors server adapters. Used for agent config form rendering per adapter type.
Types: claude-local, codex-local, http, openclaw, process.

## State Management
- Server state: TanStack Query (all data fetching + mutations)
- Query keys centralized in `lib/queryKeys.ts`
- Real-time invalidation: `LiveUpdatesProvider` listens to WebSocket events and calls `queryClient.invalidateQueries()`
- Local UI state: React useState / context
