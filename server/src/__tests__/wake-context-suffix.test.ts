import { describe, expect, it } from "vitest";
import { buildWakeContextSuffix } from "../adapters/utils.js";

describe("buildWakeContextSuffix", () => {
  it("returns empty string when no task or reason", () => {
    expect(buildWakeContextSuffix({}, {})).toBe("");
  });

  it("includes task_id and wake_reason", () => {
    const result = buildWakeContextSuffix(
      { taskId: "task-123", wakeReason: "issue_comment_mentioned" },
      {},
    );
    expect(result).toContain("task_id: task-123");
    expect(result).toContain("wake_reason: issue_comment_mentioned");
  });

  it("includes api_url from env", () => {
    const result = buildWakeContextSuffix(
      { taskId: "task-123" },
      { PAPERCLIP_API_URL: "http://localhost:3100" },
    );
    expect(result).toContain("api_url: http://localhost:3100");
  });

  it("includes agent identity when present", () => {
    const result = buildWakeContextSuffix(
      {
        taskId: "task-123",
        agentIdentity: { name: "CEO", role: "ceo", title: "Chief Executive" },
      },
      {},
    );
    expect(result).toContain("agent_name: CEO");
    expect(result).toContain("agent_role: ceo");
    expect(result).toContain("agent_title: Chief Executive");
  });

  it("includes task summary when present", () => {
    const result = buildWakeContextSuffix(
      {
        taskId: "task-123",
        taskSummary: {
          identifier: "RUS-47",
          title: "Review agent runs for brevity",
          status: "in_progress",
          description: "Fix slow startup",
        },
      },
      {},
    );
    expect(result).toContain("[Task summary]");
    expect(result).toContain("identifier: RUS-47");
    expect(result).toContain("title: Review agent runs for brevity");
    expect(result).toContain("status: in_progress");
    expect(result).toContain("description: Fix slow startup");
  });

  it("truncates long descriptions", () => {
    const longDesc = "x".repeat(600);
    const result = buildWakeContextSuffix(
      {
        taskId: "task-123",
        taskSummary: {
          identifier: "RUS-1",
          title: "Test",
          description: longDesc,
        },
      },
      {},
    );
    expect(result).toContain("description: " + "x".repeat(500) + "...");
  });

  it("falls back to issueId when taskId is missing", () => {
    const result = buildWakeContextSuffix(
      { issueId: "issue-456", wakeReason: "retry_failed_run" },
      {},
    );
    expect(result).toContain("task_id: issue-456");
  });

  it("includes wake_comment_id and approval fields", () => {
    const result = buildWakeContextSuffix(
      {
        taskId: "t-1",
        wakeCommentId: "comment-abc",
        approvalId: "appr-xyz",
        approvalStatus: "approved",
      },
      {},
    );
    expect(result).toContain("wake_comment_id: comment-abc");
    expect(result).toContain("approval_id: appr-xyz");
    expect(result).toContain("approval_status: approved");
  });

  it("includes linked_issue_ids", () => {
    const result = buildWakeContextSuffix(
      { taskId: "t-1", issueIds: ["id-1", "id-2"] },
      {},
    );
    expect(result).toContain("linked_issue_ids: id-1,id-2");
  });
});
