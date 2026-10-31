import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

describe("no-ref-current-in-render directly invoked React callbacks", () => {
  it.each([
    "resolveValue();",
    "useState(resolveValue());",
    "useMemo(() => resolveValue(), []);",
    "return <output>{resolveValue()}</output>;",
    "(() => resolveValue())();",
    "if (/pattern/) resolveValue();",
    "if (1n) resolveValue();",
    "1n ? resolveValue() : null;",
    "if (((1n))) resolveValue();",
    "((1n)) ? resolveValue() : null;",
    "(resolveValue as () => unknown)();",
  ])("reports an explicit render call: %s", (invocation) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef, useState, useMemo } from "react";
      function Panel({ value }) {
        const container = useRef(null);
        const resolveValue = useCallback(() => {
          container.current = value;
          return container.current;
        }, [value]);
        ${invocation}
        return null;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "",
    "useEffect(() => { resolveValue(); }, []);",
    "useEffect(() => () => { resolveValue(); }, []);",
    "useState(resolveValue);",
    "useMemo(() => resolveValue, []);",
    "return <button onClick={() => resolveValue()}>Run</button>;",
    "return null; resolveValue();",
    "if (false) resolveValue();",
    "if (0) resolveValue();",
    "if (0n) resolveValue();",
    "0n ? resolveValue() : null;",
    "if (((0n))) resolveValue();",
    "((0n)) ? resolveValue() : null;",
    "if (null) resolveValue();",
    "if ('') resolveValue();",
    "0 ? resolveValue() : null;",
    "false && resolveValue();",
    "true || resolveValue();",
  ])("does not follow an uncalled or deferred callback: %s", (invocation) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef, useState, useMemo, useEffect } from "react";
      function Panel({ value }) {
        const container = useRef(null);
        const resolveValue = useCallback(() => { container.current = value; }, [value]);
        ${invocation}
        return null;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "resolveValue = replacement;",
    "[resolveValue] = [replacement];",
    "({ resolveValue } = { resolveValue: replacement });",
    "resolveValue ||= replacement;",
  ])("does not follow a replaced callback: %s", (replacement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value, replacement }) {
        const container = useRef(null);
        const resolveValue = useCallback(() => { container.current = value; }, [value]);
        ${replacement}
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes a named React import alias", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback as memoizeHandler, useRef } from "react";
      function Panel({ value }) {
        const container = useRef(null);
        const resolveValue = memoizeHandler(() => { container.current = value; }, [value]);
        resolveValue();
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not follow a shadowed hook", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
      function Panel({ value, useCallback }) {
        const container = useRef(null);
        const resolveValue = useCallback(() => { container.current = value; }, [value]);
        resolveValue();
        return null;
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    { description: "owned record data", initializer: "{ value: 0 }", expectedCount: 1 },
    {
      description: "an opaque accessor",
      initializer: "{ get value() { return 0; } }",
      expectedCount: 0,
    },
  ])(
    "checks nested writes through $description in a render-called callback",
    ({ initializer, expectedCount }) => {
      const result = runRule(
        noRefCurrentInRender,
        `import { useCallback, useRef } from "react";
      function Panel({ value }) {
        const container = useRef(${initializer});
        const update = useCallback(() => { container.current.value = value; }, [value]);
        update();
        return null;
      }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expectedCount);
    },
  );

  it("retains predictable null-guarded initialization", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel() {
        const container = useRef(null);
        const resolveValue = useCallback(() => {
          if (container.current === null) container.current = new Map();
          return container.current;
        }, []);
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores an unreachable callback write", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value }) {
        const container = useRef(null);
        const resolveValue = useCallback(() => { return; container.current = value; }, [value]);
        resolveValue();
        return null;
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("follows directly called immutable React callbacks transitively", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value }) {
        const container = useRef(null);
        const update = useCallback(() => { container.current = value; }, [value]);
        const resolveValue = useCallback(() => update(), [update]);
        resolveValue();
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a nested callback as executed", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value }) {
        const container = useRef(null);
        const resolveValue = useCallback(() => {
          const later = () => { container.current = value; };
          return later;
        }, [value]);
        resolveValue();
        return null;
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not follow a same-name shadowed call", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value, replacement }) {
        const container = useRef(null);
        const resolveValue = useCallback(() => { container.current = value; }, [value]);
        ((resolveValue) => resolveValue())(replacement);
        return null;
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["useCallback = replacement;", "[useCallback] = [replacement];"])(
    "does not trust a replaced imported hook: %s",
    (replacement) => {
      const result = runRule(
        noRefCurrentInRender,
        `import { useCallback, useRef } from "react";
        function Panel({ value, replacement }) {
          const container = useRef(null);
          ${replacement}
          const resolveValue = useCallback(() => { container.current = value; }, [value]);
          resolveValue();
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("recognizes a genuine React namespace", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import * as React from "react";
      function Panel({ value }) {
        const container = React.useRef(null);
        const resolveValue = React.useCallback(() => { container.current++; }, [value]);
        resolveValue();
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "React.useCallback = replacement;",
    "({ handler: React.useCallback } = { handler: replacement });",
    "React['useCallback'] = replacement;",
    "React[method] = replacement;",
  ])("does not trust a replaced namespace hook: %s", (replacement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import * as React from "react";
      function Panel({ value, replacement, method }) {
        const container = React.useRef(null);
        ${replacement}
        const resolveValue = React.useCallback(() => { container.current = value; }, [value]);
        resolveValue();
        return null;
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "resolveValue.description = 'label';",
    "({ result: spare = resolveValue } = {});",
    "({ [resolveValue]: spare } = {});",
    "useCallback.description = 'label';",
    "({ result: spare = useCallback } = {});",
    "({ [useCallback]: spare } = {});",
  ])("retains invocation proof through a read or metadata write: %s", (statement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value }) {
        let spare;
        const container = useRef(null);
        const resolveValue = useCallback(() => { container.current = value; }, [value]);
        ${statement}
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "React.description = 'label';",
    "({ handler: spare = React.useCallback } = {});",
    "({ [React.useCallback]: spare } = {});",
    "({ description: React.description } = { description: 'label' });",
  ])("does not treat namespace reads or metadata as replacing the hook: %s", (statement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import * as React from "react";
      function Panel({ value }) {
        let spare;
        ${statement}
        const container = React.useRef(null);
        const resolveValue = React.useCallback(() => { container.current = value; }, [value]);
        resolveValue();
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not ignore a competing write from another render-called callback", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel() {
        const container = useRef(null);
        const initialize = useCallback(() => {
          if (container.current === null) container.current = new Map();
        }, []);
        const replace = useCallback(() => { container.current = "changed"; }, []);
        initialize();
        replace();
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });
  it.each([
    "async () => { container.current = value; }",
    "function* () { container.current = value; }",
    "(argument) => { container.current = argument; }",
  ])("keeps unsupported callback shapes outside the proof: %s", (callback) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value }) {
        const container = useRef(null);
        const resolveValue = useCallback(${callback}, [value]);
        resolveValue(value);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it.each([
    "Object.assign(React, { useCallback: replacement });",
    "mutate(React);",
    "const alias = React; alias.useCallback = replacement;",
    "const alias = React; ({ handler: alias.useCallback } = { handler: replacement });",
  ])("rejects namespace mutation or unknown escape: %s", (statement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import React from "react";
      function Panel({ value, replacement, mutate }) {
        ${statement}
        const container = React.useRef(null);
        const resolveValue = React.useCallback(() => { container.current = value; }, [value]);
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it.each([
    `resolveValue(); const resolveValue = useCallback(() => { container.current = value; }, [value]);`,
    `const resolveValue = useCallback(() => update(), []); resolveValue(); const update = useCallback(() => { container.current = value; }, [value]);`,
    `const resolveValue = useCallback(() => update(), []); const update = useCallback(() => { container.current = value; }, [value]); resolveValue();`,
  ])("does not follow a call reference before callback initialization: %s", (body) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value }) {
        const container = useRef(null);
        ${body}
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it.each(["0n", "((0n))", "0", "((0))"])(
    "preserves default reachability while opting into literal truthiness: %s",
    (condition) => {
      const defaultReachability: boolean[] = [];
      const optedInReachability: boolean[] = [];
      const probeRule = defineRule({
        id: "literal-reachability-probe",
        title: "Literal reachability probe",
        severity: "error",
        recommendation: "Keep opt-in literal reachability separate from default callers.",
        create: (context) => ({
          CallExpression: (node) => {
            if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "resolveValue") {
              return;
            }
            defaultReachability.push(isNodeReachableWithinFunction(node, context));
            optedInReachability.push(
              isNodeReachableWithinFunction(node, context, {
                evaluatePrimitiveLiteralTruthiness: true,
              }),
            );
          },
        }),
      });
      const result = runRule(
        probeRule,
        `function Panel() { if (${condition}) resolveValue(); return null; }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(defaultReachability).toEqual([true]);
      expect(optedInReachability).toEqual([false]);
    },
  );
  it.each(["0", null])("does not coerce unknown BigInt provider values: %s", (providerValue) => {
    const reachability: boolean[] = [];
    const probeRule = defineRule({
      id: "bigint-provider-reachability-probe",
      title: "BigInt provider reachability probe",
      severity: "error",
      recommendation: "Require native BigInt values before coercing tagged literals.",
      create: (context) => ({
        Program: (node) => {
          walkAst(node, (candidate) => {
            if (isNodeOfType(candidate, "Literal") && "bigint" in candidate) {
              Object.defineProperty(candidate, "value", { value: providerValue });
            }
          });
        },
        CallExpression: (node) => {
          reachability.push(
            isNodeReachableWithinFunction(node, context, {
              evaluatePrimitiveLiteralTruthiness: true,
            }),
          );
        },
      }),
    });
    const result = runRule(probeRule, "function Panel() { if (0n) resolveValue(); return null; }");
    expect(result.parseErrors).toEqual([]);
    expect(reachability).toEqual([true]);
  });
});
