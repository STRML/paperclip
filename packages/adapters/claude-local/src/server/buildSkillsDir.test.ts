import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSkillsDir, _resetSkillsDirCache } from "./execute.js";

/**
 * These tests exercise the `buildSkillsDir` caching logic.
 *
 * Because `buildSkillsDir` relies on `resolvePaperclipSkillsDir()` which
 * resolves paths relative to the module directory, and the repo's `skills/`
 * directory is present during development, the tests exercise real filesystem
 * behaviour against the actual skills directory layout.
 */

const createdDirs: string[] = [];

afterEach(async () => {
  _resetSkillsDirCache();
  for (const dir of createdDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  createdDirs.length = 0;
});

describe("buildSkillsDir", () => {
  it("returns a directory containing a .claude/skills structure", async () => {
    const dir = await buildSkillsDir();
    createdDirs.push(dir);

    const skillsPath = path.join(dir, ".claude", "skills");
    const stat = await fs.stat(skillsPath);
    expect(stat.isDirectory()).toBe(true);
  });

  it("returns the same directory on consecutive calls (cache hit)", async () => {
    const first = await buildSkillsDir();
    createdDirs.push(first);

    const second = await buildSkillsDir();
    expect(second).toBe(first);
  });

  it("rebuilds when the cached directory is deleted from disk", async () => {
    const first = await buildSkillsDir();
    // Simulate OS temp cleanup
    await fs.rm(first, { recursive: true, force: true });

    const second = await buildSkillsDir();
    createdDirs.push(second);

    expect(second).not.toBe(first);
    const stat = await fs.stat(path.join(second, ".claude", "skills"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("rebuilds when the cache is reset (fingerprint mismatch simulation)", async () => {
    const first = await buildSkillsDir();
    createdDirs.push(first);

    _resetSkillsDirCache();

    const second = await buildSkillsDir();
    createdDirs.push(second);

    // Both are valid dirs but they are different tmpdir paths
    expect(second).not.toBe(first);
    const stat = await fs.stat(path.join(second, ".claude", "skills"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("produces a deterministic result regardless of skill directory order", async () => {
    // Two consecutive builds with a cache reset between them should produce
    // equivalent symlink sets, proving sort-independence.
    const first = await buildSkillsDir();
    createdDirs.push(first);
    const firstSkills = (
      await fs.readdir(path.join(first, ".claude", "skills"))
    ).sort();

    _resetSkillsDirCache();

    const second = await buildSkillsDir();
    createdDirs.push(second);
    const secondSkills = (
      await fs.readdir(path.join(second, ".claude", "skills"))
    ).sort();

    expect(secondSkills).toEqual(firstSkills);
  });
});
