import { describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import {
  buildOxlintStdout,
  buildProject,
  TEST_ROOT_DIRECTORY,
} from "./helpers/oxlint-parse-harness.js";

describe("parseOxlintOutput react-hooks-js diagnostic titles", () => {
  it("titles `todo` diagnostics as unsupported syntax", () => {
    const stdout = buildOxlintStdout(
      "react-hooks-js(todo)",
      "(BuildHIR::lowerExpression) Handle TaggedTemplateExpression expressions",
    );
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

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
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic.title).toBe("React Compiler can't optimize this");
  });
});
