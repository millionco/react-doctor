import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/core";
import { createNodeReadFileLinesSync, mergeAndFilterDiagnostics } from "@react-doctor/core";

const TEST_ROOT_DIRECTORY = "/home/user/project";
const testReadFileLines = createNodeReadFileLinesSync(TEST_ROOT_DIRECTORY);

const filterIgnoredDiagnostics = (
  diagnostics: Diagnostic[],
  config: ReactDoctorConfig,
  rootDirectory: string,
  readFileLinesSync: (filePath: string) => string[] | null,
): Diagnostic[] =>
  mergeAndFilterDiagnostics(diagnostics, rootDirectory, config, readFileLinesSync, {
    respectInlineDisables: false,
    warnings: true,
  });

const createDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react-doctor",
  rule: "no-danger",
  severity: "warning",
  message: "test message",
  help: "test help",
  line: 1,
  column: 1,
  category: "Correctness",
  ...overrides,
});

describe("ignore.rules filters dead-code diagnostics (issue #1710)", () => {
  it("filters unused-file diagnostics when listed in ignore.rules", () => {
    const diagnostics = [
      createDiagnostic({
        plugin: "react-doctor",
        rule: "unused-file",
        filePath: "plugins/with-example.ts",
        line: 0,
        column: 0,
      }),
      createDiagnostic({
        plugin: "react-doctor",
        rule: "no-array-index-as-key",
        filePath: "src/App.tsx",
      }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        rules: ["react-doctor/unused-file"],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      TEST_ROOT_DIRECTORY,
      testReadFileLines,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rule).toBe("no-array-index-as-key");
  });

  it("filters unused-dependency diagnostics when listed in ignore.rules", () => {
    const diagnostics = [
      createDiagnostic({
        plugin: "react-doctor",
        rule: "unused-dependency",
        filePath: "package.json",
        line: 0,
        column: 0,
      }),
      createDiagnostic({
        plugin: "react-doctor",
        rule: "no-array-index-as-key",
        filePath: "src/App.tsx",
      }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        rules: ["react-doctor/unused-dependency"],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      TEST_ROOT_DIRECTORY,
      testReadFileLines,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rule).toBe("no-array-index-as-key");
  });

  it("filters all dead-code diagnostics when all are listed in ignore.rules", () => {
    const diagnostics = [
      createDiagnostic({
        plugin: "react-doctor",
        rule: "unused-file",
        filePath: "plugins/with-example.ts",
        line: 0,
        column: 0,
      }),
      createDiagnostic({
        plugin: "react-doctor",
        rule: "unused-dependency",
        filePath: "package.json",
        line: 0,
        column: 0,
      }),
      createDiagnostic({
        plugin: "react-doctor",
        rule: "no-array-index-as-key",
        filePath: "src/App.tsx",
      }),
    ];
    const config: ReactDoctorConfig = {
      ignore: {
        rules: [
          "react-doctor/unused-file",
          "react-doctor/unused-dependency",
          "react-doctor/no-array-index-as-key",
        ],
      },
    };

    const filtered = filterIgnoredDiagnostics(
      diagnostics,
      config,
      TEST_ROOT_DIRECTORY,
      testReadFileLines,
    );
    expect(filtered).toHaveLength(0);
  });
});
