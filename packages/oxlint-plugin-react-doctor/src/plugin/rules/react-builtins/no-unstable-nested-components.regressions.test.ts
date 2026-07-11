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

  it("does not attribute JSX across a nested function boundary", () => {
    const result = run(`
      function Parent() {
        const Child = () => <div>child</div>;
        return Child;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("detects JSX behind a TypeScript value wrapper", () => {
    const result = run(`
      const Parent = () => {
        const Child = () => (<div>child</div> as React.ReactElement);
        return <Child />;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  // The instantiation gate is keyed by SYMBOL: a same-named JSX usage of
  // a DIFFERENT binding (an import rendered elsewhere in the file) must
  // not count as instantiation of the nested inline helper.
  it("does not flag a nested inline helper whose name collides with a rendered import", () => {
    const result = run(`
      import { Item } from "./item";
      const List = () => <ul><Item /></ul>;
      const Parent = () => {
        const Item = () => <li>local</li>;
        return <ol>{Item()}</ol>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  // A named FunctionExpression binds the OUTER name via its declarator
  // (`const X = function Y() {}` — references resolve to X, Y only binds
  // inside the body), so the gate must key off the declarator id.
  it("flags a nested named-function-expression component instantiated via its variable", () => {
    const result = run(`
      const Parent = () => {
        const Child = function Child() { return <div>x</div>; };
        return <div><Child /></div>;
      };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // PR #991 FN: a nested component consumed BY REFERENCE is still
  // instantiated by its consumer — the canonical react-router
  // `component={Inner}` remount bug.
  it("flags a nested component passed by reference via a component prop", () => {
    const result = run(`
      const Parent = () => {
        const Inner = () => <div>x</div>;
        return <Route path="/x" component={Inner} />;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  // PR #991 FN: a nested component passed to a non-allowlisted wrapper
  // call whose result is rendered remounts every render too.
  it("flags a nested component passed to a wrapper call whose result is rendered", () => {
    const result = run(`
      const Parent = () => {
        const Inner = () => <div>x</div>;
        const Enhanced = withAnalytics(Inner);
        return <Enhanced />;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  // PR #991 FN: `<Thing.Panel/>` is a JSXMemberExpression — the
  // member-assigned candidate infers the PROPERTY name (`Panel`), so
  // the recorder must feed the name-matching fallback.
  it("flags a member-assigned nested component rendered as a JSX member expression", () => {
    const result = run(`
      const Parent = () => {
        const Thing = () => null;
        Thing.Panel = () => <div>x</div>;
        return <Thing.Panel />;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a member-assigned nested component instantiated via createElement", () => {
    const result = run(`
      const Parent = () => {
        const Thing = () => null;
        Thing.Panel = () => React.createElement("div", null);
        return React.createElement(Thing.Panel, null);
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  // A PascalCase read passed to a NON-RENDERING call whose result is
  // discarded (analytics / logging) is not instantiation evidence — the
  // inline-only helper must stay silent.
  it("does not flag an inline-called helper that is also passed to an analytics call", () => {
    const result = run(`
      const Parent = () => {
        const Inner = () => <div>x</div>;
        track(Inner);
        return <div>{Inner()}</div>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an inline-called helper that is also passed to console.log", () => {
    const result = run(`
      const Parent = () => {
        const Inner = () => <div>x</div>;
        console.log(Inner);
        return <div>{Inner()}</div>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  // A member-expression WRITE (`Helper.displayName = …`) is not escape
  // evidence — the inline-called helper must stay silent.
  it("does not flag an inline-called helper that only receives a displayName assignment", () => {
    const result = run(`
      const Parent = () => {
        const Helper = () => <div>x</div>;
        Helper.displayName = "Helper";
        return <div>{Helper()}</div>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  // allowAsProps (default true) exempts components declared inside a
  // JSX prop at ENQUEUE time; recording `<sections.General/>` as
  // instantiation evidence must not resurrect them.
  it("does not flag a prop-declared component object rendered via a JSX member expression", () => {
    const result = run(`
      const Screen = () => {
        return <Tabs sections={{ General: () => <div>tab</div> }} />;
      };
      const Body = ({ sections }) => <sections.General />;
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a prop-declared component object instantiated via createElement", () => {
    const result = run(`
      const Screen = () => {
        return <Tabs sections={{ General: () => <div>tab</div> }} />;
      };
      const Body = ({ sections }) => React.createElement(sections.General, null);
    `);
    expect(result.diagnostics).toEqual([]);
  });
});
