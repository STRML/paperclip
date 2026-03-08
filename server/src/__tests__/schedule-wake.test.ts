import { describe, expect, it } from "vitest";
import { scheduleIssueWakeSchema } from "@paperclipai/shared";

describe("scheduleIssueWakeSchema", () => {
  it("accepts a valid delay in range", () => {
    const result = scheduleIssueWakeSchema.safeParse({ delayMs: 600_000 });
    expect(result.success).toBe(true);
    expect(result.data?.delayMs).toBe(600_000);
  });

  it("accepts minimum delay (10 seconds)", () => {
    const result = scheduleIssueWakeSchema.safeParse({ delayMs: 10_000 });
    expect(result.success).toBe(true);
  });

  it("accepts maximum delay (24 hours)", () => {
    const result = scheduleIssueWakeSchema.safeParse({ delayMs: 86_400_000 });
    expect(result.success).toBe(true);
  });

  it("rejects delay below minimum", () => {
    const result = scheduleIssueWakeSchema.safeParse({ delayMs: 5_000 });
    expect(result.success).toBe(false);
  });

  it("rejects delay above maximum", () => {
    const result = scheduleIssueWakeSchema.safeParse({ delayMs: 86_400_001 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer delay", () => {
    const result = scheduleIssueWakeSchema.safeParse({ delayMs: 10_000.5 });
    expect(result.success).toBe(false);
  });

  it("rejects missing delayMs", () => {
    const result = scheduleIssueWakeSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts optional reason", () => {
    const result = scheduleIssueWakeSchema.safeParse({
      delayMs: 60_000,
      reason: "pr_review_check",
    });
    expect(result.success).toBe(true);
    expect(result.data?.reason).toBe("pr_review_check");
  });

  it("accepts null reason", () => {
    const result = scheduleIssueWakeSchema.safeParse({
      delayMs: 60_000,
      reason: null,
    });
    expect(result.success).toBe(true);
    expect(result.data?.reason).toBeNull();
  });

  it("accepts absent reason", () => {
    const result = scheduleIssueWakeSchema.safeParse({ delayMs: 60_000 });
    expect(result.success).toBe(true);
    expect(result.data?.reason).toBeUndefined();
  });
});
