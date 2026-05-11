import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  compileIgnoreOverrides,
  isDiagnosticIgnoredByOverrides,
} from "../src/utils/apply-ignore-overrides.js";
import { buildDiagnostic } from "./regressions/_helpers.js";

const ROOT_DIRECTORY = "/repo";

describe("compileIgnoreOverrides", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns no overrides when config is missing or malformed", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(compileIgnoreOverrides(null)).toEqual([]);
    expect(compileIgnoreOverrides(JSON.parse('{"ignore":{"overrides":"bad"}}'))).toEqual([]);
    expect(stderrSpy).toHaveBeenCalledWith(
      "[react-doctor] ignore.overrides must be an array of { files, rules } entries; ignoring.\n",
    );
  });

  it("drops malformed entries and treats malformed rules as global suppression", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const overrides = compileIgnoreOverrides(
      JSON.parse(
        JSON.stringify({
          ignore: {
            overrides: [
              null,
              { files: "src/**", rules: ["react-doctor/rule"] },
              { files: ["src/empty.tsx"], rules: [false] },
              { files: ["src/app.tsx"], rules: "bad" },
              { files: [], rules: ["react-doctor/rule"] },
            ],
          },
        }),
      ),
    );

    expect(overrides).toHaveLength(2);
    expect(overrides[0].ruleIds.size).toBe(0);
    expect(overrides[1].ruleIds.size).toBe(0);
    expect(stderrSpy).toHaveBeenCalledTimes(4);
  });
});

describe("isDiagnosticIgnoredByOverrides", () => {
  it("matches file and rule-specific overrides", () => {
    const overrides = compileIgnoreOverrides({
      ignore: {
        overrides: [{ files: ["src/app.tsx"], rules: ["react-doctor/test-rule"] }],
      },
    });

    expect(
      isDiagnosticIgnoredByOverrides(
        buildDiagnostic({ filePath: path.join(ROOT_DIRECTORY, "src/app.tsx") }),
        ROOT_DIRECTORY,
        overrides,
      ),
    ).toBe(true);
    expect(
      isDiagnosticIgnoredByOverrides(
        buildDiagnostic({
          filePath: path.join(ROOT_DIRECTORY, "src/app.tsx"),
          rule: "other-rule",
        }),
        ROOT_DIRECTORY,
        overrides,
      ),
    ).toBe(false);
  });

  it("returns false when no overrides exist", () => {
    expect(isDiagnosticIgnoredByOverrides(buildDiagnostic(), ROOT_DIRECTORY, [])).toBe(false);
  });
});
