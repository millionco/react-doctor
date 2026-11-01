import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { forwardedSetStateInEffect } from "./forwarded-set-state-in-effect.js";

const ASSIGN_HELPER = "const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);";

const lintComponent = (helper: string, effectSource: string) => {
  const result = runRule(
    forwardedSetStateInEffect,
    `import { useEffect, useInsertionEffect, useLayoutEffect, useRef, useState } from "react";
    ${helper}
    const Component = ({ id }: { id: string }) => {
      const [value, setValue] = useState<string | null>(null);
      const [other, setOther] = useState<string | null>(null);
      const latestRef = useRef(id);
      ${effectSource}
      return value ?? other ?? latestRef.current;
    };`,
  );
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

const countDiagnostics = (helper: string, effectSource: string): number =>
  lintComponent(helper, effectSource).length;

describe("forwarded-set-state-in-effect", () => {
  it.each([
    ["useEffect", "useEffect(() => { assign(setValue, id); }, [id]);"],
    ["useLayoutEffect", "useLayoutEffect(() => { assign(setValue, id); }, [id]);"],
    ["useInsertionEffect", "useInsertionEffect(() => { assign(setValue, id); }, [id]);"],
    ["an expression body", "useEffect(() => assign(setValue, id), [id]);"],
    ["a function expression", "useEffect(function sync() { assign(setValue, id); }, [id]);"],
    ["a write after a guard", "useEffect(() => { if (!id) return; assign(setValue, id); }, [id]);"],
  ])("reports a synchronous forwarded write in %s", (_scenario, effectSource) => {
    expect(countDiagnostics(ASSIGN_HELPER, effectSource)).toBe(1);
  });

  it("reports a write in a namespaced React effect", () => {
    const result = runRule(
      forwardedSetStateInEffect,
      `import * as React from "react";
      ${ASSIGN_HELPER}
      const Component = ({ id }: { id: string }) => {
        const [value, setValue] = React.useState<string | null>(null);
        React.useEffect(() => { assign(setValue, id); }, [id]);
        return value;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports at the forwarded setter with the compiler message", () => {
    const [diagnostic] = lintComponent(
      ASSIGN_HELPER,
      "useEffect(() => { assign(setValue, id); }, [id]);",
    );
    expect(diagnostic?.message).toMatch(
      /^Calling setState synchronously within an effect can trigger cascading renders\n\nEffects are intended to synchronize state/,
    );
    expect(diagnostic?.message).toMatch(/you-might-not-need-an-effect\)\.$/);
  });

  it.each([
    ["a block helper", "const assign = (setter, next) => { setter(next); };"],
    ["a returned call", "const assign = (setter, next) => { return setter(next); };"],
    ["a function declaration", "function assign(setter, next) { setter(next); }"],
    ["reordered parameters", "const assign = (next, setter) => setter(next);"],
  ])("reports %s", (_scenario, helper) => {
    const effectSource = helper.includes("(next, setter)")
      ? "useEffect(() => { assign(id, setValue); }, [id]);"
      : "useEffect(() => { assign(setValue, id); }, [id]);";
    expect(countDiagnostics(helper, effectSource)).toBe(1);
  });

  it("reports one diagnostic per effect", () => {
    expect(
      countDiagnostics(
        ASSIGN_HELPER,
        "useEffect(() => { assign(setValue, id); assign(setOther, id); }, [id]);",
      ),
    ).toBe(1);
    expect(
      countDiagnostics(
        ASSIGN_HELPER,
        `useEffect(() => { assign(setValue, id); }, [id]);
        useLayoutEffect(() => { assign(setOther, id); }, [id]);`,
      ),
    ).toBe(2);
  });

  it.each([
    ["a direct setter call", "useEffect(() => { setValue(id); }, [id]);"],
    [
      "a direct call beside a forwarded call",
      "useEffect(() => { setOther(id); assign(setValue, id); }, [id]);",
    ],
  ])("leaves %s to the compiler", (_scenario, effectSource) => {
    expect(countDiagnostics(ASSIGN_HELPER, effectSource)).toBe(0);
  });

  it.each([
    ["an async helper", "const assign = async (setter, next) => setter(next);"],
    ["a conditional helper", "const assign = (setter, next) => { if (next) setter(next); };"],
    ["a deferred helper", "const assign = (setter, next) => queueMicrotask(() => setter(next));"],
    [
      "a reassigned helper",
      "let assign = (setter, next) => setter(next); assign = (setter, next) => {};",
    ],
    ["an imported helper", 'import { assign } from "./assign";'],
    [
      "a multi-statement helper",
      "const assign = (setter, next) => { console.log(next); setter(next); };",
    ],
  ])("stays quiet for %s", (_scenario, helper) => {
    expect(countDiagnostics(helper, "useEffect(() => { assign(setValue, id); }, [id]);")).toBe(0);
  });

  it.each([
    ["a microtask", "useEffect(() => { queueMicrotask(() => assign(setValue, id)); }, [id]);"],
    [
      "a subscription callback",
      "useEffect(() => { const handle = () => assign(setValue, id); window.addEventListener('resize', handle); return () => window.removeEventListener('resize', handle); }, [id]);",
    ],
    ["an async effect", "useEffect(async () => { assign(setValue, id); }, [id]);"],
    ["a ref-derived value", "useEffect(() => { assign(setValue, latestRef.current); }, [id]);"],
    [
      "a ref-controlled write",
      "useEffect(() => { if (latestRef.current !== id) assign(setValue, id); }, [id]);",
    ],
    ["a plain callback", "const sync = () => { assign(setValue, id); };"],
  ])("stays quiet for %s", (_scenario, effectSource) => {
    expect(countDiagnostics(ASSIGN_HELPER, effectSource)).toBe(0);
  });

  it("stays quiet outside components and hooks", () => {
    const result = runRule(
      forwardedSetStateInEffect,
      `import { useEffect } from "react";
      const assign = (setter, next) => setter(next);
      const helper = (setValue, id) => { useEffect(() => { assign(setValue, id); }, [id]); };`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});

describe("forwarded compiler parity regressions", () => {
  it.each([
    ["a ref snapshot alias", "const next = latestRef.current; assign(setValue, next);"],
    [
      "a destructured ref measurement",
      "const {height} = latestRef.current.getBoundingClientRect(); assign(setValue, height);",
    ],
    [
      "a ref guard alias",
      "const changed = latestRef.current !== id; if (changed) assign(setValue, id);",
    ],
    ["a preceding ref guard", "if (!latestRef.current) return; assign(setValue, id);"],
    [
      "a snapshot alias chain",
      "const first = latestRef.current; const second = first; assign(setValue, second);",
    ],
    ["a ref object alias", "const otherRef = latestRef; assign(setValue, otherRef.current);"],
    [
      "a returned ref-derived measurement",
      "const measure = () => latestRef.current.getBoundingClientRect().height; assign(setValue, measure());",
    ],
    ["an unreachable return continuation", "return; assign(setValue, id);"],
    ["a statically false branch", "if (false) assign(setValue, id);"],
    ["an unconstructed class field", "class Pending { value = assign(setValue, id); }"],
  ])("preserves compiler allowance for %s", (_name, body) => {
    expect(countDiagnostics(ASSIGN_HELPER, `useEffect(() => {${body}}, [id]);`)).toBe(0);
  });

  it.each([
    [
      "a synchronous effect-local captured setter helper",
      "const sync = () => setOther(id); sync(); assign(setValue, id);",
    ],
    [
      "a ref-guarded effect-local helper invocation",
      "const sync = () => setOther(id); if (latestRef.current) sync(); assign(setValue, id);",
    ],
    [
      "an uncalled returned setter callback",
      "const makeHandler = () => () => setOther(id); makeHandler(); assign(setValue, id);",
    ],
    [
      "a helper's deferred setter callback",
      "const subscribe = () => window.addEventListener('resize', () => setOther(id)); subscribe(); assign(setValue, id);",
    ],
    [
      "a ref-controlled direct setter",
      "if (latestRef.current) setOther(id); assign(setValue, id);",
    ],
    [
      "a ref-controlled local helper",
      "const sync = () => {if (latestRef.current) setOther(id);}; sync(); assign(setValue, id);",
    ],
    [
      "a ref-derived local helper",
      "const sync = () => setOther(latestRef.current); sync(); assign(setValue, id);",
    ],
    ["an unreachable direct setter", "assign(setValue, id); return; setOther(id);"],
    ["a statically false direct setter", "if (false) setOther(id); assign(setValue, id);"],
    ["a plain current property", "const plain = {current: id}; assign(setValue, plain.current);"],
    [
      "a plain current-property guard",
      "const plain = {current: id}; if (plain.current) assign(setValue, id);",
    ],
    [
      "a shadowed ref snapshot",
      "const next = latestRef.current; { const next = id; assign(setValue, next); }",
    ],
    [
      "a reassigned local value",
      "let next = latestRef.current; next = id; assign(setValue, next);",
    ],
    ["an unrelated ref read", "latestRef.current; assign(setValue, id);"],
  ])("does not hide a forwarded write behind %s", (_name, body) => {
    expect(countDiagnostics(ASSIGN_HELPER, `useEffect(() => {${body}}, [id]);`)).toBe(1);
  });

  it("does not treat a shadowed useRef function as React provenance", () => {
    expect(
      countDiagnostics(
        ASSIGN_HELPER,
        `
      useEffect(() => {
        const useRef = (value) => ({current: value});
        const plain = useRef(id);
        assign(setValue, plain.current);
      }, [id]);
    `,
      ),
    ).toBe(1);
  });

  it("reports through nested helpers declared inside the effect", () => {
    expect(
      countDiagnostics(
        ASSIGN_HELPER,
        `
      useEffect(() => {
        const inner = () => setOther(id);
        const outer = () => inner();
        outer();
        assign(setValue, id);
      }, [id]);
    `,
      ),
    ).toBe(1);
  });
});

describe("compiler-visible component helpers", () => {
  it.each([
    ["update();", 0],
    ["if (latestRef.current) update();", 1],
  ])("matches native duplicate suppression for %s", (invoke, expected) => {
    expect(
      countDiagnostics(
        ASSIGN_HELPER,
        `
      const update = () => setOther(id);
      useEffect(() => { ${invoke} assign(setValue, id); }, [id]);
    `,
      ),
    ).toBe(expected);
  });
});
