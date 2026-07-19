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

  it("flags a hoisted local function declaration passed as the value", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const DispatchContext = createContext(null);
      function App({ children }) {
        function dispatch(action) { console.log(action); }
        return <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a memo-wrapped component's render-local literal", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext, memo } from "react";
      const ThemeContext = createContext(null);
      const App = memo(({ theme, children }) => {
        const value = { theme };
        return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
      });
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a destructured-prop parameter default (lobe-ui `{ config = {} }` idiom)", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const ConfigContext = createContext(null);
      function App({ config = {}, children }) {
        return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a per-item value inside a .map() render-loop callback (SegmentedControl idiom)", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const ItemContext = createContext(null);
      function List({ items }) {
        return items.map((item) => {
          const itemValue = { item, select: () => {} };
          return <ItemContext.Provider value={itemValue} key={item.id}>{item.label}</ItemContext.Provider>;
        });
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a value allocated once in an outer factory/HOC closure (createStore idiom)", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const StoreContext = createContext(null);
      const createStoreProvider = (initialState) => {
        const store = { state: initialState, listeners: [] };
        const Provider = ({ children }) =>
          <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
        return Provider;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a value built inside a useMemo callback that returns the Provider element", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext, useMemo } from "react";
      const ThemeContext = createContext(null);
      function App({ theme, children }) {
        return useMemo(() => {
          const value = { theme };
          return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
        }, [theme, children]);
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "useMemo",
      `return useMemo(function Build() {
         const value = { theme };
         return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
       }, [theme, children]);`,
    ],
    [
      "map",
      `return items.map(function Item(item) {
         const value = { item };
         return <ThemeContext.Provider value={value}>{item.label}</ThemeContext.Provider>;
       });`,
    ],
  ])("does not treat a named %s callback as a component", (_name, body) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext, useMemo } from "react";
       const ThemeContext = createContext(null);
       function App({ theme, children, items }) {
         ${body}
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "useMemo",
      `const Build = () => {
         const value = { theme };
         return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
       };
       return useMemo(Build, []);`,
    ],
    [
      "map",
      `function Item(item) {
         const value = { item };
         return <ThemeContext.Provider value={value}>{item.label}</ThemeContext.Provider>;
       }
       return items.map(Item);`,
    ],
  ])("does not treat a hoisted %s callback as a component", (_name, body) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext, useMemo } from "react";
       const ThemeContext = createContext(null);
       function App({ theme, children, items }) {
         ${body}
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a component binding passed to React memo", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext, memo } from "react";
       const ThemeContext = createContext(null);
       const App = () => {
         const value = {};
         return <ThemeContext.Provider value={value} />;
       };
       export default memo(App);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an IIFE passed through React createElement props children", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import React, { createContext } from "react";
       const ThemeContext = createContext(null);
       function App() {
         return React.createElement(React.Fragment, { children: (() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         })() });
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a named IIFE that constructs a local provider value during render", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function App() {
         return (function Inner() {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         })();
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "an anonymous IIFE",
      `function App() {
         return (() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         })();
       }`,
    ],
    [
      "an anonymous callback passed to a synchronous renderer",
      `const renderNow = (render) => render();
       function App() {
         return renderNow(() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         });
       }`,
    ],
    [
      "a named callback passed to a synchronous renderer",
      `const renderNow = (render) => render();
       function App() {
         return renderNow(function Inner() {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         });
       }`,
    ],
  ])("flags %s during render", (_name, body) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       ${body}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a synchronous callback result returned inside JSX", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const renderNow = (render) => render();
       function App() {
         return <>{renderNow(() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         })}</>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["anonymous", "() =>"],
    ["named", "function Inner()"],
  ])("does not flag a %s callback whose result is discarded by its helper", (_name, callback) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const inspect = (render) => {
         render();
         return null;
       };
       function App() {
         return inspect(${callback} {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         });
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a callback when the component discards the helper result", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const renderNow = (render) => render();
       function App() {
         renderNow(() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         });
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["an IIFE", "(() => {", "})()"],
    ["a synchronous renderer", "renderNow(() => {", "})"],
  ])("flags %s passed through a React createElement child", (_name, opening, closing) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import React, { createContext } from "react";
       const ThemeContext = createContext(null);
       const renderNow = (render) => render();
       function App() {
         return React.createElement(React.Fragment, null, ${opening}
           const value = {};
           return <ThemeContext.Provider value={value} />;
         ${closing});
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an IIFE result referenced by a local JSX child", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function App() {
         const child = (() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         })();
         return <>{child}</>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not follow a reassigned local JSX child to its initializer", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function App() {
         let child = (() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         })();
         child = null;
         return <>{child}</>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an IIFE nested in a spread React output array", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function App() {
         return [...[(() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         })()]];
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["truthy or", "true ||"],
    ["falsy and", "false &&"],
    ["non-nullish coalescing", "'stable' ??"],
  ])("ignores an IIFE in a statically dead %s branch", (_name, operator) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function App() {
         return <>{${operator} (() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         })()}</>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores an IIFE in a statically dead conditional branch", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function App() {
         return <>{true ? null : (() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         })()}</>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["anonymous", "(() => {"],
    ["named", "(function Inner() {"],
  ])("does not flag a discarded %s IIFE result", (_name, opening) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function App() {
         ${opening}
           const value = {};
           return <ThemeContext.Provider value={value} />;
         })();
         return null;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "an anonymous module initializer",
      `(() => {
         const value = {};
         return <ThemeContext.Provider value={value} />;
       })();`,
    ],
    [
      "an anonymous callback passed to a conditional renderer",
      `const renderMaybe = (render) => shouldRender ? render() : null;
       function App() {
         return renderMaybe(() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         });
       }`,
    ],
  ])("does not flag %s", (_name, body) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       ${body}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a nested component passed to a custom synchronous renderer", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const renderNow = (render) => render();
       function App() {
         function Inner() {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         }
         return renderNow(Inner);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["unknown registration helper", "const register = (render) => callbacks.push(render);"],
    ["conditional renderer", "const register = (render) => shouldRender ? render() : null;"],
  ])("does not assume a %s invokes its component argument", (_name, helperDeclaration) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       ${helperDeclaration}
       function App() {
         function Inner() {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         }
         return register(Inner);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a block-scoped literal declared inside the component's own if-block", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `
      import { createContext } from "react";
      const ThemeContext = createContext(null);
      function App({ theme, children }) {
        if (theme) {
          const value = { theme };
          return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
        }
        return children;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("does not flag a catch-parameter shadow of a context binding", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function App() {
         try {
           throw FakeContext;
         } catch (ThemeContext) {
           const value = {};
           return <ThemeContext value={value} />;
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a local value reassigned before the provider reads it", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = { theme: "dark" };
       function App() {
         let value = {};
         value = STABLE_VALUE;
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a fresh value assigned before the provider reads it", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = { theme: "dark" };
       function App() {
         let value = STABLE_VALUE;
         value = { theme: "light" };
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a fresh value assigned by a synchronously invoked helper", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = { theme: "dark" };
       function App() {
         let value = STABLE_VALUE;
         function update() {
           value = { theme: "light" };
         }
         update();
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the final fresh write through a wrapped helper alias", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = { theme: "dark" };
       function App() {
         let value = STABLE_VALUE;
         function update() {
           value = STABLE_VALUE;
           value = { theme: "light" };
         }
         const applyUpdate = update;
         (applyUpdate as () => void)();
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags writes through hoisted nested helpers declared after the provider", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = { theme: "dark" };
       function App() {
         let value = STABLE_VALUE;
         outer();
         const provider = <ThemeContext.Provider value={value} />;
         return provider;
         function outer() {
           update();
         }
         function update() {
           value = { theme: "light" };
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores an unreachable fresh write after a helper returns", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = { theme: "dark" };
       function App() {
         let value = STABLE_VALUE;
         function update() {
           return;
           value = { theme: "light" };
         }
         update();
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses the final reachable write before a helper returns", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = { theme: "dark" };
       function App() {
         let value = STABLE_VALUE;
         function update() {
           value = { theme: "light" };
           return;
           value = STABLE_VALUE;
         }
         update();
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores fresh writes that execute only at module initialization", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       let value = { stable: true };
       value = { alsoStable: true };
       function App() {
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag fresh writes when a later proven write is stable", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = { theme: "dark" };
       function App() {
         let value = STABLE_VALUE;
         value = { theme: "light" };
         value = STABLE_VALUE;
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a helper whose final write is stable", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = { theme: "dark" };
       function App() {
         let value = STABLE_VALUE;
         function update() {
           value = { theme: "light" };
           value = STABLE_VALUE;
         }
         update();
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["conditional", "if (shouldUpdate) value = { theme: 'light' };"],
    ["compound", "value ||= { theme: 'light' };"],
    ["destructured", "({ value } = source);"],
  ])("does not treat a %s write as a proven fresh value", (_name, updateCode) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = { theme: "dark" };
       function App({ shouldUpdate, source }) {
         let value = STABLE_VALUE;
         ${updateCode}
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores a fresh write after the provider read", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = { theme: "dark" };
       function App() {
         let value = STABLE_VALUE;
         const provider = <ThemeContext.Provider value={value} />;
         value = { theme: "light" };
         return provider;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a fresh local value read before a later reassignment", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = { theme: "dark" };
       function App() {
         let value = {};
         const provider = <ThemeContext.Provider value={value} />;
         value = STABLE_VALUE;
         return provider;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a fresh var value after a no-op redeclaration", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function App() {
         var value = {};
         var value;
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses the last initializer that executes before the provider read", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = {};
       function App() {
         var value = {};
         const provider = <ThemeContext.Provider value={value} />;
         var value = STABLE_VALUE;
         return provider;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not use an initializer that executes after the provider read", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function App() {
         var value;
         const provider = <ThemeContext.Provider value={value} />;
         var value = {};
         return provider;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a conditional var initializer as a proven fresh value", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = {};
       function App({ shouldUseFreshValue }) {
         var value = STABLE_VALUE;
         if (shouldUseFreshValue) var value = {};
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat writes after await as synchronous render-time writes", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = {};
       function App() {
         let value = {};
         async function update() {
           await ping();
           value = STABLE_VALUE;
         }
         update();
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does treat an unconditional write before await as synchronous", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = {};
       function App() {
         let value = {};
         async function update() {
           value = STABLE_VALUE;
           await ping();
         }
         update();
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "conditional invocation",
      `function update() { value = STABLE_VALUE; }
       if (shouldUpdate) update();`,
    ],
    [
      "conditional write",
      `function update() { if (shouldUpdate) value = STABLE_VALUE; }
       update();`,
    ],
    ["direct conditional write", `if (shouldUpdate) value = STABLE_VALUE;`],
  ])("does not treat a %s as a proven write", (_name, updateCode) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const STABLE_VALUE = {};
       function App({ shouldUpdate }) {
         let value = {};
         ${updateCode}
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a local React-shaped object as React", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `const React = { createContext: () => FakeContext };
       const ThemeContext = React.createContext(null);
       function App() {
         const value = {};
         return <ThemeContext value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "a named API alias",
      `import { createContext } from "react";
       const makeContext = createContext;
       const ThemeContext = makeContext(null);`,
    ],
    [
      "namespace destructuring",
      `import * as React from "react";
       const { createContext: makeContext } = React;
       const ThemeContext = makeContext(null);`,
    ],
    [
      "static computed access",
      `import * as React from "react";
       const ThemeContext = React["createContext"](null);`,
    ],
    [
      "the React default import",
      `import React from "react";
       const ThemeContext = React.createContext(null);`,
    ],
  ])("flags a context created through %s", (_name, declaration) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `${declaration}
       function App() {
         const value = {};
         return <ThemeContext value={value} />;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an arbitrary named React import as a namespace", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { memo as Factory } from "react";
       const ThemeContext = Factory.createContext(null);
       function App() {
         const value = {};
         return <ThemeContext value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a reassigned context binding", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       let ThemeContext = createContext(null);
       ThemeContext = FakeContext;
       function App() {
         const value = {};
         return <ThemeContext value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an unrelated Provider component", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `function App() {
         const value = {};
         return <Fake.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a context imported under a context-shaped name", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { ThemeContext } from "./theme-context";
       function App() {
         const value = {};
         return <ThemeContext.Provider value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not assume a bare imported context-shaped name is a React 19 provider", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { ThemeContext } from "./theme-context";
       function App() {
         const value = {};
         return <ThemeContext value={value} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a redeclared var as a proven context binding", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       var ThemeContext = createContext(null);
       var ThemeContext = FakeContext;
       function App() {
         const value = {};
         return <ThemeContext value={value} />;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an anonymous default-export component", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       export default () => {
         const value = {};
         return <ThemeContext.Provider value={value} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an anonymous default-exported HOC component", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext, memo } from "react";
       const ThemeContext = createContext(null);
       export default memo(() => {
         const value = {};
         return <ThemeContext.Provider value={value} />;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a component initializer wrapped in a TypeScript expression", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       const App = (() => {
         const value = {};
         return <ThemeContext.Provider value={value} />;
       }) as React.FC;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag render helpers in testlike files", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function TestProvider() {
         const value = {};
         return <ThemeContext.Provider value={value} />;
       }`,
      { filename: "/repo/src/__tests__/theme-provider.test.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("is disabled on React Compiler projects", () => {
    expect(contextProviderValueFromUnmemoizedLocalLiteral.disabledWhen).toContain("react-compiler");
  });
});
