import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnstableNestedComponents } from "./no-unstable-nested-components.js";

const run = (code: string) =>
  runRule(noUnstableNestedComponents, code, { filename: "fixture.tsx" });

describe("react-builtins/no-unstable-nested-components — regressions", () => {
  it("flags a nested PascalCase component rendered as JSX", () => {
    const result = run(`
      const Parent = () => {
        const GeneralSection = () => <div>x</div>;
        return <div><GeneralSection /></div>;
      };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a nested PascalCase component instantiated via createElement", () => {
    const result = run(`
      function Parent() {
        function Inner() { return React.createElement("div", null); }
        return React.createElement("div", null, React.createElement(Inner, null));
      }
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag a nested PascalCase render helper only called inline", () => {
    const result = run(`
      const Parent = () => {
        const GeneralSection = () => <div>x</div>;
        return <div>{GeneralSection()}</div>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });
});
