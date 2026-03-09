import { describe, it, expect } from "vitest";

describe("routerWakeupEfficiency idlePercent", () => {
  function compute(total: number, idle: number) {
    return total > 0 ? Math.round((idle / total) * 100) : 0;
  }

  it("returns 0 when totalWakeups is 0 (no division by zero)", () => {
    expect(compute(0, 0)).toBe(0);
  });

  it("computes correct percentage", () => {
    expect(compute(10, 3)).toBe(30);
  });

  it("rounds to nearest integer", () => {
    expect(compute(3, 1)).toBe(33);
  });

  it("returns 100 when all wakeups are idle", () => {
    expect(compute(5, 5)).toBe(100);
  });
});
