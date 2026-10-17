import { describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../../src/runners/oxlint/parse-output.js";
import { buildProject, TEST_ROOT_DIRECTORY } from "../helpers/oxlint-parse-harness.js";

describe("regression: issue #2087 - oxlint suppressions file summary diagnostics", () => {
  const HEALTHY_DIAGNOSTIC = {
    message: "Avoid using array index as key",
    code: "react-doctor(no-array-index-as-key)",
    severity: "error",
    causes: [],
    url: "",
    help: "",
    filename: "src/components/widget.tsx",
    labels: [{ label: "", span: { offset: 0, length: 1, line: 12, column: 3 } }],
    related: [],
  };

  const buildOutput = (diagnostics: unknown[]): string =>
    JSON.stringify({
      diagnostics,
      number_of_files: 2,
      number_of_rules: 1,
    });

  it("tolerates and filters 'suppressions that do not occur anymore' diagnostic", () => {
    const diagnostics = parseOxlintOutput(
      buildOutput([
        HEALTHY_DIAGNOSTIC,
        {
          message: "There are suppressions that do not occur anymore.",
          severity: "error",
          help: "Run `oxlint --prune-suppressions` to remove unused suppressions.",
          filename: "",
          labels: [],
        },
      ]),
      buildProject(),
      TEST_ROOT_DIRECTORY,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].rule).toBe("no-array-index-as-key");
  });

  it("tolerates and filters 'new violations not covered' diagnostic", () => {
    const diagnostics = parseOxlintOutput(
      buildOutput([
        HEALTHY_DIAGNOSTIC,
        {
          message: "There are new violations not covered by the suppressions file.",
          severity: "error",
          help: "Run `oxlint --suppress-all` to regenerate the suppressions file.",
          filename: "",
          labels: [],
        },
      ]),
      buildProject(),
      TEST_ROOT_DIRECTORY,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].rule).toBe("no-array-index-as-key");
  });

  it("does not throw when only a suppressions file diagnostic is present", () => {
    const diagnostics = parseOxlintOutput(
      buildOutput([
        {
          message: "There are suppressions that do not occur anymore.",
          severity: "error",
          help: "Run `oxlint --prune-suppressions` to remove unused suppressions.",
          filename: "",
          labels: [],
        },
      ]),
      buildProject(),
      TEST_ROOT_DIRECTORY,
    );

    expect(diagnostics).toHaveLength(0);
  });

  it("still treats engine failures as hard errors", () => {
    expect(() =>
      parseOxlintOutput(
        buildOutput([
          HEALTHY_DIAGNOSTIC,
          {
            message: "Error running JS plugin.",
            severity: "error",
            filename: "",
            labels: [],
          },
        ]),
        buildProject(),
        TEST_ROOT_DIRECTORY,
      ),
    ).toThrow("Failed to parse oxlint output");
  });
});
