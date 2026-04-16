import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALL_SUPPORTED_AGENTS,
  detectAvailableAgents,
  toDisplayName,
  toSkillDir,
} from "../src/utils/detect-agents.js";

describe("ALL_SUPPORTED_AGENTS", () => {
  it("includes every supported agent", () => {
    expect(ALL_SUPPORTED_AGENTS).toEqual([
      "claude",
      "codex",
      "copilot",
      "gemini",
      "cursor",
      "opencode",
      "droid",
      "pi",
    ]);
  });
});

describe("toDisplayName", () => {
  it("returns the human-readable name for each supported agent", () => {
    expect(toDisplayName("claude")).toBe("Claude Code");
    expect(toDisplayName("copilot")).toBe("GitHub Copilot");
    expect(toDisplayName("droid")).toBe("Factory Droid");
  });
});

describe("toSkillDir", () => {
  it("returns the agent's skill directory path", () => {
    expect(toSkillDir("claude")).toBe(".claude/skills");
    expect(toSkillDir("copilot")).toBe(".github/copilot/skills");
    expect(toSkillDir("opencode")).toBe(".opencode/skills");
  });
});

describe("detectAvailableAgents", () => {
  let fakeBinDirectory: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    fakeBinDirectory = mkdtempSync(path.join(tmpdir(), "react-doctor-detect-"));
    originalPath = process.env.PATH;
    process.env.PATH = fakeBinDirectory;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    rmSync(fakeBinDirectory, { recursive: true, force: true });
  });

  const writeExecutable = (binaryName: string): void => {
    const binaryPath = path.join(fakeBinDirectory, binaryName);
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binaryPath, 0o755);
  };

  it("returns an empty list when no agent binaries are on PATH", () => {
    expect(detectAvailableAgents()).toEqual([]);
  });

  it("detects agents that have an executable on PATH", () => {
    writeExecutable("claude");
    writeExecutable("opencode");
    expect(detectAvailableAgents()).toEqual(["claude", "opencode"]);
  });

  it("detects an agent when any of its binary aliases is present", () => {
    writeExecutable("omegon");
    expect(detectAvailableAgents()).toEqual(["pi"]);
  });

  it("ignores non-executable files with matching names", () => {
    const nonExecutablePath = path.join(fakeBinDirectory, "claude");
    writeFileSync(nonExecutablePath, "not executable");
    chmodSync(nonExecutablePath, 0o644);
    expect(detectAvailableAgents()).toEqual([]);
  });

  it("ignores directories with matching names", () => {
    mkdirSync(path.join(fakeBinDirectory, "claude"));
    expect(detectAvailableAgents()).toEqual([]);
  });
});
