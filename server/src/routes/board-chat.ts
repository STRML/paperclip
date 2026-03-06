import { Router } from "express";
import { spawn } from "node:child_process";
import type { Db } from "@paperclipai/db";
import { assertBoard } from "./authz.js";
import { logger } from "../middleware/logger.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "/Users/user/.local/bin/claude";

const TOOL_CALL_OPEN = "<tool_call>";
const TOOL_CALL_CLOSE = "</tool_call>";
const TOOL_RESULT_OPEN = "<tool_result>";
const TOOL_RESULT_CLOSE = "</tool_result>";

interface DisplayMessage {
  role: "user" | "assistant" | "tool_call" | "tool_result";
  content?: string;
  method?: string;
  path?: string;
  body?: unknown;
  isError?: boolean;
}

function buildPrompt(
  userMessage: string,
  history: DisplayMessage[],
): string {
  const systemBlock = `You are a Paperclip board control agent. Paperclip is an AI company orchestration platform running on this server.

You can make REST API calls to control everything: companies, agents, tasks (issues), goals, projects, budgets, and governance.

To make an API call, output exactly this format (one per call):
${TOOL_CALL_OPEN}{"method":"GET","path":"/api/companies"}${TOOL_CALL_CLOSE}

For POST/PATCH, include a body:
${TOOL_CALL_OPEN}{"method":"POST","path":"/api/companies/abc/issues","body":{"title":"Fix bug","description":"Details here"}}${TOOL_CALL_CLOSE}

After each tool call block, STOP and wait. The system will execute the call and provide results in ${TOOL_RESULT_OPEN}...${TOOL_RESULT_CLOSE} blocks, then you continue.

Available endpoints:
- GET  /api/health → health check
- GET  /api/companies → list companies
- POST /api/companies → create company {name, mission}
- GET  /api/companies/:id/dashboard → company dashboard
- GET  /api/companies/:id/agents → list agents
- POST /api/companies/:id/agents → create agent
- PATCH /api/companies/:id/agents/:agentId → update agent
- POST /api/companies/:id/agents/:agentId/wakeup → trigger heartbeat
- POST /api/companies/:id/agents/:agentId/pause → pause agent
- POST /api/companies/:id/agents/:agentId/resume → resume agent
- GET  /api/companies/:id/agents/:agentId/runs → list runs
- GET  /api/companies/:id/issues → list issues/tasks
- POST /api/companies/:id/issues → create issue {title, description, assignee_id, project_id, goal_id}
- PATCH /api/companies/:id/issues/:issueId → update issue {status, comment, assignee_id}
- GET  /api/companies/:id/goals → list goals
- POST /api/companies/:id/goals → create goal {title, description, parent_id}
- GET  /api/companies/:id/projects → list projects
- POST /api/companies/:id/projects → create project {name, goal_id}
- GET  /api/companies/:id/costs → cost data

Always start by fetching /api/health then /api/companies. Be proactive — fetch data rather than asking the user. Format output clearly.`;

  let prompt = systemBlock + "\n\n";

  // Append conversation history
  for (const msg of history) {
    if (msg.role === "user") {
      prompt += `User: ${msg.content}\n\n`;
    } else if (msg.role === "assistant") {
      prompt += `Assistant: ${msg.content}\n\n`;
    } else if (msg.role === "tool_call") {
      prompt += `${TOOL_CALL_OPEN}{"method":"${msg.method}","path":"${msg.path}"${msg.body ? `,"body":${JSON.stringify(msg.body)}` : ""}}${TOOL_CALL_CLOSE}\n\n`;
    } else if (msg.role === "tool_result") {
      prompt += `${TOOL_RESULT_OPEN}${msg.content}${TOOL_RESULT_CLOSE}\n\n`;
    }
  }

  prompt += `User: ${userMessage}\n\nAssistant:`;
  return prompt;
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, ["-p", "--output-format", "text"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function parseToolCalls(
  text: string,
): { segments: Array<{ type: "text"; content: string } | { type: "tool_call"; method: string; path: string; body?: unknown }> } {
  const segments: Array<{ type: "text"; content: string } | { type: "tool_call"; method: string; path: string; body?: unknown }> = [];
  let remaining = text;

  while (remaining.length > 0) {
    const openIdx = remaining.indexOf(TOOL_CALL_OPEN);
    if (openIdx === -1) {
      const trimmed = remaining.trim();
      if (trimmed) segments.push({ type: "text", content: trimmed });
      break;
    }

    const before = remaining.slice(0, openIdx).trim();
    if (before) segments.push({ type: "text", content: before });

    const closeIdx = remaining.indexOf(TOOL_CALL_CLOSE, openIdx);
    if (closeIdx === -1) {
      const rest = remaining.slice(openIdx).trim();
      if (rest) segments.push({ type: "text", content: rest });
      break;
    }

    const jsonStr = remaining.slice(openIdx + TOOL_CALL_OPEN.length, closeIdx);
    try {
      const parsed = JSON.parse(jsonStr);
      segments.push({ type: "tool_call", method: parsed.method, path: parsed.path, body: parsed.body });
    } catch {
      segments.push({ type: "text", content: jsonStr });
    }

    remaining = remaining.slice(closeIdx + TOOL_CALL_CLOSE.length);
  }

  return { segments };
}

async function executeApiCall(
  method: string,
  path: string,
  body: unknown,
  port: number,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `http://127.0.0.1:${port}${path.startsWith("/") ? path : "/" + path}`;
  try {
    const opts: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    };
    if (body && (method === "POST" || method === "PATCH")) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { ok: res.ok, status: res.status, data: parsed };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: { error: message } };
  }
}

export function boardChatRoutes(_db: Db) {
  const router = Router();

  router.post("/board/chat", async (req, res, next) => {
    try {
      assertBoard(req);

      const { message, history } = req.body as {
        message: string;
        history?: DisplayMessage[];
      };

      if (!message?.trim()) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      const port = Number(process.env.PORT) || 3100;
      const displayMessages: DisplayMessage[] = [];
      const fullHistory: DisplayMessage[] = [...(history ?? [])];
      let maxTurns = 10;

      while (maxTurns-- > 0) {
        const prompt = buildPrompt(message, fullHistory);
        let claudeOutput: string;
        try {
          claudeOutput = await runClaude(prompt);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error({ err: errMsg }, "claude -p failed");
          displayMessages.push({ role: "assistant", content: `Error running claude: ${errMsg}` });
          break;
        }

        const { segments } = parseToolCalls(claudeOutput);
        const toolCalls = segments.filter((s) => s.type === "tool_call");

        // Add text segments as assistant messages
        for (const seg of segments) {
          if (seg.type === "text") {
            displayMessages.push({ role: "assistant", content: seg.content });
            fullHistory.push({ role: "assistant", content: seg.content });
          }
        }

        if (toolCalls.length === 0) break;

        // Execute tool calls
        for (const call of toolCalls) {
          if (call.type !== "tool_call") continue;

          displayMessages.push({ role: "tool_call", method: call.method, path: call.path, body: call.body });
          fullHistory.push({ role: "tool_call", method: call.method, path: call.path, body: call.body });

          const result = await executeApiCall(call.method, call.path, call.body, port);
          const resultText = JSON.stringify(result.data, null, 2);
          const isError = !result.ok;

          displayMessages.push({ role: "tool_result", content: resultText, isError });
          fullHistory.push({ role: "tool_result", content: resultText, isError });
        }
      }

      res.json({ messages: displayMessages });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
