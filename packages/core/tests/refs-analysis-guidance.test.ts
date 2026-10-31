import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import type { OxlintOutput } from "../src/types/index.js";
import { buildProject } from "./helpers/oxlint-parse-harness.js";

const EXPECTED_REFS_ACTION =
  "Check whether evaluating the flagged expression reads or writes `ref.current` during render. React Compiler's refs analysis can conservatively flag ref forwarding through aggregate objects.";

const syntheticDiagnostic: OxlintOutput["diagnostics"][number] = {
  message: "Synthetic current analysis.\nSynthetic current detail.",
  code: "react-hooks-js(refs)",
  severity: "error",
  causes: [],
  url: "https://example.invalid/refs-guidance",
  help: "Synthetic upstream fallback.",
  filename: "/synthetic/refs-guidance.tsx",
  labels: [
    {
      label: "Synthetic primary expression.",
      span: { offset: 64, length: 8, line: 7, column: 11 },
    },
    {
      label: "Synthetic related expression.",
      span: { offset: 96, length: 6, line: 10, column: 4 },
    },
  ],
  related: [],
};

describe("refs analysis guidance", () => {
  it.each([
    {
      code: "react-hooks-js(refs)",
      plugin: "react-hooks-js",
      rule: "refs",
      title: "React Compiler can't optimize this",
      category: "Performance",
      message: `React Compiler flagged this code during analysis: Synthetic current analysis. ${EXPECTED_REFS_ACTION}`,
      help: "Synthetic current detail.",
    },
    {
      code: "custom(refs)",
      plugin: "custom",
      rule: "refs",
      title: undefined,
      category: "Bugs",
      message: "Synthetic current analysis.\nSynthetic current detail.",
      help: "Synthetic upstream fallback.",
    },
    {
      code: "react-hooks(refs)",
      plugin: "react-hooks",
      rule: "refs",
      title: undefined,
      category: "Bugs",
      message: "Synthetic current analysis.\nSynthetic current detail.",
      help: "Synthetic upstream fallback.",
    },
    {
      code: "react-hooks-js(refs-extra)",
      plugin: "react-hooks-js",
      rule: "refs-extra",
      title: "React Compiler can't optimize this",
      category: "Performance",
      message:
        "React Compiler flagged this code during analysis: Synthetic current analysis. Review the compiler's reason before changing the code.",
      help: "Synthetic current detail.",
    },
    {
      code: "react-hooks-js(purity)",
      plugin: "react-hooks-js",
      rule: "purity",
      title: "React Compiler can't optimize this",
      category: "Performance",
      message:
        "React Compiler flagged this code during analysis: Synthetic current analysis. Review the compiler's reason before changing the code.",
      help: "Synthetic current detail.",
    },
  ])("preserves the complete diagnostic for $code", (diagnosticCase) => {
    const output: OxlintOutput = {
      diagnostics: [{ ...syntheticDiagnostic, code: diagnosticCase.code }],
      number_of_files: 1,
      number_of_rules: 1,
    };

    expect(parseOxlintOutput(JSON.stringify(output), buildProject(), "/synthetic")).toEqual([
      {
        filePath: "/synthetic/refs-guidance.tsx",
        plugin: diagnosticCase.plugin,
        rule: diagnosticCase.rule,
        severity: "error",
        title: diagnosticCase.title,
        category: diagnosticCase.category,
        message: diagnosticCase.message,
        help: diagnosticCase.help,
        url: "https://example.invalid/refs-guidance",
        line: 7,
        column: 11,
        offset: 64,
        length: 8,
        relatedLocations: [
          {
            filePath: "/synthetic/refs-guidance.tsx",
            line: 10,
            column: 4,
            offset: 96,
            length: 6,
            message: "Synthetic related expression.",
          },
        ],
      },
    ]);
  });

  it("retains the compiler bailout that suppresses manual memoization cleanup in its function", () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-refs-guidance-"));
    const sourcePath = path.join(rootDirectory, "preview.tsx");
    const sourceText = [
      'import { useMemo, useRef } from "react";',
      "const Preview = () => {",
      "  const nodeRef = useRef(null);",
      '  const previewValue = useMemo(() => ({ title: "preview" }), []);',
      "  return <span>{nodeRef.current}</span>;",
      "};",
      "const Sibling = () => {",
      '  const siblingValue = useMemo(() => ({ title: "sibling" }), []);',
      "  return <span>{siblingValue.title}</span>;",
      "};",
    ].join("\n");
    fs.writeFileSync(sourcePath, sourceText, { mode: 0o600 });

    try {
      const output: OxlintOutput = {
        diagnostics: [
          {
            ...syntheticDiagnostic,
            filename: sourcePath,
            labels: [
              {
                label: "Synthetic render current access.",
                span: {
                  offset: sourceText.indexOf("nodeRef.current"),
                  length: 15,
                  line: 5,
                  column: 17,
                },
              },
            ],
          },
          {
            ...syntheticDiagnostic,
            code: "react-doctor(react-compiler-no-manual-memoization)",
            filename: sourcePath,
            labels: [
              {
                label: "Synthetic same-function memoization.",
                span: {
                  offset: sourceText.indexOf("previewValue"),
                  length: 12,
                  line: 4,
                  column: 9,
                },
              },
            ],
          },
          {
            ...syntheticDiagnostic,
            code: "react-doctor(react-compiler-no-manual-memoization)",
            filename: sourcePath,
            labels: [
              {
                label: "Synthetic sibling memoization.",
                span: {
                  offset: sourceText.indexOf("siblingValue"),
                  length: 12,
                  line: 8,
                  column: 9,
                },
              },
            ],
          },
        ],
        number_of_files: 1,
        number_of_rules: 2,
      };
      const diagnostics = parseOxlintOutput(
        JSON.stringify(output),
        buildProject({ rootDirectory }),
        rootDirectory,
      );

      expect(diagnostics.map(({ plugin, rule, line }) => ({ plugin, rule, line }))).toEqual([
        { plugin: "react-hooks-js", rule: "refs", line: 5 },
        { plugin: "react-doctor", rule: "react-compiler-no-manual-memoization", line: 8 },
      ]);
      expect(diagnostics[0]).toEqual({
        filePath: sourcePath,
        plugin: "react-hooks-js",
        rule: "refs",
        severity: "error",
        title: "React Compiler can't optimize this",
        category: "Performance",
        message: `React Compiler flagged this code during analysis: Synthetic current analysis. ${EXPECTED_REFS_ACTION}`,
        help: "Synthetic current detail.",
        url: "https://example.invalid/refs-guidance",
        line: 5,
        column: 17,
        offset: sourceText.indexOf("nodeRef.current"),
        length: 15,
        endLine: 5,
      });
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});
