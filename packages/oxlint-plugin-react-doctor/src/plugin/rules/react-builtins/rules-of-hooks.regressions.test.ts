import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const runTsx = (code: string) => runRule(rulesOfHooks, code, { filename: "fixture.tsx" });

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

  it("still flags a bare/unimported useEffectEvent when passed around (parity)", () => {
    const result = runTsx(`
      const MyComponent = ({ onDone }) => {
        const handleChange = useEffectEvent(() => onDone());
        return <Child onChange={handleChange} />;
      };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
