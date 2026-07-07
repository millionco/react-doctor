import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCallComponentAsFunction } from "./no-call-component-as-function.js";

describe("react-builtins/no-call-component-as-function — regressions", () => {
  it("flags an imported component rendered at module scope and called elsewhere", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      import { Item } from "./item";
      const List = () => <ul><Item /></ul>;
      const Other = () => <ol>{Item()}</ol>;
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a default import rendered and called", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      import Item from "./item";
      const List = () => <ul><Item /></ul>;
      const Other = () => <ol>{Item()}</ol>;
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // A nested helper that OWNS hooks is not a closure render helper —
  // calling it inlines its hooks into the parent's hook order, and a
  // conditional call breaks that order. The hook-free exemption must
  // not cover it.
  it("flags a hook-owning nested component called conditionally and never rendered", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      import { useState } from "react";
      const Parent = ({ show }) => {
        const Counter = () => {
          const [count, setCount] = useState(0);
          return <button onClick={() => setCount(count + 1)}>{count}</button>;
        };
        return <div>{show && Counter()}</div>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a nested helper mounted via the React.createElement member form", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      import React from "react";
      const Settings = () => {
        const GeneralSection = () => <div>general</div>;
        return <div>{GeneralSection()}{React.createElement(GeneralSection, null)}</div>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a nested function-declaration helper also rendered as JSX", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      const Settings = () => {
        function GeneralSection() { return <div>general</div>; }
        return <div>{GeneralSection()}<GeneralSection /></div>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a nested helper rendered as JSX in a sibling nested closure", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      const Settings = () => {
        const GeneralSection = () => <div>general</div>;
        const renderBody = () => <GeneralSection />;
        return <div>{GeneralSection()}{renderBody()}</div>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // A hook-free nested PascalCase render helper only ever called inline
  // is a closure over the parent's state — calling it is correct, and
  // rendering it as JSX would remount it every render.
  it("stays silent on a hook-free nested render helper called inline", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      const Settings = () => {
        const GeneralSection = () => <div>general</div>;
        return <div>{GeneralSection()}</div>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // BoldedText(text, highlight) — a PascalCase formatter taking positional
  // args is not a component; there is no props object to render with.
  it("stays silent on a multi-parameter PascalCase helper called positionally (glific BoldedText)", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      const BoldedText = (text, highlight) => <span>{text}{highlight}</span>;
      const Row = ({ body, term }) => <div>{BoldedText(body, term)}</div>;
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Direct-calling an async server component is the deliberate RSC pattern;
  // async components cannot own hooks or fiber state.
  it("stays silent on a direct call of an async component (renoun TokensAsync)", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      import { Suspense } from "react";
      async function TokensAsync(props) {
        return <code>{props.children}</code>;
      }
      export function Tokens(props) {
        if (process.env.NODE_ENV === "production") {
          return TokensAsync(props);
        }
        return <Suspense><TokensAsync {...props} /></Suspense>;
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // useCallback(() => MenuIcon({ isChildrenVisible }), [deps]) builds an
  // adapter component — the call runs during the adapter's render, inside
  // React, so hook-free callees are safe there.
  it("stays silent on hook-free components called inside useCallback adapters (innovaccer MenuItem)", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      import * as React from "react";
      const MenuIcon = ({ open }) => <i>{open ? "up" : "down"}</i>;
      const MenuPills = ({ count }) => <b>{count}</b>;
      export const MenuItem = ({ menu, isChildrenVisible, customItemRenderer }) => {
        const MenuIconFn = React.useCallback(() => MenuIcon({ open: isChildrenVisible }), [isChildrenVisible]);
        const MenuPillsFn = React.useCallback(
          () => (menu.count !== undefined ? MenuPills({ count: menu.count }) : <></>),
          [menu.count],
        );
        if (customItemRenderer) {
          return customItemRenderer({ MenuIcon: MenuIconFn, MenuPills: MenuPillsFn });
        }
        return <div><MenuIcon open={isChildrenVisible} /><MenuPills count={menu.count} /></div>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a hook-owning component called inside a useCallback adapter", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      import * as React from "react";
      const Counter = () => {
        const [count, setCount] = React.useState(0);
        return <button onClick={() => setCount(count + 1)}>{count}</button>;
      };
      export const Panel = () => {
        const CounterFn = React.useCallback(() => Counter(), []);
        return <div><Counter />{CounterFn()}</div>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a hook-free component nested in a module-scope IIFE and never rendered", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      export const App = (() => {
        const Inner = () => <div>inner</div>;
        return () => <div>{Inner()}</div>;
      })();
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
