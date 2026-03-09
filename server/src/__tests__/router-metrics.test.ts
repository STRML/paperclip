import { describe, it, expect } from "vitest";
import { parseRouterMetrics } from "../services/heartbeat.js";

describe("parseRouterMetrics", () => {
  it("returns null for empty string", () => {
    expect(parseRouterMetrics("")).toBeNull();
  });

  it("returns null when marker absent", () => {
    expect(parseRouterMetrics("some output\nno marker here")).toBeNull();
  });

  it("parses wakeupType from PAPERCLIP_METRICS line", () => {
    const stdout = 'Done.\n\nPAPERCLIP_METRICS: {"wakeupType":"idle","issueId":"abc"}\n';
    expect(parseRouterMetrics(stdout)?.wakeupType).toBe("idle");
  });

  it("picks the last PAPERCLIP_METRICS line if multiple", () => {
    const stdout =
      'PAPERCLIP_METRICS: {"wakeupType":"productive"}\nmore output\nPAPERCLIP_METRICS: {"wakeupType":"idle"}\n';
    expect(parseRouterMetrics(stdout)?.wakeupType).toBe("idle");
  });

  it("returns null for malformed JSON", () => {
    expect(parseRouterMetrics("PAPERCLIP_METRICS: not-json\n")).toBeNull();
  });

  it("returns null for wakeupType outside allowed set", () => {
    expect(parseRouterMetrics('PAPERCLIP_METRICS: {"wakeupType":"bad_value"}\n')).toBeNull();
  });

  it("accepts all valid wakeupType values", () => {
    for (const type of ["idle", "productive", "initial"]) {
      const stdout = `PAPERCLIP_METRICS: {"wakeupType":"${type}"}\n`;
      expect(parseRouterMetrics(stdout)?.wakeupType).toBe(type);
    }
  });
});
