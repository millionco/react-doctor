import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

describe("ref writes through Object.assign during render", () => {
  it.each([
    "valueRef.current = value",
    "Object.assign(valueRef, { current: value })",
    'Object["assign"](valueRef, { ["current"]: value })',
    "Object.assign((valueRef as React.MutableRefObject<unknown>)!, { current: value })",
    "Object.assign(alias, { current: value })",
    'Object.assign(valueRef, { label: "ready" }, { current: value })',
    "Object.assign(valueRef, { current: value }, unknownSource)",
    "Object.assign(valueRef, { ...unknownSource, current: value })",
    "(() => Object.assign(valueRef, { current: value }))()",
    "[value].forEach((entry) => Object.assign(valueRef, { current: entry }))",
  ])("reports %s", (write) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
         const Panel = ({ value }) => {
           const valueRef = useRef(null);
           const alias = valueRef;
           ${write};
           return null;
         };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ['import { useRef as makeRef } from "react";', "const valueRef = makeRef(null);"],
    ['import * as React from "react";', "const valueRef = React.useRef(null);"],
  ])("uses proven React provenance: %s", (imports, declaration) => {
    const result = runRule(
      noRefCurrentInRender,
      `${imports}; const useLatest = (value) => {
         ${declaration}
         Object.assign(valueRef, { current: value });
         return valueRef;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "const Object = { assign() {} }; Object.assign(valueRef, { current: value });",
    "Object.assign = (target, source) => target; Object.assign(valueRef, { current: value });",
    "Object.defineProperty(Object, 'assign', { value: (target, source) => target }); Object.assign(valueRef, { current: value });",
    "Object.assign(Object, { assign: (target, source) => target }); Object.assign(valueRef, { current: value });",
    "((Object) => Object.assign(valueRef, { current: value }))(customObject);",
    "const record = { current: null }; Object.assign(record, { current: value });",
    "Object.assign(valueRef, { value });",
    "Object.assign(valueRef, { [propertyName]: value });",
    "Object.assign(valueRef, unknownSource);",
    "Object.assign(valueRef, value ? { current: value } : {});",
    "Object.assign(valueRef, { ...(value ? { current: value } : {}) });",
    "Object.assign(valueRef, ...unknownSources);",
    "Object.assign({}, valueRef, { current: value });",
    "Object.assign(valueRef.current, { current: value });",
    "const assign = Object.assign; assign(valueRef, { current: value });",
  ])("keeps unproven ref-current writes quiet: %s", (statement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         ${statement}
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps userland useRef lookalikes quiet", () => {
    const result = runRule(
      noRefCurrentInRender,
      `const useRef = (current) => ({ current });
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         Object.assign(valueRef, { current: value });
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "useEffect(() => { Object.assign(valueRef, { current: value }); }, [value]);",
    "queueMicrotask(() => Object.assign(valueRef, { current: value }));",
    "const onClick = () => Object.assign(valueRef, { current: value });",
  ])("preserves deferred writes: %s", (statement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useEffect, useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         ${statement}
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "valueRef.current = new Map()",
    "Object.assign(valueRef, { current: new Map() })",
    "Object.assign(alias, { current: new Map() })",
    'Object["assign"](valueRef, { ["current"]: new Map() })',
    "void Object.assign(valueRef, { current: new Map() })",
    "(Object.assign(valueRef, { current: new Map() }), undefined)",
    "(Object.assign(valueRef, { current: new Map() }) as React.MutableRefObject<unknown>)",
  ])("preserves predictable guarded initialization: %s", (write) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef(null);
         const alias = valueRef;
         if (valueRef.current === null) ${write};
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["valueRef.current = new Map()", "Object.assign(valueRef, { current: new Map() })"])(
    "rejects a competing reset after guarded initialization: %s",
    (initialization) => {
      const result = runRule(
        noRefCurrentInRender,
        `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef(null);
         if (valueRef.current === null) ${initialization};
         Object.assign(valueRef, { current: null });
         return null;
       };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(2);
    },
  );

  it.each([
    "Object.assign(valueRef, { current: value })",
    "Object.assign(valueRef, { current: Math.random() })",
    "Object.assign(valueRef, { current: new Map() }, unknownSource)",
    "Object.assign(valueRef, { current: new Map(), ...unknownSource })",
    "Object.assign(valueRef, { current: new Map() }, { current: new Map() })",
    "Object.assign(valueRef, { get current() { return new Map(); } })",
    "Object.assign(valueRef, { [propertyName]: value, current: new Map() })",
  ])("keeps unsafe guarded writes visible: %s", (write) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         if (valueRef.current === null) ${write};
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["useMemo", "useState"])("reports render-phase %s callbacks", (hookName) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { ${hookName}, useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         ${hookName}(() => Object.assign(valueRef, { current: value }), []);
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["if (valueRef.current !== null) {} else", "Object.assign(valueRef, { current: new Map() })"],
    ["if (!valueRef.current)", "Object.assign(valueRef, { current: new Map() })"],
  ])("preserves existing initialization guards: %s", (guard, write) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef<Map<string, string> | null>(null);
         ${guard} ${write};
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves initialization alongside a deferred known truthy replacement", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useEffect, useRef } from "react";
       const Panel = () => {
         const valueRef = useRef(null);
         if (valueRef.current === null) Object.assign(valueRef, { current: new Map() });
         useEffect(() => { Object.assign(valueRef, { current: new Map() }); }, []);
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "registerRef(Object.assign(valueRef, { current: new Map() }));",
    "const leaked = Object.assign(valueRef, { current: new Map() }); leaked.current = null;",
    "const current = Object.assign(valueRef, { current: new Map() }).current;",
    "return Object.assign(valueRef, { current: new Map() });",
    "publish({ ref: Object.assign(valueRef, { current: new Map() }) });",
  ])("keeps consumed initialization results visible: %s", (statement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef(null);
         if (valueRef.current === null) {
           ${statement}
         }
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["valueRef.current = new Map(); registerRef(valueRef);", 1],
    ["valueRef.current = new Map(); const leaked = valueRef; leaked.current = null;", 2],
  ])("retains direct-write escape and alias anchors: %s", (statements, diagnosticCount) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef(null);
         if (valueRef.current === null) {
           ${statements}
         }
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });

  it.each([
    "useEffect(() => { registerRef(Object.assign(valueRef, { current: value })); }, [value]);",
    "const onClick = () => registerRef(Object.assign(valueRef, { current: value }));",
  ])("permits consumed Object.assign results in deferred writes: %s", (statement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useEffect, useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         ${statement}
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "const Panel = () => render(value);",
    "const Panel = () => values.map(render);",
    "const Panel = () => Object.keys(value);",
    "const Panel = () => value?.render();",
    "const Panel = () => (render as typeof render)(value);",
  ])("keeps scopes lazy for unrelated calls: %s", (source) => {
    const parsed = parseFixture(source);
    expect(parsed.errors).toEqual([]);
    const visitors = noRefCurrentInRender.create({
      report: () => {},
      get scopes(): never {
        throw new Error("unrelated calls must not request scopes");
      },
      get cfg(): never {
        throw new Error("unrelated calls must not request control flow");
      },
    });
    walkAst(parsed.program, (node) => {
      if (isNodeOfType(node, "CallExpression")) visitors.CallExpression(node);
    });
  });

  it.each([
    ["const alias = valueRef; Object.assign(alias, { current: value });", 1],
    [
      "const alias = valueRef; const nestedAlias = alias; Object.assign(nestedAlias, { current: value });",
      1,
    ],
    [
      "const alias = {}; { const valueRef = alias; Object.assign(valueRef, { current: value }); }",
      0,
    ],
    ["const alias = valueRef.current; Object.assign(alias, { current: value });", 0],
    ["Object.assign({ ...valueRef }, { current: value });", 0],
    ["Object.assign(valueRef, { __proto__: { current: value } });", 0],
    ["Object.assign(valueRef, { set current(value) {} });", 1],
    ["Object.assign(valueRef, { current() { return value; } });", 1],
    ["Object.assign?.(valueRef, { current: value });", 1],
    ["Object[`assign`](valueRef, { [`current`]: value });", 1],
    ["const deferred = () => Object.assign(valueRef, { current: value });", 0],
    ["function deferred() { Object.assign(valueRef, { current: value }); }", 0],
    ["Object.assign(valueRef, { current: value }); return valueRef.current;", 1],
  ])("preserves target identity and execution scope: %s", (statement, diagnosticCount) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         ${statement}
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });
});
