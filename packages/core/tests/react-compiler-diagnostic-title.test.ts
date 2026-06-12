import { describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "@react-doctor/core";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";

const ROOT_DIRECTORY = "/home/user/app";

const buildProject = (): ProjectInfo => ({
  rootDirectory: ROOT_DIRECTORY,
  projectName: "app",
  reactVersion: "19.2.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "nextjs",
  hasTypeScript: true,
  hasReactCompiler: true,
  hasTanStackQuery: false,
  nextjsVersion: "15.0.0",
  nextjsMajorVersion: 15,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 10,
});

const buildOxlintStdout = (code: string, message: string): string =>
  JSON.stringify({
    diagnostics: [
      {
        message,
        code,
        severity: "error",
        causes: [],
        url: "",
        help: "",
        filename: "src/components/widget.tsx",
        labels: [{ label: "", span: { offset: 0, length: 1, line: 12, column: 3 } }],
        related: [],
      },
    ],
    number_of_files: 1,
    number_of_rules: 1,
  });

describe("parseOxlintOutput react-hooks-js diagnostic titles", () => {
  it("titles `todo` diagnostics as unsupported syntax", () => {
    const stdout = buildOxlintStdout(
      "react-hooks-js(todo)",
      "(BuildHIR::lowerExpression) Handle TaggedTemplateExpression expressions",
    );
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), ROOT_DIRECTORY);

    expect(diagnostic).toMatchInlineSnapshot(`
      {
        "category": "Performance",
        "column": 3,
        "filePath": "src/components/widget.tsx",
        "help": "(BuildHIR::lowerExpression) Handle TaggedTemplateExpression expressions",
        "length": 1,
        "line": 12,
        "message": "This component misses React Compiler's automatic memoization & re-renders more than it should. Rewrite the flagged code so the compiler can optimize it.",
        "offset": 0,
        "plugin": "react-hooks-js",
        "rule": "todo",
        "severity": "error",
        "title": "React Compiler doesn't support this syntax",
        "url": "",
      }
    `);
  });

  it("keeps the generic headline for other react-hooks-js rules", () => {
    const stdout = buildOxlintStdout("react-hooks-js(refs)", "Cannot access ref during render");
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), ROOT_DIRECTORY);

    expect(diagnostic.title).toBe("React Compiler can't optimize this");
  });
});
