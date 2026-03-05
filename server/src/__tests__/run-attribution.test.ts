import { describe, it, expect } from "vitest";
import { isRunForIssue } from "../routes/agents.js";

describe("isRunForIssue", () => {
  it("returns true when contextSnapshot.issueId matches the issue", () => {
    const run = { contextSnapshot: { issueId: "abc-123" } };
    expect(isRunForIssue(run, "abc-123")).toBe(true);
  });

  it("returns false when contextSnapshot.issueId is for a different issue", () => {
    const run = { contextSnapshot: { issueId: "other-issue-id" } };
    expect(isRunForIssue(run, "abc-123")).toBe(false);
  });

  it("returns false when contextSnapshot is null", () => {
    const run = { contextSnapshot: null };
    expect(isRunForIssue(run, "abc-123")).toBe(false);
  });

  it("returns false when contextSnapshot is missing issueId", () => {
    const run = { contextSnapshot: { taskId: "abc-123" } };
    expect(isRunForIssue(run, "abc-123")).toBe(false);
  });

  it("returns false when run is null", () => {
    expect(isRunForIssue(null, "abc-123")).toBe(false);
  });
});
