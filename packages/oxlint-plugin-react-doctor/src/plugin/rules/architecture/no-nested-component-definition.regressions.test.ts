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

  // Devin: rendered-JSX membership must be scoped to the candidate's own
  // enclosing component. A sibling rendering `<Inner/>` must not make a
  // same-named call-only helper in another parent a false positive.
  it("does not leak a sibling's <Inner/> onto a same-named call-only helper", () => {
    const result = run(`
      const Parent1 = () => {
        const Inner = () => <span>call-only</span>;
        return <div>{Inner()}</div>;
      };
      const Parent2 = () => {
        const Inner = () => <span>rendered</span>;
        return <Inner />;
      };
    `);
    // Only Parent2's rendered Inner is a genuine nested component; Parent1's
    // is inlined via a plain call and must stay quiet.
    expect(result.diagnostics).toHaveLength(1);
  });
});
