import { describe, expect, it } from "vitest";
import type { Diagnostic, ReactDoctorConfig } from "../src/types.js";
import { combineDiagnostics, computeJsxIncludePaths } from "../src/utils/combine-diagnostics.js";

const createDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react-doctor",
  rule: "test-rule",
  severity: "warning",
  message: "test message",
  help: "test help",
  line: 1,
  column: 1,
  category: "Test",
  ...overrides,
});

describe("computeJsxIncludePaths", () => {
  it("returns undefined for empty include paths", () => {
    expect(computeJsxIncludePaths([])).toBeUndefined();
  });

  it("filters to only JSX/TSX files", () => {
    const paths = ["src/app.tsx", "src/utils.ts", "src/Button.jsx", "src/config.js"];
    const result = computeJsxIncludePaths(paths);
    expect(result).toEqual(["src/app.tsx", "src/Button.jsx"]);
  });

  it("returns empty array when no JSX/TSX files exist", () => {
    const paths = ["src/utils.ts", "src/config.js"];
    const result = computeJsxIncludePaths(paths);
    expect(result).toEqual([]);
  });
});

describe("combineDiagnostics", () => {
  it("merges lint and dead code diagnostics", () => {
    const lintDiagnostics = [createDiagnostic({ rule: "lint-rule" })];
    const deadCodeDiagnostics = [createDiagnostic({ rule: "dead-code-rule" })];

    const result = combineDiagnostics(lintDiagnostics, deadCodeDiagnostics, "/tmp", true, null);
    expect(result).toHaveLength(2);
    expect(result[0].rule).toBe("lint-rule");
    expect(result[1].rule).toBe("dead-code-rule");
  });

  it("returns empty array when both inputs are empty in diff mode", () => {
    const result = combineDiagnostics([], [], "/tmp", true, null);
    expect(result).toEqual([]);
  });

  it("applies config filtering when userConfig is provided", () => {
    const diagnostics = [
      createDiagnostic({ plugin: "react", rule: "no-danger" }),
      createDiagnostic({ plugin: "react-doctor", rule: "no-giant-component" }),
    ];
    const config: ReactDoctorConfig = {
      ignore: { rules: ["react/no-danger"] },
    };

    const result = combineDiagnostics(diagnostics, [], "/tmp", true, config);
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("no-giant-component");
  });

  it("skips config filtering when userConfig is null", () => {
    const diagnostics = [createDiagnostic(), createDiagnostic()];
    const result = combineDiagnostics(diagnostics, [], "/tmp", true, null);
    expect(result).toHaveLength(2);
  });
});
