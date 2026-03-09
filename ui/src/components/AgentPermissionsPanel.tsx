import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "../api/agents";
import { ToggleField } from "./agent-config-primitives";

const PERMISSION_LABELS: Record<string, string> = {
  "agents:create": "Create Agents",
  "users:invite": "Invite Users",
  "users:manage_permissions": "Manage User Permissions",
  "tasks:assign": "Assign Tasks",
  "tasks:assign_scope": "Assign Task Scope",
  "joins:approve": "Approve Join Requests",
};

const PERMISSION_GROUPS: Array<{ group: string; keys: string[] }> = [
  { group: "Tasks", keys: ["tasks:assign", "tasks:assign_scope"] },
  { group: "Agents", keys: ["agents:create"] },
  { group: "Users", keys: ["users:invite", "users:manage_permissions"] },
  { group: "Joins", keys: ["joins:approve"] },
];

interface AgentPermissionsPanelProps {
  agentId: string;
  companyId: string | undefined;
}

export function AgentPermissionsPanel({ agentId, companyId }: AgentPermissionsPanelProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["agent-permissions", agentId],
    queryFn: () => agentsApi.getPermissions(agentId, companyId),
  });

  const grantedKeys = new Set(data?.grantedKeys ?? []);

  const mutation = useMutation({
    mutationFn: (vars: { grant?: string[]; revoke?: string[] }) =>
      agentsApi.updatePermissions(agentId, vars, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-permissions", agentId] });
    },
  });

  const toggle = (key: string, currentlyGranted: boolean) => {
    if (currentlyGranted) {
      mutation.mutate({ revoke: [key] });
    } else {
      mutation.mutate({ grant: [key] });
    }
  };

  if (isLoading) return null;

  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map(({ group, keys }) => (
        <div key={group}>
          <p className="text-xs font-medium text-muted-foreground mb-2">{group}</p>
          <div className="space-y-3">
            {keys.map((key) => {
              const granted = grantedKeys.has(key);
              return (
                <div key={key} style={{ opacity: mutation.isPending ? 0.6 : 1 }}>
                  <ToggleField
                    label={PERMISSION_LABELS[key] ?? key}
                    checked={granted}
                    onChange={() => toggle(key, granted)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
