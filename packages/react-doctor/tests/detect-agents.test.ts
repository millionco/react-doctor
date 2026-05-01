import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
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
  it("uses .agents/skills for agents that support the standard", () => {
    expect(toSkillDir("codex")).toBe(".agents/skills");
    expect(toSkillDir("copilot")).toBe(".agents/skills");
    expect(toSkillDir("gemini")).toBe(".agents/skills");
    expect(toSkillDir("cursor")).toBe(".agents/skills");
    expect(toSkillDir("opencode")).toBe(".agents/skills");
    expect(toSkillDir("pi")).toBe(".agents/skills");
  });

  it("uses vendor-specific paths for agents without .agents/skills support", () => {
    expect(toSkillDir("claude")).toBe(".claude/skills");
    expect(toSkillDir("droid")).toBe(".factory/skills");
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
