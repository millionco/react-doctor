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

  it("does not flag a render callback passed to useMemo or called inline", () => {
    const result = run(`
      import { useMemo } from "react";
      export const Parent = ({ memoize }: { memoize: boolean }) => {
        const RenderContent = () => <div>Hello</div>;
        return memoize ? useMemo(RenderContent, []) : RenderContent();
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag multi-hop aliases used only as a useMemo callback", () => {
    const result = run(`
      import * as ReactClient from "react";
      const Parent = () => {
        const RenderContent = () => <div>Hello</div>;
        const firstRenderAlias = RenderContent;
        const SecondRenderAlias = firstRenderAlias;
        return ReactClient.useMemo(SecondRenderAlias, []);
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag wrapped callbacks passed through a renamed useMemo import", () => {
    const result = run(`
      import { useMemo as calculateMemo } from "react";
      const Parent = () => {
        const RenderContent = () => <div>Hello</div>;
        return calculateMemo(RenderContent as () => React.ReactNode, []);
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a nested component that is rendered as JSX on another branch", () => {
    const result = run(`
      import { useMemo } from "react";
      const Parent = ({ renderAsComponent }) => {
        const RenderContent = () => <div>Hello</div>;
        if (renderAsComponent) return <RenderContent />;
        return useMemo(RenderContent, []);
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a multi-hop immutable alias rendered as JSX", () => {
    const result = run(`
      const Parent = () => {
        const Nested = () => <div>Hello</div>;
        const firstNestedAlias = Nested;
        const SecondNestedAlias = firstNestedAlias;
        return <SecondNestedAlias />;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a reassigned nested binding whose replacement is rendered", () => {
    const result = run(`
      import { External } from "./external";
      const Parent = () => {
        let Nested = () => <div>Hello</div>;
        Nested = External;
        return <Nested />;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a shadowed createElement call as React instantiation", () => {
    const result = run(`
      const Parent = () => {
        const Nested = () => <div>Hello</div>;
        const createElement = (callback) => callback();
        return createElement(Nested);
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat another library namespace as React instantiation", () => {
    const result = run(`
      import * as Template from "template-runtime";
      const Parent = () => {
        const Nested = () => <div>Hello</div>;
        return Template.createElement(Nested);
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat cloneElement input as a component type", () => {
    const result = run(`
      import { cloneElement } from "react";
      const Parent = () => {
        const Nested = () => <div>Hello</div>;
        return cloneElement(Nested as unknown as React.ReactElement);
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags createElement calls proven to come from React", () => {
    const namedImportResult = run(`
      import { createElement as makeReactElement } from "react";
      const Parent = () => {
        const Nested = () => <div>Hello</div>;
        return makeReactElement(Nested);
      };
    `);
    const namespaceImportResult = run(`
      import * as ReactClient from "react";
      const Parent = () => {
        const Nested = () => <div>Hello</div>;
        return ReactClient.createElement(Nested);
      };
    `);
    expect(namedImportResult.diagnostics).toHaveLength(1);
    expect(namespaceImportResult.diagnostics).toHaveLength(1);
  });

  it("does not treat arbitrary JSX props or children as element-type sinks", () => {
    const result = run(`
      const Parent = () => {
        const RenderContent = () => <div>Hello</div>;
        return <Widget callback={RenderContent}>{RenderContent}</Widget>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags recognized element-type props", () => {
    const result = run(`
      const Parent = () => {
        const Nested = () => <div>Hello</div>;
        return <Widget ItemComponent={Nested} />;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves common library component-slot props", () => {
    for (const attributeName of ["body", "calendarContainer", "fallback", "tooltip"]) {
      const result = run(`
        const Parent = () => {
          const Nested = () => <div>Hello</div>;
          return <Widget ${attributeName}={Nested} />;
        };
      `);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("flags nested functions flowing through memo wrappers into JSX", () => {
    const result = run(`
      import { memo } from "react";
      const Parent = () => {
        const Nested = () => <div>Hello</div>;
        const MemoizedNested = memo(Nested);
        return <MemoizedNested />;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an unused inline memo wrapper", () => {
    const result = run(`
      import { memo } from "react";
      const Parent = () => {
        memo(() => <div>Hello</div>);
        return <main />;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags rendered React lazy wrappers but not unused ones", () => {
    const renderedResult = run(`
      import { lazy as loadLazy } from "react";
      const Parent = () => {
        const LazyNested = loadLazy(() => import("./nested"));
        return <LazyNested />;
      };
    `);
    const unusedResult = run(`
      import * as ReactClient from "react";
      const Parent = () => {
        ReactClient.lazy(() => import("./nested"));
        return <main />;
      };
    `);
    expect(renderedResult.diagnostics).toHaveLength(1);
    expect(unusedResult.diagnostics).toEqual([]);
  });

  it("does not flag nested functions returned as values", () => {
    const result = run(`
      const Parent = ({ returnFactory }) => {
        const Nested = () => <div>Hello</div>;
        if (returnFactory) return Nested;
        return <main />;
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
