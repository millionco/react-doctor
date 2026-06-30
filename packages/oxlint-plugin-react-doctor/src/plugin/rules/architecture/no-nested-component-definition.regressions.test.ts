import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNestedComponentDefinition } from "./no-nested-component-definition.js";

const run = (code: string) =>
  runRule(noNestedComponentDefinition, code, { filename: "fixture.tsx" });

describe("architecture/no-nested-component-definition — regressions", () => {
  it("flags a nested component that is rendered as JSX", () => {
    const result = run(`
      const Parent = () => {
        const NestedChild = () => <span>nested</span>;
        return <NestedChild />;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a nested PascalCase render helper only called inline", () => {
    const result = run(`
      const Settings = () => {
        const GeneralSection = () => <div>general</div>;
        return <div>{GeneralSection()}</div>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });
});
