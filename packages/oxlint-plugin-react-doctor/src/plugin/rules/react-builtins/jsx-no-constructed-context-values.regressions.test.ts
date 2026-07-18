import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoConstructedContextValues } from "./jsx-no-constructed-context-values.js";

describe("react-builtins/jsx-no-constructed-context-values — regressions", () => {
  // React 19 lets you use the Context object directly as a JSX
  // component (no `.Provider`). The same identity-stability problem
  // exists in that shape, so the rule must follow `createContext`
  // bindings and recognise `<MyCtx value={{...}}>`.

  it("flags inline object value on the React 19 shorthand `<MyCtx value>`", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import { createContext } from "react";

      const MyCtx = createContext(null);

      function App() {
        return <MyCtx value={{ a: 1, b: 2 }} />;
      }
    `,
      { filename: "fixture.jsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags React 19 shorthand when createContext is imported under a rename", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import { createContext as makeCtx } from "react";

      const Ctx = makeCtx(null);

      function App() {
        return <Ctx value={{ user, setUser }} />;
      }
    `,
      { filename: "fixture.jsx" },
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags React 19 shorthand for context bound to use-context-selector / react-tracked", () => {
    const ucs = runRule(
      jsxNoConstructedContextValues,
      `
      import { createContext } from "use-context-selector";

      const Ctx = createContext(null);

      function App() {
        return <Ctx value={{ a: 1 }} />;
      }
    `,
      { filename: "fixture.jsx" },
    );
    const rt = runRule(
      jsxNoConstructedContextValues,
      `
      import { createContext } from "react-tracked";

      const Ctx = createContext(null);

      function App() {
        return <Ctx value={{ a: 1 }} />;
      }
    `,
      { filename: "fixture.jsx" },
    );

    expect(ucs.diagnostics).toHaveLength(1);
    expect(rt.diagnostics).toHaveLength(1);
  });

  it("flags React 19 shorthand via `React.createContext` namespace import", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import * as React from "react";

      const Ctx = React.createContext(null);

      function App() {
        return <Ctx value={{ a: 1 }} />;
      }
    `,
      { filename: "fixture.jsx" },
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an imported React 19 context shorthand", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import { AccordionExpansionContext } from "./context";

      function Accordion({ expandedKeys, onToggle, registerItemKey }) {
        return (
          <AccordionExpansionContext
            value={{ expandedKeys, onToggle, registerItemKey }}
          />
        );
      }
    `,
      { filename: "Accordion.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a renamed imported React 19 context shorthand", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import { AccordionExpansionContext as ExpansionProvider } from "./context";

      function Accordion({ value }) {
        return <ExpansionProvider value={{ value }} />;
      }
    `,
      { filename: "Accordion.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a primitive value on the React 19 shorthand", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import { createContext } from "react";

      const Ctx = createContext(null);

      function App({ mode }) {
        return <Ctx value={mode} />;
      }
    `,
      { filename: "fixture.jsx" },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag JSX whose name is not a createContext binding", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import { Component } from "./some-component";

      function App() {
        return <Component value={{ a: 1 }} />;
      }
    `,
      { filename: "fixture.jsx" },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an ordinary imported component with a value prop", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import { ValuePanel } from "./value-panel";

      function App() {
        return <ValuePanel value={{ a: 1 }} />;
      }
    `,
      { filename: "fixture.jsx" },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not infer a context from an imported component name alone", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import { UserContext } from "./components";

      function App() {
        return <UserContext value={{ a: 1 }} />;
      }
    `,
      { filename: "fixture.jsx" },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an imported context shadowed by a prop", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import { ThemeContext } from "./context";

      function App({ ThemeContext }) {
        return <ThemeContext value={{ a: 1 }} />;
      }
    `,
      { filename: "fixture.jsx" },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag the React 19 shorthand outside a render function", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import { createContext } from "react";

      const Ctx = createContext(null);
      const tree = <Ctx value={{ a: 1 }} />;
    `,
      { filename: "fixture.jsx" },
    );

    expect(result.diagnostics).toEqual([]);
  });

  // Rule-level coverage for the commercelayer miss report: these
  // legacy `.Provider` shapes DO fire here. The scan-level silence in
  // that repo came from `disabledBy: ["react-compiler"]` (the package
  // ships babel-plugin-react-compiler), not from the detector.
  it("flags an object literal mixing spread and shorthand members in a Provider value", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import OrderStorageContext from "#context/OrderStorageContext";

      export function OrderStorage(props) {
        const { children, ...p } = props;
        const setLocalOrder = () => {};
        return (
          <OrderStorageContext.Provider value={{ ...p, setLocalOrder }}>
            {children}
          </OrderStorageContext.Provider>
        );
      }
    `,
      { filename: "OrderStorage.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a spread-only object literal in a Provider value", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import CommerceLayerContext from "#context/CommerceLayerContext";

      export function CommerceLayer(props) {
        const { children, ...p } = props;
        return (
          <CommerceLayerContext.Provider value={{ ...p }}>
            {children}
          </CommerceLayerContext.Provider>
        );
      }
    `,
      { filename: "CommerceLayer.tsx" },
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when a prop shadows the context binding name", () => {
    const result = runRule(
      jsxNoConstructedContextValues,
      `
      import { createContext } from "react";

      const Ctx = createContext(null);

      function App({ Ctx }) {
        return <Ctx value={{ a: 1 }} />;
      }
    `,
      { filename: "fixture.jsx" },
    );

    expect(result.diagnostics).toEqual([]);
  });
});
