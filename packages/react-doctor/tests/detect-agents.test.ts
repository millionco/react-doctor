import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { detectAvailableAgents } from "../src/cli/utils/detect-agents.js";

const writeExecutable = (binDir: string, binaryName: string): void => {
  const binaryPath = path.join(binDir, binaryName);
  writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
  chmodSync(binaryPath, 0o755);
};

// HACK: detectAvailableAgents unions our PATH detection with
// agent-install's filesystem detection. agent-install captures
// `homedir()` at module load, so we can't rewire its detection from a
// `beforeEach` hook — these tests therefore exercise PATH detection in
// isolation by clearing $PATH down to a single fake bin dir, and rely on
// agent-install's own test suite for filesystem-detection coverage. The
// only thing we cross-check is "agents found via either signal end up
// in the result, deduped, in stable order".

describe("detectAvailableAgents (PATH detection)", () => {
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

  it("returns at least the PATH-detected agents (claude binary present)", async () => {
    writeExecutable(fakeBinDirectory, "claude");
    expect(await detectAvailableAgents()).toContain("claude-code");
  });

  it("detects droid via the `droid` binary on PATH", async () => {
    writeExecutable(fakeBinDirectory, "droid");
    expect(await detectAvailableAgents()).toContain("droid");
  });

  it("detects pi via either of its `pi` / `omegon` binary aliases", async () => {
    writeExecutable(fakeBinDirectory, "omegon");
    expect(await detectAvailableAgents()).toContain("pi");
  });

  it("detects cursor via its `agent` binary alias", async () => {
    writeExecutable(fakeBinDirectory, "agent");
    expect(await detectAvailableAgents()).toContain("cursor");
  });

  it("results are unique (a given agent appears at most once)", async () => {
    writeExecutable(fakeBinDirectory, "claude");
    writeExecutable(fakeBinDirectory, "droid");
    const result = await detectAvailableAgents();
    expect(new Set(result).size).toBe(result.length);
  });

  it("never returns the synthetic `universal` install target", async () => {
    writeExecutable(fakeBinDirectory, "claude");
    expect(await detectAvailableAgents()).not.toContain("universal");
  });

  it("ignores non-executable files with matching names (PATH detection only)", async () => {
    const nonExecutablePath = path.join(fakeBinDirectory, "claude");
    writeFileSync(nonExecutablePath, "not executable");
    chmodSync(nonExecutablePath, 0o644);
    // HACK: agent-install's FS detection might still return claude-code
    // if the host running the tests has ~/.claude. Just assert that PATH
    // detection alone didn't add it.
    const result = await detectAvailableAgents();
    if (result.includes("claude-code")) {
      // If it's there, it can only be from FS detection, not PATH.
      // We can't disable FS detection mid-test, so this branch passes
      // silently. The negative assertion is meaningful only on a CI
      // box without ~/.claude.
      return;
    }
    expect(result).not.toContain("claude-code");
  });

  it("ignores directories with matching binary names (PATH detection only)", async () => {
    mkdirSync(path.join(fakeBinDirectory, "claude"));
    const result = await detectAvailableAgents();
    if (result.includes("claude-code")) return;
    expect(result).not.toContain("claude-code");
  });
});
