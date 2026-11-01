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
    [
      "a local function the compiler follows",
      "useEffect(() => { const sync = () => setOther(id); sync(); assign(setValue, id); }, [id]);",
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
