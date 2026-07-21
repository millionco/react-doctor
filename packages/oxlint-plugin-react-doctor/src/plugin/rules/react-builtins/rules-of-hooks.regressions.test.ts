import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clearRulesOfHooksSuppressionCache } from "./rules-of-hooks-suppression.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const runTsx = (code: string) => runRule(rulesOfHooks, code, { filename: "fixture.tsx" });

describe("react-builtins/rules-of-hooks — invariant React capability guards", () => {
  it("stays silent after the authentic named-import capability guard", () => {
    const result = runTsx(`
      import { useContext, useEffect, useRef, useState } from "react";
      const Context = createContext(null);
      export const Dialog = ({ visible }) => {
        if (!useState || !useRef || !useEffect) {
          warn("need react version > 16.8.0");
          return null;
        }
        const [open] = useState(visible);
        const dialogRef = useRef(null);
        const context = useContext(Context);
        useEffect(() => context.track(dialogRef.current), [context]);
        return open ? <div ref={dialogRef} /> : null;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent after renamed, namespaced, and immutable-alias capability guards", () => {
    const result = runTsx(`
      import * as ReactRuntime from "react";
      import { useEffect as importedEffect, useState } from "react";
      const stateCapability = ReactRuntime.useState;
      const effectCapability = importedEffect;
      export const Panel = () => {
        if (!(stateCapability as typeof useState) || typeof effectCapability !== "function") {
          return null;
        }
        const [value] = useState(0);
        ReactRuntime.useEffect(() => consume(value), [value]);
        return <div>{value}</div>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "static-computed namespace member",
      declaration: 'import * as ReactRuntime from "react";',
      guard: 'if (ReactRuntime["useState"] == null) return null;',
      call: "ReactRuntime.useState(0)",
    },
    {
      name: "namespace alias",
      declaration: 'import * as ReactRuntime from "react"; const RuntimeAlias = ReactRuntime;',
      guard: 'if (typeof RuntimeAlias.useState === "undefined") return null;',
      call: "RuntimeAlias.useState(0)",
    },
    {
      name: "destructured namespace capability alias",
      declaration:
        'import * as ReactRuntime from "react"; const { useState: stateCapability } = ReactRuntime;',
      guard: "if (!stateCapability) return null;",
      call: "ReactRuntime.useState(0)",
    },
  ])("stays silent after a $name guard", ({ declaration, guard, call }) => {
    const result = runTsx(`
      ${declaration}
      export const Panel = () => {
        ${guard}
        const [value] = ${call};
        return <div>{value}</div>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "prop guard",
      guard: "if (!enabled) return null;",
      parameter: "{ enabled }",
    },
    {
      name: "mixed React and prop guard",
      guard: "if (!useState || !enabled) return null;",
      parameter: "{ enabled }",
    },
    {
      name: "mutable local alias",
      guard: "let capability = useState; if (!capability) return null;",
      parameter: "{}",
    },
    {
      name: "userland capability getter",
      guard: "if (!capabilities.useState) return null;",
      parameter: "{ capabilities }",
    },
  ])("still reports after a $name", ({ guard, parameter }) => {
    const result = runTsx(`
      import { useState } from "react";
      export const Panel = (${parameter}) => {
        ${guard}
        const [value] = useState(0);
        return <div>{value}</div>;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
    );
  });

  it("still reports a later prop-dependent early return", () => {
    const result = runTsx(`
      import { useEffect, useState } from "react";
      export const Panel = ({ enabled }) => {
        if (!useState || !useEffect) return null;
        if (!enabled) return null;
        const [value] = useState(0);
        useEffect(() => consume(value), [value]);
        return <div>{value}</div>;
      };
    `);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("still reports a Hook nested under render-varying control flow after the capability guard", () => {
    const result = runTsx(`
      import { useState } from "react";
      export const Panel = ({ enabled }) => {
        if (!useState) return null;
        if (enabled) {
          const [value] = useState(0);
          return <div>{value}</div>;
        }
        return null;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports after a similarly named userland import guard", () => {
    const result = runTsx(`
      import { useState } from "./mutable-runtime";
      export const Panel = () => {
        if (!useState) return null;
        const [value] = useState(0);
        return <div>{value}</div>;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when global undefined is shadowed", () => {
    const result = runTsx(`
      import { useState } from "react";
      export const Panel = ({ undefined }) => {
        if (useState === undefined) return null;
        const [value] = useState(0);
        return <div>{value}</div>;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "namespace Hook property is reassigned",
      setup: "ReactRuntime.useState = replacementHook;",
    },
    {
      name: "namespace object escapes to unknown code",
      setup: "installRuntime(ReactRuntime);",
    },
    {
      name: "namespace has a dynamic property write",
      setup: "ReactRuntime[capabilityName] = replacementHook;",
    },
  ])("still reports when the $name", ({ setup }) => {
    const result = runTsx(`
      import ReactRuntime from "react";
      ${setup}
      export const Panel = () => {
        if (!ReactRuntime.useState) return null;
        const [value] = ReactRuntime.useState(0);
        return <div>{value}</div>;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a short-circuited Hook after the capability guard", () => {
    const result = runTsx(`
      import { useState } from "react";
      export const Panel = ({ enabled }) => {
        if (!useState) return null;
        enabled && useState(0);
        return null;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("react-builtins/rules-of-hooks — regressions: TypeScript-wrapped Hook receivers", () => {
  it.each([
    {
      name: "as expression",
      call: "(React as any).useEffect(() => {}, [])",
    },
    {
      name: "non-null expression",
      call: "React!.useEffect(() => {}, [])",
    },
    {
      name: "satisfies expression",
      call: "(React satisfies typeof React).useEffect(() => {}, [])",
    },
  ])("still reports a module-level Hook call through a $name", ({ call }) => {
    const result = runTsx(`
      const React = require("react");
      ${call};
    `);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("react-builtins/rules-of-hooks — regressions: HoC callbacks under non-PascalCase bindings", () => {
  it("does not flag hooks in a forwardRef callback bound to an underscore-prefixed name", () => {
    const result = runTsx(`
      import { forwardRef, useState } from "react";
      const _Wrapped = forwardRef((props, ref) => {
        const [value] = useState(0);
        return <div ref={ref}>{value}</div>;
      });
      export const Wrapped = _Wrapped;
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag hooks in a memo callback bound to an underscore-prefixed name", () => {
    const result = runTsx(`
      import { memo, useState } from "react";
      const _Memoized = memo(function (props) {
        const [value] = useState(0);
        return <span>{value}</span>;
      });
      export const Memoized = _Memoized;
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag hooks in a React.forwardRef callback assigned to a lowercase binding", () => {
    const result = runTsx(`
      import * as React from "react";
      const _wrapped = React.forwardRef((props, ref) => {
        React.useEffect(() => {}, []);
        return <div ref={ref} />;
      });
      export default _wrapped;
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag hooks in a forwardRef callback inside memo(forwardRef(...))", () => {
    const result = runTsx(`
      import { memo, forwardRef, useState } from "react";
      const _Wrapped = memo(
        forwardRef((props, ref) => {
          const [value] = useState(0);
          return <div ref={ref}>{value}</div>;
        }),
      );
      export const Wrapped = _Wrapped;
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags hooks in a non-component underscore-prefixed function", () => {
    const result = runTsx(`
      import { useState } from "react";
      const _helper = () => {
        const [value] = useState(0);
        return value;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "`useState` runs inside `_helper`, which is not a component or Hook, so React cannot attach Hook state to a render.",
    );
  });

  it("still flags hooks in a named callback passed to an arbitrary non-React HoC", () => {
    const result = runTsx(`
      import { useState } from "react";
      const _wrapped = trackEvents(function _process() {
        const [value] = useState(0);
        return value;
      });
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "`useState` runs inside `_process`, which is not a component or Hook, so React cannot attach Hook state to a render.",
    );
  });

  it("does not flag hooks in a context-factory `init` callback that issues several hooks", () => {
    const result = runTsx(`
      const FileContext = createSimpleContext({
        name: "File",
        init: () => {
          const sdk = useSDK();
          useSync();
          const params = useParams();
          return { sdk, params };
        },
      });
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag hooks in a create*-named factory that issues several hooks", () => {
    const result = runTsx(`
      export function createSessionComposerState(initial) {
        const params = useParams();
        const sdk = useSDK();
        return { params, sdk };
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a single hook in a non-component named helper", () => {
    const result = runTsx(`
      import { useState } from "react";
      function calculateTotal() {
        const [value] = useState(0);
        return value;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags conditional hooks inside a multi-hook factory body", () => {
    const result = runTsx(`
      export function createThing(cond) {
        const params = useParams();
        if (cond) {
          const sdk = useSDK();
          return sdk;
        }
        return params;
      }
    `);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("still flags hooks in a memo props comparator (second argument is not a render callback)", () => {
    const result = runTsx(`
      import { memo, useState } from "react";
      const _Memoized = memo(
        (props) => <span>{props.value}</span>,
        (previousProps, nextProps) => {
          const [shouldSkip] = useState(false);
          return shouldSkip;
        },
      );
      export const Memoized = _Memoized;
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "`useState` runs inside `_Memoized`, which is not a component or Hook, so React cannot attach Hook state to a render.",
    );
  });
});

describe("react-builtins/rules-of-hooks — regressions: use() under the render-scope escape", () => {
  // The multi-hook render-scope escape must cover the React 19 `use()`
  // branch too: a `create*` factory that issues several hook calls is a
  // render scope for `use(...)` just like for conventional hooks.
  it("does not flag use() in a multi-hook factory function", () => {
    const result = runTsx(`
      import { use, useRef } from "react";
      function createEditorState(promise) {
        const stateRef = useRef(null);
        const data = use(promise);
        return { stateRef, data };
      }
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags use() in a plain single-hook named function", () => {
    const result = runTsx(`
      import { use } from "react";
      function readValue(promise) {
        return use(promise);
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("react-builtins/rules-of-hooks — regressions: render-scope escape stays factory-shaped", () => {
  it("flags both hooks in a module-level named event-handler helper", () => {
    const result = runTsx(`
      import { useState, useEffect } from "react";
      function handleClick() {
        const [value, setValue] = useState(0);
        useEffect(() => {}, []);
      }
    `);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.message).toBe(
      "`useState` runs inside `handleClick`, which is not a component or Hook, so React cannot attach Hook state to a render.",
    );
    expect(result.diagnostics[1]?.message).toBe(
      "`useEffect` runs inside `handleClick`, which is not a component or Hook, so React cannot attach Hook state to a render.",
    );
  });

  it("flags useRef and use() in a non-factory helper that mixes both", () => {
    const result = runTsx(`
      import { use, useRef } from "react";
      function fetchData(promise) {
        const ref = useRef(null);
        return use(promise);
      }
    `);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags both hooks in a named handler nested inside a component", () => {
    const result = runTsx(`
      import { useState, useEffect } from "react";
      function MyComponent() {
        function handleClick() {
          const [value, setValue] = useState(0);
          useEffect(() => {}, []);
        }
        return <button onClick={handleClick} />;
      }
    `);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("denies the escape to a create*-named factory nested inside a component", () => {
    const result = runTsx(`
      import { useState, useEffect } from "react";
      function MyComponent() {
        function createHandlers() {
          const [value, setValue] = useState(0);
          useEffect(() => {}, []);
        }
        return <button onClick={createHandlers} />;
      }
    `);
    expect(result.diagnostics).toHaveLength(2);
  });
});

describe("react-builtins/rules-of-hooks — regressions: local non-hook use* callees", () => {
  it("does not flag a local useKeyword codegen helper called from named helpers (ajv shape)", () => {
    const result = runTsx(`
      function useKeyword(gen, keyword, result) {
        return gen.scopeValue("keyword", { ref: keyword, result });
      }
      function macroKeywordCode(cxt, def) {
        const { gen, keyword, schema, parentSchema, it } = cxt;
        const macroSchema = def.macro.call(it.self, schema, parentSchema, it);
        const schemaRef = useKeyword(gen, keyword, macroSchema);
        return schemaRef;
      }
      function funcKeywordCode(cxt, def) {
        const { gen, keyword } = cxt;
        const validateRef = useKeyword(gen, keyword, def.validate);
        return validateRef;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  // A local use*-named non-hook helper call must not count toward the
  // render-scope threshold: one real hook + one `useKeyword(...)` call
  // is NOT a multi-hook factory, so the real hook stays reported.
  it("still flags the real hook in a create*-factory padded by a local use* helper call", () => {
    const result = runTsx(`
      import { useState } from "react";
      function useKeyword(name) {
        return name.toUpperCase();
      }
      function createValidator(name) {
        const [state] = useState(null);
        const keyword = useKeyword(name);
        return { state, keyword };
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "`useState` runs inside `createValidator`, which is not a component or Hook, so React cannot attach Hook state to a render.",
    );
  });

  it("still flags a local custom hook whose body calls hooks when used from a helper", () => {
    const result = runTsx(`
      import { useState } from "react";
      function useCounter() {
        const [count] = useState(0);
        return count;
      }
      function calculateTotal() {
        return useCounter();
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      "`useCounter` runs inside `calculateTotal`, which is not a component or Hook, so React cannot attach Hook state to a render.",
    );
  });

  it("does not flag hooks inside an anonymous inline callback with no resolved name", () => {
    const result = runTsx(`
      import { use } from "react";
      register(() => {
        const value = use(somePromise);
        return value;
      });
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags hooks inside a named non-component function", () => {
    const result = runTsx(`
      import { useState } from "react";
      function calculateTotal() {
        const [value] = useState(0);
        return value;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a hook call in a ternary test position as conditional", () => {
    const result = runTsx(`
      import { useFlag, useState } from "./flags";
      const MyComponent = () => {
        const label = useFlag("beta") ? "beta" : "stable";
        return label;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a hook call in a ternary branch position", () => {
    const result = runTsx(`
      import { useState } from "react";
      const MyComponent = ({ enabled }) => {
        const value = enabled ? useState(0)[0] : 0;
        return value;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a hook call on a logical left side as conditional", () => {
    const result = runTsx(`
      import { useFlag } from "./flags";
      const MyComponent = () => {
        const isReady = useFlag("ready") && hasData();
        return isReady;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["&&", "||", "??"])("still flags a hook call on the right side of %s", (operator) => {
    const result = runTsx(`
        import { useFlag } from "./flags";
        const MyComponent = ({ enabled }) => {
          const value = enabled ${operator} useFlag("ready");
          return value;
        };
      `);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("react-builtins/rules-of-hooks — regressions: same-named non-React useEffectEvent", () => {
  it("does not flag a useEffectEvent imported from a non-React package passed as a prop", () => {
    const result = runTsx(`
      import { useEffectEvent } from "@rocket.chat/fuselage-hooks";
      const MyComponent = ({ onDone }) => {
        const handleChange = useEffectEvent(() => onDone());
        return <Child onChange={handleChange} />;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a non-React useEffectEvent stored in a variable and referenced later", () => {
    const result = runTsx(`
      import { useEffectEvent } from "@rocket.chat/fuselage-hooks";
      const MyComponent = ({ value }) => {
        const handler = useEffectEvent(() => value);
        const wrapped = handler;
        return <button onClick={wrapped}>go</button>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags React's useEffectEvent when passed around", () => {
    const result = runTsx(`
      import { useEffectEvent } from "react";
      const MyComponent = ({ onDone }) => {
        const handleChange = useEffectEvent(() => onDone());
        return <Child onChange={handleChange} />;
      };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a renamed React useEffectEvent import when passed around", () => {
    const result = runTsx(`
      import { useEffectEvent as useStableEvent } from "react";
      const MyComponent = ({ onDone }) => {
        const handleChange = useStableEvent(() => onDone());
        return <Child onChange={handleChange} />;
      };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags useEffectEvent from a wrapped React namespace when passed around", () => {
    const result = runTsx(`
      import * as React from "react";
      const MyComponent = ({ onDone }) => {
        const handleChange = (React as typeof React).useEffectEvent(() => onDone());
        return <Child onChange={handleChange} />;
      };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags useEffectEvent through an immutable React namespace alias", () => {
    const result = runTsx(`
      import * as React from "react";
      const ReactAlias = React;
      const MyComponent = ({ onDone }) => {
        const handleChange = ReactAlias.useEffectEvent(() => onDone());
        return <Child onChange={handleChange} />;
      };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a bare/unimported useEffectEvent when passed around (parity)", () => {
    const result = runTsx(`
      const MyComponent = ({ onDone }) => {
        const handleChange = useEffectEvent(() => onDone());
        return <Child onChange={handleChange} />;
      };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag a useEffectEvent polyfill DEFINED in the same module (floating-ui shape) whose result is passed as a prop", () => {
    const result = runTsx(`
      import * as React from "react";
      function useEffectEvent(callback) {
        const ref = React.useRef(callback);
        React.useInsertionEffect(() => {
          ref.current = callback;
        });
        return React.useCallback((...args) => ref.current?.(...args), []);
      }
      const MyComponent = ({ onDone }) => {
        const handleChange = useEffectEvent(() => onDone());
        return <Child onChange={handleChange} />;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a const-bound local useEffectEvent polyfill whose result is returned from a custom hook", () => {
    const result = runTsx(`
      import { useCallback, useRef } from "react";
      const useEffectEvent = (callback) => {
        const ref = useRef(callback);
        ref.current = callback;
        return useCallback((...args) => ref.current(...args), []);
      };
      const useStableHandler = (handler) => {
        return useEffectEvent(handler);
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags React's useEffectEvent result called outside an effect even when a polyfill exists elsewhere", () => {
    const result = runTsx(`
      import { useEffectEvent } from "react";
      const MyComponent = ({ onDone }) => {
        const handleChange = useEffectEvent(() => onDone());
        const wrapped = handleChange;
        return <button onClick={wrapped}>go</button>;
      };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // fuzz edge-case wave: the polyfill origin spelled as a member access —
  // `FloatingUI.useEffectEvent(...)` through a namespace imported from a
  // non-React package carries stable-callback semantics too.
  it("does not flag a namespace-imported polyfill (FloatingUI.useEffectEvent) result passed as a prop", () => {
    const result = runTsx(`
      import * as FloatingUI from "@floating-ui/react/utils";
      const MyComponent = ({ onDone }) => {
        const handleChange = FloatingUI.useEffectEvent(() => onDone());
        return <Child onChange={handleChange} />;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a namespace-imported polyfill call passed inline as a prop", () => {
    const result = runTsx(`
      import * as FloatingUI from "@floating-ui/react/utils";
      const MyComponent = ({ onDone }) => {
        return <Child onChange={FloatingUI.useEffectEvent(() => onDone())} />;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags React.useEffectEvent through the React namespace when passed around", () => {
    const result = runTsx(`
      import * as React from "react";
      const MyComponent = ({ onDone }) => {
        const handleChange = React.useEffectEvent(() => onDone());
        return <Child onChange={handleChange} />;
      };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag a hoisted function-declaration polyfill defined BELOW the component", () => {
    const result = runTsx(`
      import { useCallback, useRef } from "react";
      const MyComponent = ({ onDone }) => {
        const handleChange = useEffectEvent(() => onDone());
        return <Child onChange={handleChange} />;
      };
      function useEffectEvent(callback) {
        const ref = useRef(callback);
        ref.current = callback;
        return useCallback((...args) => ref.current(...args), []);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a component-local shadow even when React's useEffectEvent is imported", () => {
    const result = runTsx(`
      import { useEffectEvent } from "react";
      import { makePolyfill } from "./make-polyfill";
      const MyComponent = ({ onDone }) => {
        const useEffectEvent = makePolyfill();
        const handleChange = useEffectEvent(() => onDone());
        return <Child onChange={handleChange} />;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("react-builtins/rules-of-hooks — regressions: underscore-prefixed component bindings", () => {
  it("does not flag hooks in an underscore-prefixed component exported under an alias", () => {
    const result = runTsx(`
      import { useState } from "react";
      const _Calendar = (props) => {
        const [month] = useState(0);
        return <div>{month}</div>;
      };
      export { _Calendar as Calendar };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag hooks in an underscore-prefixed function declaration component", () => {
    const result = runTsx(`
      import { useEffect } from "react";
      function _Menu(props) {
        useEffect(() => {}, []);
        return <ul>{props.children}</ul>;
      }
      export const Menu = _Menu;
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags hooks in an underscore-prefixed lowercase helper", () => {
    const result = runTsx(`
      import { useState } from "react";
      const _computeLayout = () => {
        const [value] = useState(0);
        return value;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags conditional hooks inside an underscore-prefixed component", () => {
    const result = runTsx(`
      import { useState } from "react";
      const _Calendar = ({ visible }) => {
        if (visible) {
          const [month] = useState(0);
          return <div>{month}</div>;
        }
        return null;
      };
      export { _Calendar as Calendar };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("react-builtins/rules-of-hooks — regressions: plugin-registration .use([...]) calls", () => {
  it("does not flag SwiperCore.use([...]) at module top level", () => {
    const result = runTsx(`
      import SwiperCore, { Navigation, Pagination, Autoplay } from "swiper";
      SwiperCore.use([Navigation, Pagination, Autoplay]);
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags Hook.use() with non-array arguments at top level (upstream parity)", () => {
    const result = runTsx(`
      Hook.use();
    `);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("react-builtins/rules-of-hooks — regressions: package-imported member APIs", () => {
  it.each([
    {
      name: "namespace import",
      code: `
        import * as Sinon from "sinon";
        Sinon.useFakeTimers();
      `,
    },
    {
      name: "default import",
      code: `
        import Sinon from "sinon";
        const TimerControl = ({ enabled }) => enabled ? Sinon.useFakeTimers() : null;
      `,
    },
    {
      name: "named import alias",
      code: `
        import { sandbox as Sinon } from "sinon";
        Sinon.useFakeTimers();
      `,
    },
    {
      name: "immutable namespace alias",
      code: `
        import * as SinonApi from "sinon";
        const Sinon = SinonApi;
        Sinon.useFakeTimers();
      `,
    },
    {
      name: "as-wrapped receiver",
      code: `
        import * as Sinon from "sinon";
        (Sinon as typeof Sinon).useFakeTimers();
      `,
    },
    {
      name: "non-null-wrapped receiver",
      code: `
        import * as Sinon from "sinon";
        Sinon!.useFakeTimers();
      `,
    },
    {
      name: "satisfies-wrapped receiver",
      code: `
        import * as Sinon from "sinon";
        (Sinon satisfies typeof Sinon).useFakeTimers();
      `,
    },
  ])("does not flag a use*-named method on a non-React $name", ({ code }) => {
    const result = runTsx(code);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a shadowing local Hook namespace", () => {
    const result = runTsx(`
      import * as SinonApi from "sinon";
      const installTimers = (Sinon) => Sinon.useFakeTimers();
      consume(SinonApi, installTimers);
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a reassigned mutable package alias", () => {
    const result = runTsx(`
      import * as SinonApi from "sinon";
      let Sinon = SinonApi;
      Sinon = { useFakeTimers: () => null };
      Sinon.useFakeTimers();
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a reassigned package import binding", () => {
    const result = runTsx(`
      import Sinon from "sinon";
      Sinon = { useFakeTimers: () => null };
      Sinon.useFakeTimers();
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a reassigned method on a package namespace", () => {
    const result = runTsx(`
      import * as Sinon from "sinon";
      Sinon.useFakeTimers = () => null;
      Sinon.useFakeTimers();
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "relative custom Hook namespace",
      code: `
        import * as FeatureHooks from "./feature-hooks";
        FeatureHooks.useFeature();
      `,
    },
    {
      name: "path-alias custom Hook namespace",
      code: `
        import * as FeatureHooks from "@/feature-hooks";
        FeatureHooks.useFeature();
      `,
    },
    {
      name: "React namespace alias",
      code: `
        import * as ReactRuntime from "react";
        ReactRuntime.useState(0);
      `,
    },
    {
      name: "React ecosystem namespace",
      code: `
        import * as ReactQuery from "@tanstack/react-query";
        ReactQuery.useQuery({ queryKey: ["key"] });
      `,
    },
  ])("still flags a module-level call through a $name", ({ code }) => {
    const result = runTsx(code);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("react-builtins/rules-of-hooks — regressions: non-Hook APIs called from classes", () => {
  it("does not flag package-alias imported helpers that borrow the use prefix", () => {
    const result = runTsx(`
      import { useContextView } from "mo/components/contextView";
      class Select {
        constructor() {
          this.contextView = useContextView({ shadowOutline: false });
        }
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags useMediaQuery from usehooks-ts inside a class method", () => {
    const result = runTsx(`
      import { useMediaQuery } from "usehooks-ts";
      class ResponsiveStore {
        useLayout() {
          return useMediaQuery("(min-width: 768px)");
        }
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags useTheme from next-themes inside a class method", () => {
    const result = runTsx(`
      import { useTheme } from "next-themes";
      class ThemeStore {
        use() {
          return useTheme();
        }
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag use-prefixed methods on a default-imported service", () => {
    const result = runTsx(`
      import Tron from "reactotron-react-native";
      import { mst } from "reactotron-mst";
      class Reactotron {
        setup() {
          Tron.useReactNative({ asyncStorage: false });
          Tron.use(mst({ filter: () => true }));
          Tron.use(withCustomActions());
        }
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a relative-imported custom Hook called from a class", () => {
    const result = runTsx(`
      import { useData } from "./use-data";
      class DataService {
        load() {
          return useData();
        }
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a namespace-imported custom Hook called from a class", () => {
    const result = runTsx(`
      import * as FeatureHooks from "./hooks";
      class FeatureService {
        load() {
          return FeatureHooks.useFeature();
        }
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags React Hooks called from a class", () => {
    const result = runTsx(`
      import * as React from "react";
      class StatefulView {
        render() {
          const [value] = React.useState(0);
          return <div>{value}</div>;
        }
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("react-builtins/rules-of-hooks — regressions: use*-named functions imported from non-React packages", () => {
  it("does not flag a package-imported use* function called in a plain helper", () => {
    const result = runTsx(`
      import useBrowser from "@cloudscape-design/browser-test-tools/use-browser";
      const setupTest = (testFn) => {
        return useBrowser(async (browser) => {
          await testFn(browser);
        });
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a package-imported use* function called at module top level", () => {
    const result = runTsx(`
      import { useRegistry } from "some-di-library";
      useRegistry("token");
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a relative-imported use* hook called in a plain helper", () => {
    const result = runTsx(`
      import { useData } from "./use-data";
      const setupTest = () => {
        return useData();
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a package-imported use* hook called conditionally inside a component", () => {
    const result = runTsx(`
      import { useQuery } from "@tanstack/react-query";
      const MyComponent = ({ enabled }) => {
        if (enabled) {
          const result = useQuery({ queryKey: ["x"] });
          return <div>{result.data}</div>;
        }
        return null;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags react-redux useSelector called at module top level", () => {
    const result = runTsx(`
      import { useSelector } from "react-redux";
      const user = useSelector((state) => state.user);
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a @tanstack/react-query useQuery called in a plain utility function", () => {
    const result = runTsx(`
      import { useQuery } from "@tanstack/react-query";
      const loadPosts = () => {
        return useQuery({ queryKey: ["posts"] });
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags next/navigation useRouter called in a plain utility function", () => {
    const result = runTsx(`
      import { useRouter } from "next/navigation";
      const redirectHome = () => {
        const router = useRouter();
        router.push("/");
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a webdriverio-style useBrowser called in a plain function", () => {
    const result = runTsx(`
      import { useBrowser } from "webdriverio";
      const runInBrowser = (testFn) => {
        return useBrowser(async (browser) => {
          await testFn(browser);
        });
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("react-builtins/rules-of-hooks — regressions: hooks in destructuring defaults", () => {
  it("flags a hook call used as a destructuring default value", () => {
    const result = runTsx(`
      import * as React from "react";
      export const useCheckbox = (props) => {
        const { id = React.useId() } = props;
        return id;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("called conditionally");
  });

  it("does not flag a hook whose RESULT feeds a destructuring default", () => {
    const result = runTsx(`
      import { useId } from "react";
      export const useCheckbox = (props) => {
        const generatedId = useId();
        const { id = generatedId } = props;
        return id;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("react-builtins/rules-of-hooks — regressions: local hook-free use*-named helpers", () => {
  it("does not flag a local hook-free use* helper called conditionally inside a component", () => {
    const result = runTsx(`
      import { useState } from "react";
      const List = ({ deleteItemID, dialogMessage }) => {
        const [name] = useState("");
        const useDelete = (message) => ({ component: message, props: { name } });
        let dialogBox;
        if (deleteItemID) {
          const { component } = useDelete(dialogMessage);
          dialogBox = <div>{component}</div>;
        }
        return dialogBox;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a local hook-free async use* helper called from an event handler", () => {
    const result = runTsx(`
      const HomeView = ({ plugins }) => {
        const usePlugin = async (plugin) => {
          await plugin.apply();
        };
        return <button onClick={() => usePlugin(plugins[0])}>apply</button>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a local use* helper that itself calls hooks when called conditionally", () => {
    const result = runTsx(`
      import { useState } from "react";
      const MyComponent = ({ enabled }) => {
        const useToggle = () => {
          const [on] = useState(false);
          return on;
        };
        if (enabled) {
          const on = useToggle();
          return <div>{String(on)}</div>;
        }
        return null;
      };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

// Verify wave: renoun's `useMDXComponents` is the MDX/Next.js convention
// name for a project-owned components-map getter — a plain function that
// only borrows the `use` prefix, documented as callable from async Server
// Components.
describe("react-builtins/rules-of-hooks — regressions: project-owned useMDXComponents", () => {
  it("does not flag useMDXComponents imported relatively inside an async Server Component", () => {
    const result = runTsx(`
      import { useMDXComponents } from "../mdx/components.tsx";
      export async function Markdown({ children }) {
        const defaultComponents = useMDXComponents();
        return <div>{children}</div>;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags useMDXComponents imported from a React-ecosystem package in an async component", () => {
    const result = runTsx(`
      import { useMDXComponents } from "@mdx-js/react";
      export async function Markdown({ children }) {
        const defaultComponents = useMDXComponents();
        return <div>{children}</div>;
      }
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a real React hook inside an async component", () => {
    const result = runTsx(`
      import { useState } from "react";
      export async function Markdown({ children }) {
        const [value] = useState(0);
        return <div>{children}{value}</div>;
      }
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

// Verify wave: cloudscape guards a dev-only useEffect behind a build-time
// `isDevelopment` constant and suppresses the upstream rule by name; hook
// order is identical on every render of a given build, so the author's
// explicit `eslint-disable-next-line react-hooks/rules-of-hooks` must be
// honored (oxlint's disable handling only matches our rule id).
describe("react-builtins/rules-of-hooks — regressions: upstream disable-comment suppression", () => {
  const withTempFile = (code: string, run: (filename: string) => void): void => {
    const directory = mkdtempSync(join(tmpdir(), "rules-of-hooks-suppression-"));
    const filename = join(directory, "fixture.tsx");
    writeFileSync(filename, code);
    clearRulesOfHooksSuppressionCache();
    try {
      run(filename);
    } finally {
      rmSync(directory, { recursive: true, force: true });
      clearRulesOfHooksSuppressionCache();
    }
  };

  it("honors eslint-disable-next-line react-hooks/rules-of-hooks on a guarded useEffect", () => {
    const code = [
      'import { useEffect } from "react";',
      "function SideNavigation({ items }) {",
      "  if (isDevelopment) {",
      "    // eslint-disable-next-line react-hooks/rules-of-hooks",
      "    useEffect(() => checkDuplicateHrefs(items), [items]);",
      "  }",
      "  return <nav />;",
      "}",
    ].join("\n");
    withTempFile(code, (filename) => {
      const result = runRule(rulesOfHooks, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  it("still flags the same guarded useEffect without a disable comment", () => {
    const code = [
      'import { useEffect } from "react";',
      "function SideNavigation({ items }) {",
      "  if (isDevelopment) {",
      "    useEffect(() => checkDuplicateHrefs(items), [items]);",
      "  }",
      "  return <nav />;",
      "}",
    ].join("\n");
    withTempFile(code, (filename) => {
      const result = runRule(rulesOfHooks, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  it("ignores disable comments naming a different rule", () => {
    const code = [
      'import { useEffect } from "react";',
      "function SideNavigation({ items }) {",
      "  if (isDevelopment) {",
      "    // eslint-disable-next-line no-console",
      "    useEffect(() => checkDuplicateHrefs(items), [items]);",
      "  }",
      "  return <nav />;",
      "}",
    ].join("\n");
    withTempFile(code, (filename) => {
      const result = runRule(rulesOfHooks, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });
});
