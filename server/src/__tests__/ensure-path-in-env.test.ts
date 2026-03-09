import { describe, it, expect } from "vitest";
import { ensurePathInEnv, defaultPathForPlatform } from "@paperclipai/adapter-utils/server-utils";

describe("ensurePathInEnv", () => {
  it("augments a minimal PATH with default directories", () => {
    const env = { PATH: "/usr/bin:/bin" } as NodeJS.ProcessEnv;
    const result = ensurePathInEnv(env);
    expect(result.PATH).toContain("/usr/bin:/bin");
    expect(result.PATH).toContain("/usr/local/bin");
    expect(result.PATH).toContain("/opt/homebrew/bin");
  });

  it("does not duplicate directories already present", () => {
    const defaultPath = defaultPathForPlatform();
    const env = { PATH: defaultPath } as NodeJS.ProcessEnv;
    const result = ensurePathInEnv(env);
    // Should return the original env since all defaults are already present
    expect(result).toBe(env);
  });

  it("provides full default PATH when PATH is empty", () => {
    const env = { PATH: "" } as NodeJS.ProcessEnv;
    const result = ensurePathInEnv(env);
    expect(result.PATH).toContain("/usr/local/bin");
    expect(result.PATH).toContain("/opt/homebrew/bin");
  });

  it("provides full default PATH when PATH is missing", () => {
    const env = {} as NodeJS.ProcessEnv;
    const result = ensurePathInEnv(env);
    expect(result.PATH).toContain("/usr/local/bin");
    expect(result.PATH).toContain("/opt/homebrew/bin");
  });

  it("appends missing dirs to existing PATH without reordering", () => {
    const env = { PATH: "/custom/bin:/usr/bin" } as NodeJS.ProcessEnv;
    const result = ensurePathInEnv(env);
    // Original entries should come first
    expect(result.PATH!.startsWith("/custom/bin:/usr/bin:")).toBe(true);
    // Missing defaults should be appended
    expect(result.PATH).toContain("/usr/local/bin");
    expect(result.PATH).toContain("/opt/homebrew/bin");
  });

  it("includes $HOME/.local/bin when HOME is set", () => {
    const home = process.env.HOME;
    if (!home) return; // skip on systems without HOME
    const env = { PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    const result = ensurePathInEnv(env);
    expect(result.PATH).toContain(`${home}/.local/bin`);
  });
});
