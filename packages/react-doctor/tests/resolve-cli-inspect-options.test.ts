import { describe, expect, it } from "vite-plus/test";
import { resolveCliInspectOptions } from "../src/cli/utils/resolve-cli-inspect-options.js";

describe("resolveCliInspectOptions — noScore", () => {
  it("opts out of scoring when --no-score is passed (flags.score === false)", () => {
    expect(resolveCliInspectOptions({ score: false }, null).noScore).toBe(true);
  });

  it("opts out of scoring via the --no-telemetry alias (flags.telemetry === false)", () => {
    expect(resolveCliInspectOptions({ telemetry: false }, null).noScore).toBe(true);
  });

  it("keeps scoring on by default", () => {
    expect(resolveCliInspectOptions({}, null).noScore).toBe(false);
  });

  it("inherits noScore from user config when no flag is passed", () => {
    expect(resolveCliInspectOptions({}, { noScore: true }).noScore).toBe(true);
  });
});
