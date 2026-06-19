import { tmpdir } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  getCiPromptConfigPath,
  hasHandledCiPrompt,
  recordCiPromptDecision,
} from "../src/cli/utils/ci-prompt-decision.js";

describe("ci prompt decision state", () => {
  let configRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-ci-prompt-"));
    configRoot = root;
    cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("reports not-handled before the pitch is answered", () => {
    expect(hasHandledCiPrompt("/repo/a", { cwd: configRoot })).toBe(false);
  });

  it("persists a decline so the pitch never repeats for that repo", () => {
    expect(recordCiPromptDecision("/repo/a", "declined", { cwd: configRoot })).toBe(true);
    expect(hasHandledCiPrompt("/repo/a", { cwd: configRoot })).toBe(true);
  });

  it("treats an accept as handled too (no re-pitch if install didn't stick)", () => {
    recordCiPromptDecision("/repo/a", "accepted", { cwd: configRoot });
    expect(hasHandledCiPrompt("/repo/a", { cwd: configRoot })).toBe(true);
  });

  it("scopes the decision per repo", () => {
    recordCiPromptDecision("/repo/a", "declined", { cwd: configRoot });
    expect(hasHandledCiPrompt("/repo/a", { cwd: configRoot })).toBe(true);
    expect(hasHandledCiPrompt("/repo/b", { cwd: configRoot })).toBe(false);
  });

  it("stores the decision as a ci-pitch event in the shared react-doctor config file", () => {
    recordCiPromptDecision("/repo/a", "declined", { cwd: configRoot });
    const configPath = getCiPromptConfigPath({ cwd: configRoot });
    const stored = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const records = Object.values(stored.projects)
      .map(
        (project) =>
          (project as { events?: Record<string, { outcome?: string }> }).events?.["ci-pitch"],
      )
      .filter(Boolean);
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe("declined");
  });
});
