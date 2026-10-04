import { describe, expect, it } from "vite-plus/test";
import type { InspectFlags } from "../src/cli/utils/inspect-flags.js";
import { type ShouldUseTuiInput, shouldUseTui } from "../src/cli/utils/should-use-tui.js";

const makeInput = (overrides: Partial<ShouldUseTuiInput> = {}): ShouldUseTuiInput => ({
  flags: {},
  isNonInteractiveEnvironment: false,
  nodeMajorVersion: 22,
  outputIsTty: true,
  stdinIsTty: true,
  supportsRawMode: true,
  terminalName: "xterm-256color",
  ...overrides,
});

describe("shouldUseTui", () => {
  it("uses the TUI for a supported interactive terminal", () => {
    expect(shouldUseTui(makeInput())).toBe(true);
  });

  it.each([
    ["non-interactive environment", { isNonInteractiveEnvironment: true }],
    ["stdin without a TTY", { stdinIsTty: false }],
    ["output without a TTY", { outputIsTty: false }],
    ["stdin without raw mode", { supportsRawMode: false }],
    ["Node 21", { nodeMajorVersion: 21 }],
    ["dumb terminal", { terminalName: "dumb" }],
  ])("uses headless output in a %s", (_name, overrides) => {
    expect(shouldUseTui(makeInput(overrides))).toBe(false);
  });

  it.each([
    ["score-only output", { score: true }],
    ["JSON output", { json: true }],
    ["compact JSON output", { jsonCompact: true }],
    ["JSON output file", { jsonOut: "report.json" }],
    ["staged scope", { staged: true }],
    ["changed-file input", { changedFilesFrom: "files.txt" }],
  ])("uses headless output for %s", (_name, flags: InspectFlags) => {
    expect(shouldUseTui(makeInput({ flags }))).toBe(false);
  });

  it("keeps supported scan controls in the TUI", () => {
    const flags: InspectFlags = {
      blocking: "warning",
      base: "main",
      category: "Security",
      deadCode: false,
      debug: true,
      diff: false,
      failOn: "warning",
      lint: false,
      maxDuration: "30",
      outputDir: "diagnostics",
      parallel: false,
      project: "app",
      respectInlineDisables: false,
      score: false,
      scope: "full",
      supplyChain: false,
      telemetry: false,
      warnings: false,
      yes: true,
    };

    expect(shouldUseTui(makeInput({ flags }))).toBe(true);
  });

  it("keeps verbose output in the TUI", () => {
    expect(shouldUseTui(makeInput({ flags: { verbose: true } }))).toBe(true);
  });

  it.each([
    ["changed scope", { scope: "changed" }],
    ["untracked files", { scope: "files", includeUntracked: true }],
    ["deprecated diff scope", { diff: true }],
  ])("keeps %s in the TUI", (_name, flags: InspectFlags) => {
    expect(shouldUseTui(makeInput({ flags }))).toBe(true);
  });

  it("does not let project config change an interactive renderer", () => {
    expect(shouldUseTui(makeInput())).toBe(true);
  });
});
