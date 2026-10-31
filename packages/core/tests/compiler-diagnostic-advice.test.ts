import { describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { buildProject } from "./helpers/oxlint-parse-harness.js";

interface CompilerAdviceCase {
  name: string;
  plugin: string;
  rule: string;
  message: unknown;
  expectedMessage: string;
  expectedHelp: string;
  expectedTitle?: string;
  expectedCategory: string;
}

const compilerAdviceCases: CompilerAdviceCase[] = [
  {
    name: "retains the compiler reason and detail",
    plugin: "react-hooks-js",
    rule: "refs",
    message:
      "Warning: Synthetic analysis reason.\nSynthetic analysis detail.\n/synthetic/compiler-advice.tsx:9:5\nSynthetic source excerpt",
    expectedMessage:
      "React Compiler flagged this code during analysis: Synthetic analysis reason. Check whether evaluating the flagged expression reads or writes `ref.current` during render. React Compiler's refs analysis can conservatively flag ref forwarding through aggregate objects.",
    expectedHelp: "Synthetic analysis detail.",
    expectedTitle: "React Compiler can't optimize this",
    expectedCategory: "Performance",
  },
  {
    name: "uses the generic message for an empty reason",
    plugin: "react-hooks-js",
    rule: "refs",
    message: "",
    expectedMessage:
      "React Compiler flagged this code during analysis. Check whether evaluating the flagged expression reads or writes `ref.current` during render. React Compiler's refs analysis can conservatively flag ref forwarding through aggregate objects.",
    expectedHelp: "Synthetic fallback guidance.",
    expectedTitle: "React Compiler can't optimize this",
    expectedCategory: "Performance",
  },
  {
    name: "uses the generic message for a nonstring reason",
    plugin: "react-hooks-js",
    rule: "refs",
    message: null,
    expectedMessage:
      "React Compiler flagged this code during analysis. Check whether evaluating the flagged expression reads or writes `ref.current` during render. React Compiler's refs analysis can conservatively flag ref forwarding through aggregate objects.",
    expectedHelp: "Synthetic fallback guidance.",
    expectedTitle: "React Compiler can't optimize this",
    expectedCategory: "Performance",
  },
  {
    name: "keeps the complete internal reason in todo help",
    plugin: "react-hooks-js",
    rule: "todo",
    message: "Error: Synthetic internal note.\nSynthetic internal detail.",
    expectedMessage:
      "React Compiler flagged this code during analysis. Review the compiler's reason before changing the code.",
    expectedHelp: "Synthetic internal note.\nSynthetic internal detail.",
    expectedTitle: "React Compiler doesn't support this syntax",
    expectedCategory: "Performance",
  },
  {
    name: "retains the incompatible-library action",
    plugin: "react-hooks-js",
    rule: "incompatible-library",
    message: "Synthetic library reason.\nSynthetic library detail.",
    expectedMessage:
      "React Compiler flagged this code during analysis: Synthetic library reason. It's how the library works, not a bug in your code. Memoize values you pass from it into other memoized components, or suppress it with `// react-doctor-disable-next-line react-hooks-js/incompatible-library`.",
    expectedHelp: "Synthetic library detail.",
    expectedTitle: "React Compiler can't optimize this",
    expectedCategory: "Performance",
  },
  {
    name: "retains the error-boundaries message",
    plugin: "react-hooks-js",
    rule: "error-boundaries",
    message: "Synthetic boundary reason.\nSynthetic boundary detail.",
    expectedMessage:
      "This try/catch cannot catch errors thrown while the JSX child renders. Use an Error Boundary instead.",
    expectedHelp: "Synthetic boundary detail.",
    expectedTitle: "JSX render errors need an Error Boundary",
    expectedCategory: "Bugs",
  },
  {
    name: "retains the set-state-in-effect message",
    plugin: "react-hooks-js",
    rule: "set-state-in-effect",
    message: "Synthetic effect reason.\nSynthetic effect detail.",
    expectedMessage:
      "This synchronous effect update causes an extra render: Synthetic effect reason. Prefer deriving or initializing the value before render. If the effect must read a browser API after mount, treat this as advisory or suppress it with `// react-doctor-disable-next-line react-hooks-js/set-state-in-effect`.",
    expectedHelp: "Synthetic effect detail.",
    expectedTitle: "React Compiler can't optimize this",
    expectedCategory: "Performance",
  },
  {
    name: "retains ordinary third-party diagnostic wording",
    plugin: "eslint",
    rule: "synthetic-advice",
    message: "Synthetic external reason. /synthetic/compiler-advice.tsx:9:5",
    expectedMessage: "Synthetic external reason.",
    expectedHelp: "Synthetic fallback guidance.",
    expectedCategory: "Bugs",
  },
];

describe.each([true, false])(
  "compiler diagnostic advice with build compiler %s",
  (hasReactCompiler) => {
    it.each(compilerAdviceCases)("$name", (diagnosticCase) => {
      const output = {
        diagnostics: [
          {
            message: diagnosticCase.message,
            code: `${diagnosticCase.plugin}(${diagnosticCase.rule})`,
            severity: "warning",
            causes: [],
            url: "https://example.invalid/compiler-advice",
            help: "Synthetic fallback guidance.",
            filename: "/synthetic/compiler-advice.tsx",
            labels: [
              {
                label: "Synthetic primary site.",
                span: { offset: 120, length: 4, line: 9, column: 5 },
              },
              {
                label: "Synthetic related site.",
                span: { offset: 240, length: 3, line: 21, column: 6 },
              },
            ],
            related: [],
          },
        ],
        number_of_files: 1,
        number_of_rules: 1,
      };

      const diagnostics = parseOxlintOutput(
        JSON.stringify(output),
        buildProject({ hasReactCompiler, hasReactCompilerLintPlugin: true }),
        "/synthetic",
      );

      expect(diagnostics).toEqual([
        {
          filePath: "/synthetic/compiler-advice.tsx",
          plugin: diagnosticCase.plugin,
          rule: diagnosticCase.rule,
          severity: "warning",
          title: diagnosticCase.expectedTitle,
          message: diagnosticCase.expectedMessage,
          help: diagnosticCase.expectedHelp,
          url: "https://example.invalid/compiler-advice",
          line: 9,
          column: 5,
          offset: 120,
          length: 4,
          category: diagnosticCase.expectedCategory,
          relatedLocations: [
            {
              filePath: "/synthetic/compiler-advice.tsx",
              line: 21,
              column: 6,
              offset: 240,
              length: 3,
              message: "Synthetic related site.",
            },
          ],
        },
      ]);
    });
  },
);
