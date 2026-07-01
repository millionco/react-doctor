import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { contextProviderValueFromUnmemoizedLocalLiteral } from "./context-provider-value-from-unmemoized-local-literal.js";

describe("context-provider-value-from-unmemoized-local-literal", () => {
  it("flags a one-hop object literal on a legacy Provider", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const ThemeContext = createContext(null);
      function App({ theme }) {
        const value = { theme };
        return <ThemeContext.Provider value={value}><Child /></ThemeContext.Provider>;
      }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a one-hop array literal", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const ListContext = createContext(null);
      function App({ items }) {
        const value = [...items];
        return <ListContext.Provider value={value} />;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a one-hop arrow/function literal", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const CbContext = createContext(null);
      function App() {
        const value = () => {};
        return <CbContext.Provider value={value} />;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the React 19 provider shorthand", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const ThemeContext = createContext(null);
      function App({ theme }) {
        const value = { theme };
        return <ThemeContext value={value}><Child /></ThemeContext>;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a value bound to useMemo", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext, useMemo } from "react";
      const ThemeContext = createContext(null);
      function App({ theme }) {
        const value = useMemo(() => ({ theme }), [theme]);
        return <ThemeContext.Provider value={value} />;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a value bound to useCallback/useState/useRef", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext, useCallback } from "react";
      const CbContext = createContext(null);
      function App() {
        const value = useCallback(() => {}, []);
        return <CbContext.Provider value={value} />;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a destructured prop", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const ThemeContext = createContext(null);
      function App({ value }) {
        return <ThemeContext.Provider value={value} />;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a member/optional-chain initializer", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const ThemeContext = createContext(null);
      function App({ section }) {
        const value = section?.edges;
        return <ThemeContext.Provider value={value} />;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a module-scope literal const", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const ThemeContext = createContext(null);
      const value = { theme: "dark" };
      function App() {
        return <ThemeContext.Provider value={value} />;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an inline literal value (owned by jsx-no-constructed-context-values)", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const ThemeContext = createContext(null);
      function App({ theme }) {
        return <ThemeContext.Provider value={{ theme }} />;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a Provider outside any component (module scope)", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const ThemeContext = createContext(null);
      const value = { theme: "dark" };
      const element = <ThemeContext.Provider value={value} />;
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag inside a test file (test-noise)", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const DatabaseContext = createContext(null);
      function wrapper({ children }) {
        const contextValue = { db, view };
        return <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>;
      }
    `,
      { filename: "src/__tests__/useGroup.test.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the shorthand when the name is a local shadow, not a context", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      function App() {
        const Wrapper = (props) => props.children;
        const value = { a: 1 };
        return <Wrapper value={value} />;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
