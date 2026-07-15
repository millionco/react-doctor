import { describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import {
  buildOxlintStdout,
  buildProject,
  TEST_ROOT_DIRECTORY,
} from "./helpers/oxlint-parse-harness.js";

describe("parseOxlintOutput react-hooks-js diagnostic titles", () => {
  it("preserves error-boundaries as a correctness diagnostic", () => {
    const stdout = buildOxlintStdout(
      "react-hooks-js(error-boundaries)",
      "Error: Avoid constructing JSX within try/catch\n\nReact does not immediately render components when JSX is rendered, so any errors from this component will not be caught by the try/catch. To catch errors in rendering a given component, wrap that component in an error boundary. (https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary).",
    );
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic).toMatchObject({
      title: "JSX render errors need an Error Boundary",
      category: "Bugs",
      message:
        "This try/catch cannot catch errors thrown while the JSX child renders. Use an Error Boundary instead.",
    });
    expect(diagnostic.message).not.toContain("React Compiler");
    expect(diagnostic.message).not.toContain("re-renders");
    expect(diagnostic.help).toContain("React does not immediately render components");
    expect(diagnostic.help).toContain("error boundary");
  });

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
    expect(diagnostic.category).toBe("Performance");
    expect(diagnostic.message).toContain("misses React Compiler's automatic memoization");
  });

  it("does not apply the adopted-rule override to another plugin", () => {
    const stdout = buildOxlintStdout(
      "custom(error-boundaries)",
      "A custom rule with the same name",
    );
    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic.title).toBeUndefined();
    expect(diagnostic.message).toBe("A custom rule with the same name");
  });
});
