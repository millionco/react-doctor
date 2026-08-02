import { describe, expect, it } from "vite-plus/test";
import type { InspectFlags } from "../src/cli/utils/inspect-flags.js";
import { type ShouldUseTuiInput, shouldUseTui } from "../src/cli/utils/should-use-tui.js";

const makeInput = (overrides: Partial<ShouldUseTuiInput> = {}): ShouldUseTuiInput => ({
  flags: {},
  isNonInteractiveEnvironment: false,
  nodeMajorVersion: 22,
  stdinIsTty: true,
  stdoutIsTty: true,
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
    ["stdout without a TTY", { stdoutIsTty: false }],
    ["stdin without raw mode", { supportsRawMode: false }],
    ["Node 21", { nodeMajorVersion: 21 }],
    ["dumb terminal", { terminalName: "dumb" }],
  ])("uses the stable renderer in a %s", (_name, overrides) => {
    expect(shouldUseTui(makeInput(overrides))).toBe(false);
  });

  it.each([
    ["verbose output", { verbose: true }],
    ["diagnostic output directory", { outputDir: "diagnostics" }],
    ["score-only output", { score: true }],
    ["JSON output", { json: true }],
    ["compact JSON output", { jsonCompact: true }],
    ["JSON output file", { jsonOut: "report.json" }],
    ["staged scope", { staged: true }],
    ["explicit scope", { scope: "changed" }],
    ["base branch", { base: "main" }],
    ["untracked files", { includeUntracked: true }],
    ["deprecated diff scope", { diff: true }],
    ["deprecated full diff scope", { diff: false }],
    ["changed-file input", { changedFilesFrom: "files.txt" }],
    ["debug output", { debug: true }],
    ["deprecated failure gate", { failOn: "warning" }],
  ])("uses the stable renderer for %s", (_name, flags: InspectFlags) => {
    expect(shouldUseTui(makeInput({ flags }))).toBe(false);
  });

  it("keeps supported scan controls in the TUI", () => {
    const flags: InspectFlags = {
      blocking: "warning",
      category: "Security",
      deadCode: false,
      lint: false,
      maxDuration: "30",
      parallel: false,
      project: "app",
      respectInlineDisables: false,
      score: false,
      supplyChain: false,
      telemetry: false,
      warnings: false,
      yes: true,
    };

    expect(shouldUseTui(makeInput({ flags }))).toBe(true);
  });

  it.each([
    ["changed scope", { scope: "changed" }],
    ["legacy diff scope", { diff: true }],
    ["base-driven scope selection", { base: "main" }],
  ])("uses the stable renderer for config-defined %s", (_name, userConfig) => {
    expect(shouldUseTui(makeInput({ userConfig }))).toBe(false);
  });

  it.each([[{ scope: "full" }], [{ diff: false }], [{ diff: "false" }]])(
    "keeps a config-defined full scan in the TUI",
    (userConfig) => {
      expect(shouldUseTui(makeInput({ userConfig }))).toBe(true);
    },
  );
});
