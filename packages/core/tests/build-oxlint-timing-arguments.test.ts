import { describe, expect, it } from "vite-plus/test";
import { buildOxlintTimingArguments } from "../src/utils/build-oxlint-timing-arguments.js";

describe("buildOxlintTimingArguments", () => {
  it("reuses the lint invocation with the timing formatter", () => {
    expect(
      buildOxlintTimingArguments([
        "oxlint.js",
        "-c",
        "/tmp/oxlintrc.json",
        "--format",
        "json",
        "src/app.tsx",
      ]),
    ).toEqual([
      "oxlint.js",
      "-c",
      "/tmp/oxlintrc.json",
      "--format",
      "default",
      "src/app.tsx",
      "--debug",
      "timings",
      "--quiet",
    ]);
  });

  it("rejects invocations without a format value", () => {
    expect(() => buildOxlintTimingArguments(["oxlint.js"])).toThrow("--format");
    expect(() => buildOxlintTimingArguments(["oxlint.js", "--format"])).toThrow("--format");
  });
});
