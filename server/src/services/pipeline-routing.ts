import path from "node:path";
import fs from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companies, principalPermissionGrants } from "@paperclipai/db";

import { fileURLToPath } from "node:url";

// Resolve the agents/ directory relative to this file's location (server/src/services/).
// Falls back to PIPELINE_AGENTS_DIR env var for Docker deployments.
const _thisDir = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR =
  process.env.PIPELINE_AGENTS_DIR ??
  path.resolve(_thisDir, "../../../agents"); // server/src/services/ → repo root

async function readAgentInstructions(agentDirName: string): Promise<string> {
  const filePath = path.join(AGENTS_DIR, agentDirName, "AGENTS.md");
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    console.warn(`[pipeline-routing] AGENTS.md not found at ${filePath} — agent will be seeded with empty instructions`);
    return "";
  }
}

const SPECIALIST_CONFIGS = [
  { name: "Brainstorm Agent", dirName: "brainstorm-agent", role: "researcher" },
  { name: "Plan Agent",       dirName: "plan-agent",       role: "pm" },
  { name: "Frontend Developer", dirName: "frontend-developer", role: "engineer" },
  { name: "Backend Architect",  dirName: "backend-architect",  role: "engineer" },
  { name: "Senior Developer",   dirName: "senior-developer",   role: "engineer" },
  { name: "Security Engineer",  dirName: "security-engineer",  role: "devops" },
  { name: "DevOps Automator",   dirName: "devops-automator",   role: "devops" },
] as const;

// db-compatible query helper: accepts the outer db or a transaction handle
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export function pipelineRoutingService(db: Db) {
  async function findAgentByRole(tx: DbOrTx, companyId: string, role: string) {
    const results = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.role, role)));
    return results[0] ?? null;
  }

  async function findAgentByName(tx: DbOrTx, companyId: string, name: string) {
    const results = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.name, name)));
    return results[0] ?? null;
  }

  return {
    async enable(companyId: string) {
      const taskRouterInstructions = await readAgentInstructions("task-router");
      const specialistInstructions = await Promise.all(
        SPECIALIST_CONFIGS.map((s) => readAgentInstructions(s.dirName))
      );

      return await db.transaction(async (tx) => {
        // Upsert TaskRouter (match by role = task_router, unique per company)
        let taskRouter = await findAgentByRole(tx, companyId, "task_router");
        if (!taskRouter) {
          const [created] = await tx
            .insert(agents)
            .values({
              companyId,
              name: "TaskRouter",
              role: "task_router",
              isSystem: true,
              adapterType: "claude_local",
              adapterConfig: {
                instructions: taskRouterInstructions,
                heartbeat: {
                  enabled: true,
                  intervalSec: 60,
                  wakeOnDemand: true,
                  maxConcurrentRuns: 5,
                },
                maxTurnsPerRun: 200,
                dangerouslySkipPermissions: true,
              },
              permissions: {},
            })
            .returning();
          taskRouter = created!;
        } else {
          // Re-enable if previously disabled: restore isSystem
          await tx
            .update(agents)
            .set({ isSystem: true })
            .where(eq(agents.id, taskRouter.id));
        }

        // Grant tasks:assign to TaskRouter
        await tx
          .insert(principalPermissionGrants)
          .values({
            companyId,
            principalType: "agent",
            principalId: taskRouter.id,
            permissionKey: "tasks:assign",
          })
          .onConflictDoNothing();

        // Upsert specialists (match by name scoped to company)
        const specialistIds: string[] = [];
        for (let i = 0; i < SPECIALIST_CONFIGS.length; i++) {
          const cfg = SPECIALIST_CONFIGS[i]!;
          let specialist = await findAgentByName(tx, companyId, cfg.name);
          if (!specialist) {
            const [created] = await tx
              .insert(agents)
              .values({
                companyId,
                name: cfg.name,
                role: cfg.role,
                isSystem: false,
                adapterType: "claude_local",
                adapterConfig: {
                  instructions: specialistInstructions[i],
                  heartbeat: { enabled: false, wakeOnDemand: true },
                  maxTurnsPerRun: 200,
                  dangerouslySkipPermissions: true,
                },
                permissions: {},
              })
              .returning();
            specialist = created!;
          }
          specialistIds.push(specialist.id);
        }

        // Set flag
        await tx
          .update(companies)
          .set({ pipelineRoutingEnabled: true })
          .where(eq(companies.id, companyId));

        return { taskRouterId: taskRouter.id, specialistIds };
      });
    },

    async disable(companyId: string) {
      await db.transaction(async (tx) => {
        const taskRouter = await findAgentByRole(tx, companyId, "task_router");
        await tx
          .update(companies)
          .set({ pipelineRoutingEnabled: false })
          .where(eq(companies.id, companyId));

        if (taskRouter) {
          // Unprotect and stop heartbeat
          await tx
            .update(agents)
            .set({
              isSystem: false,
              adapterConfig: {
                ...(taskRouter.adapterConfig as Record<string, unknown>),
                heartbeat: {
                  ...((taskRouter.adapterConfig as Record<string, unknown>)?.heartbeat as Record<string, unknown>),
                  enabled: false,
                },
              },
            })
            .where(eq(agents.id, taskRouter.id));
        }
      });
    },

    async skipOnboarding(companyId: string) {
      await db
        .update(companies)
        .set({ pipelineRoutingOnboardingSkipped: true })
        .where(eq(companies.id, companyId));
    },
  };
}
