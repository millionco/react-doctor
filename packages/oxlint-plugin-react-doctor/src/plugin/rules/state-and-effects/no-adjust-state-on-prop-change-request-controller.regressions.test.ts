import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("request-map controller aliases", () => {
  it.each([
    {
      name: "direct local const",
      declaration: "const controller = new AbortController();",
      expected: 0,
    },
    {
      name: "signal as request option",
      declaration: "const controller = new AbortController();",
      after: 'fetch("/items", { signal: controller.signal });',
      expected: 0,
    },
    {
      name: "static computed signal",
      declaration: "const controller = new AbortController();",
      after: 'fetch("/items", { signal: controller["signal"] });',
      expected: 0,
    },
    {
      name: "mutable let",
      declaration: "let controller = new AbortController();",
      expected: 1,
    },
    {
      name: "mutable var",
      declaration: "var controller = new AbortController();",
      expected: 1,
    },
    {
      name: "controller alias chain",
      declaration: "const original = new AbortController(); const controller = original;",
      expected: 1,
    },
    {
      name: "unknown factory",
      declaration: "const controller = makeController();",
      expected: 1,
    },
    {
      name: "shadowed constructor",
      declaration:
        "const AbortController = FakeController; const controller = new AbortController();",
      expected: 1,
    },
    {
      name: "binding reassignment",
      declaration: "const controller = new AbortController();",
      after: "controller = makeController();",
      expected: 1,
    },
    {
      name: "abort method replacement",
      declaration: "const controller = new AbortController();",
      after: "controller.abort = () => {};",
      expected: 1,
    },
    {
      name: "signal replacement",
      declaration: "const controller = new AbortController();",
      after: "controller.signal = otherSignal;",
      expected: 1,
    },
    {
      name: "controller escape",
      declaration: "const controller = new AbortController();",
      after: "configure(controller);",
      expected: 1,
    },
    {
      name: "deferred controller signal read",
      declaration: "const controller = new AbortController();",
      after: 'later(() => fetch("/items", { signal: controller.signal }));',
      expected: 1,
    },
    {
      name: "temporal dead zone",
      declaration: "",
      after: "const controller = new AbortController();",
      expected: 1,
    },
    {
      name: "outer controller",
      outside: "const controller = new AbortController();",
      declaration: "",
      expected: 1,
    },
    {
      name: "different loading key",
      declaration: "const controller = new AbortController();",
      loadingKey: "otherKey",
      expected: 1,
    },
    {
      name: "missing registry clear",
      declaration: "const controller = new AbortController();",
      clear: "",
      expected: 1,
    },
    {
      name: "missing abort",
      declaration: "const controller = new AbortController();",
      release: "entry.controller.inspect()",
      expected: 1,
    },
    {
      name: "unrelated setter",
      declaration: "const controller = new AbortController();",
      reset: "setDraft(new Set());",
      expected: 1,
    },
    {
      name: "second registry escape",
      declaration: "const controller = new AbortController();",
      after: "otherRegistry.set(requestKey, { controller });",
      expected: 1,
    },
    {
      name: "destructuring member assignment",
      declaration: "const controller = new AbortController();",
      after: "({ value: controller.signal } = external);",
      expected: 1,
    },
    {
      name: "dynamic signal property",
      declaration: "const controller = new AbortController();",
      after: 'fetch("/items", { signal: controller[propertyName] });',
      expected: 1,
    },
  ])(
    "checks $name",
    ({
      declaration,
      after = "",
      outside = "",
      loadingKey = "requestKey",
      clear = "pending.current.clear();",
      release = "entry.controller.abort()",
      reset = "setLoading(new Set());",
      expected,
    }) => {
      const result = runRule(
        noAdjustStateOnPropChange,
        `
        import { useEffect, useRef, useState } from "react";
        const Requests = ({ query }) => {
          const pending = useRef(new Map());
          const [loading, setLoading] = useState(new Set());
          const [draft, setDraft] = useState(new Set());
          ${outside}
          const start = (requestKey, otherKey) => {
            ${declaration}
            pending.current.set(requestKey, { controller });
            setLoading((previous) => new Set(previous).add(${loadingKey}));
            ${after}
          };
          useEffect(() => {
            pending.current.forEach((entry) => ${release});
            ${clear}
            ${reset}
          }, [query]);
          return <button onClick={() => start("item", "other")}>{loading.size + draft.size}</button>;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );
});
