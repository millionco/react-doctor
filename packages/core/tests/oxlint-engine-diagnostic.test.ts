import { describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { buildProject, TEST_ROOT_DIRECTORY } from "./helpers/oxlint-parse-harness.js";

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

const TYPESCRIPT_DECLARATION_DIAGNOSTIC = {
  ...HEALTHY_DIAGNOSTIC,
  message: "Statements are not allowed in ambient contexts.",
  code: "TS(1036)",
  filename: "src/global.d.ts",
};

const buildOutput = (diagnostics: unknown[]): string =>
  JSON.stringify({
    diagnostics,
    number_of_files: 2,
    number_of_rules: 1,
  });

describe("parseOxlintOutput engine diagnostics", () => {
  it.each([
    [
      "plugin runtime error (empty filename)",
      {
        message: "Error running JS plugin.",
        severity: "error",
        filename: "",
        labels: [],
      },
    ],
    [
      "engine error (missing filename)",
      {
        message: "Error running JS plugin.",
        severity: "error",
        labels: [],
      },
    ],
    ["malformed record", null],
  ])(
    "hard-fails on an engine-level diagnostic even next to healthy findings: %s",
    (_description, diagnostic) => {
      expect(() =>
        parseOxlintOutput(
          buildOutput([HEALTHY_DIAGNOSTIC, diagnostic]),
          buildProject(),
          TEST_ROOT_DIRECTORY,
        ),
      ).toThrow("Failed to parse oxlint output");
    },
  );

  it("names the engine failure in the error, not the healthy sibling", () => {
    expect(() =>
      parseOxlintOutput(
        buildOutput([
          HEALTHY_DIAGNOSTIC,
          { message: "Error running JS plugin.", severity: "error", filename: "", labels: [] },
        ]),
        buildProject(),
        TEST_ROOT_DIRECTORY,
      ),
    ).toThrow("Error running JS plugin");
  });

  it.each([
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
    [
      "unused disable directive",
      {
        message: "Unused eslint-disable directive",
        severity: "warning",
        filename: `${TEST_ROOT_DIRECTORY}/src/App.tsx`,
        labels: [],
      },
    ],
    [
      "label without a span",
      {
        ...HEALTHY_DIAGNOSTIC,
        filename: `${TEST_ROOT_DIRECTORY}/src/App.tsx`,
        labels: [{ label: "" }],
      },
    ],
  ])(
    "drops a per-file unmappable diagnostic and keeps its healthy siblings: %s",
    (_description, diagnostic) => {
      const diagnostics = parseOxlintOutput(
        buildOutput([diagnostic, HEALTHY_DIAGNOSTIC]),
        buildProject(),
        TEST_ROOT_DIRECTORY,
      );

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].rule).toBe("no-array-index-as-key");
    },
  );

  it.each(["TS(1036)", "TS(1038)", "TS(1183)", "TS(1319)"])(
    "drops newly introduced ambient declaration diagnostic %s",
    (code) => {
      expect(
        parseOxlintOutput(
          buildOutput([{ ...TYPESCRIPT_DECLARATION_DIAGNOSTIC, code }]),
          buildProject(),
          TEST_ROOT_DIRECTORY,
        ),
      ).toEqual([]);
    },
  );

  it.each(["src/global.d.mts", "src/global.d.cts"])(
    "drops ambient declaration diagnostics from %s",
    (filename) => {
      expect(
        parseOxlintOutput(
          buildOutput([{ ...TYPESCRIPT_DECLARATION_DIAGNOSTIC, filename }]),
          buildProject(),
          TEST_ROOT_DIRECTORY,
        ),
      ).toEqual([]);
    },
  );

  it("keeps the same TypeScript diagnostic in an ordinary source file", () => {
    const diagnostics = parseOxlintOutput(
      buildOutput([{ ...TYPESCRIPT_DECLARATION_DIAGNOSTIC, filename: "src/global.ts" }]),
      buildProject(),
      TEST_ROOT_DIRECTORY,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ plugin: "TS", rule: "1036" });
  });

  it("keeps established TypeScript diagnostics in declaration files", () => {
    const diagnostics = parseOxlintOutput(
      buildOutput([{ ...TYPESCRIPT_DECLARATION_DIAGNOSTIC, code: "TS(1039)" }]),
      buildProject(),
      TEST_ROOT_DIRECTORY,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ plugin: "TS", rule: "1039" });
  });
});
