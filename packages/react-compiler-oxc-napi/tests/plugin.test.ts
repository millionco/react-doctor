import { describe, expect, it } from "vite-plus/test";

import reactHooksPlugin from "../plugin.js";

interface ReportDescriptor {
  message: string;
  loc: { start: { line: number; column: number }; end: { line: number; column: number } };
}

const runRule = (ruleName: string, code: string, filename = "Component.tsx"): ReportDescriptor[] => {
  const reports: ReportDescriptor[] = [];
  const context = {
    filename,
    sourceCode: { text: code },
    report: (descriptor: ReportDescriptor) => reports.push(descriptor),
  };
  reactHooksPlugin.rules[ruleName].create(context);
  return reports;
};

const SET_STATE_IN_RENDER =
  "function Component() {\n  const [state, setState] = useState(0);\n  setState(1);\n  return <div>{state}</div>;\n}\n";

describe("react-hooks-js native plugin", () => {
  it("uses the react-hooks-js namespace and exposes all 16 React Compiler rules", () => {
    expect(reactHooksPlugin.meta.name).toBe("react-hooks-js");
    expect(Object.keys(reactHooksPlugin.rules).sort()).toEqual(
      [
        "component-hook-factories",
        "error-boundaries",
        "globals",
        "hooks",
        "immutability",
        "incompatible-library",
        "preserve-manual-memoization",
        "purity",
        "refs",
        "set-state-in-effect",
        "set-state-in-render",
        "static-components",
        "todo",
        "unsupported-syntax",
        "use-memo",
        "void-use-memo",
      ].sort(),
    );
  });

  it("set-state-in-render reports setState during render with the upstream message + location", () => {
    const reports = runRule("set-state-in-render", SET_STATE_IN_RENDER);
    expect(reports).toHaveLength(1);
    expect(reports[0].message).toContain("Error: Cannot call setState during render");
    expect(reports[0].loc.start.line).toBe(3);
  });

  it("set-state-in-render does not fire on conditional setState", () => {
    const code =
      "function Component(props) {\n  const [state, setState] = useState(0);\n  if (props.flag) {\n    setState(1);\n  }\n  return <div>{state}</div>;\n}\n";
    expect(runRule("set-state-in-render", code)).toHaveLength(0);
  });

  it("error-boundaries fires on JSX constructed in a try block", () => {
    const code = "function Component() {\n  let el;\n  try {\n    el = <Child />;\n  } catch {}\n  return el;\n}\n";
    expect(runRule("error-boundaries", code)).toHaveLength(1);
  });

  it("set-state-in-effect fires on setState in a useEffect body", () => {
    const code =
      'import { useState, useEffect } from "react";\nfunction Component() {\n  const [state, setState] = useState(0);\n  useEffect(() => {\n    setState(1);\n  });\n  return <div>{state}</div>;\n}\n';
    expect(runRule("set-state-in-effect", code)).toHaveLength(1);
  });

  it("an unported rule (refs) exposes a rule that simply reports nothing yet", () => {
    expect(reactHooksPlugin.rules.refs).toBeDefined();
    expect(runRule("refs", SET_STATE_IN_RENDER)).toHaveLength(0);
  });
});
