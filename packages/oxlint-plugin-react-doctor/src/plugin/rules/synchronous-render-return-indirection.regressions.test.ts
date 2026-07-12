import { describe, expect, it } from "vite-plus/test";
import { GIANT_COMPONENT_LINE_THRESHOLD } from "../constants/thresholds.js";
import { runRule } from "../../test-utils/run-rule.js";
import { noGiantComponent } from "./architecture/no-giant-component.js";
import { rerenderMemoBeforeEarlyReturn } from "./performance/rerender-memo-before-early-return.js";
import { noUnstableNestedComponents } from "./react-builtins/no-unstable-nested-components.js";

describe("synchronous render return indirection regressions", () => {
  it("preserves no-giant-component through a zero-argument render helper", () => {
    const fillerLines = Array.from(
      { length: GIANT_COMPONENT_LINE_THRESHOLD },
      (_, index) => `const value${index} = ${index};`,
    ).join("\n");
    const result = runRule(
      noGiantComponent,
      `function GiantComponent() {
        ${fillerLines}
        const render = () => <main />;
        return render();
      }`,
      { filename: "fixture.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves no-unstable-nested-components through a zero-argument render helper", () => {
    const result = runRule(
      noUnstableNestedComponents,
      `function ParentComponent() {
        function UnstableChild() {
          const render = () => <div />;
          return render();
        }
        return <UnstableChild />;
      }`,
      { filename: "fixture.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves rerender-memo-before-early-return through local render values", () => {
    const fixtures = [
      `function Component({ condition }) {
        const content = useMemo(() => { const output = <Heavy />; return output; }, []);
        if (condition) return null;
        return <div>{content}</div>;
      }`,
      `function Component({ condition }) {
        const content = useMemo(() => { const render = () => <Heavy />; return render(); }, []);
        if (condition) return null;
        return <div>{content}</div>;
      }`,
      `function Component({ condition }) {
        const content = useMemo(() => {
          const output = <Heavy />;
          if (!output) return null;
          return output;
        }, []);
        if (condition) return null;
        return <div>{content}</div>;
      }`,
    ];
    for (const fixture of fixtures) {
      const result = runRule(rerenderMemoBeforeEarlyReturn, fixture, {
        filename: "fixture.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("keeps parameterized and deferred render helpers opaque", () => {
    const nestedComponentResult = runRule(
      noUnstableNestedComponents,
      `function ParentComponent(value) {
        function Child() {
          const render = (input) => <div>{input}</div>;
          return render(value);
        }
        return <Child />;
      }`,
      { filename: "fixture.tsx" },
    );
    const memoResult = runRule(
      rerenderMemoBeforeEarlyReturn,
      `function Component({ condition }) {
        const content = useMemo(() => { const render = () => <Heavy />; return render; }, []);
        if (condition) return null;
        return <div>{String(content)}</div>;
      }`,
      { filename: "fixture.tsx" },
    );
    expect(nestedComponentResult.parseErrors).toEqual([]);
    expect(nestedComponentResult.diagnostics).toEqual([]);
    expect(memoResult.parseErrors).toEqual([]);
    expect(memoResult.diagnostics).toEqual([]);
  });
});
