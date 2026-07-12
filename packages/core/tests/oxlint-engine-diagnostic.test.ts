import { describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { buildProject, TEST_ROOT_DIRECTORY } from "./helpers/oxlint-parse-harness.js";

const buildEngineDiagnosticOutput = (diagnostic: unknown): string =>
  JSON.stringify({
    diagnostics: [diagnostic],
    number_of_files: 1,
    number_of_rules: 1,
  });

describe("parseOxlintOutput engine diagnostics", () => {
  it.each([
    [
      "plugin runtime error",
      {
        message: "Error running JS plugin.",
        severity: "error",
        filename: "",
        labels: [],
      },
    ],
    [
      "syntax error",
      {
        message: "Unexpected token",
        severity: "error",
        filename: `${TEST_ROOT_DIRECTORY}/src/App.tsx`,
        labels: [],
      },
    ],
    [
      "empty rule code",
      {
        message: "Missing rule identity",
        code: "",
        severity: "error",
        filename: `${TEST_ROOT_DIRECTORY}/src/App.tsx`,
        labels: [],
      },
    ],
    ["malformed record", null],
  ])("rejects an unmappable diagnostic: %s", (_description, diagnostic) => {
    expect(() =>
      parseOxlintOutput(
        buildEngineDiagnosticOutput(diagnostic),
        buildProject(),
        TEST_ROOT_DIRECTORY,
      ),
    ).toThrow("Failed to parse oxlint output");
  });
});
