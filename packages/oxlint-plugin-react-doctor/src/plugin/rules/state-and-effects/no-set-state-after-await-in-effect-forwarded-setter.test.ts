import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

const ASSIGN_HELPER = "const assign = (setter, value) => setter(value);";

const countDiagnostics = (helper: string, effectBody: string): number => {
  const result = runRule(
    noSetStateAfterAwaitInEffect,
    `import { useEffect, useLayoutEffect, useState } from "react";
    ${helper}
    const Component = ({ id }) => {
      const [value, setValue] = useState(null);
      useEffect(() => { ${effectBody} }, [id]);
      return value;
    };`,
  );
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.length;
};

const forwardSetterCalls = (effectBody: string): string =>
  effectBody.replace(/\bsetValue\((\w+)\)/g, "assign(setValue, $1)");

describe("no-set-state-after-await-in-effect forwarded setters", () => {
  it.each([
    ["queueMicrotask(() => setValue(id));", 1],
    ["Promise.resolve(id).then((result) => setValue(result));", 1],
    ["Promise.resolve(id).then((result) => { return setValue(result); });", 1],
    ["Promise.reject(id).catch(() => setValue(id));", 1],
    ["Promise.resolve(id).finally(() => setValue(id));", 1],
    ["Promise.reject(id).then(undefined, () => setValue(id));", 1],
    ["const pending = Promise.resolve(id); pending.then((result) => setValue(result));", 1],
    ["const load = () => queueMicrotask(() => setValue(id)); load();", 1],
    ["const load = async () => { const result = await fetch(id); setValue(result); }; load();", 1],
    [
      "let ignore = false; queueMicrotask(() => { ignore = false; if (!ignore) setValue(id); }); return () => { ignore = true; };",
      1,
    ],
    [
      "let ignore = false; queueMicrotask(() => { if (!ignore) setValue(id); }); return () => { ignore = true; };",
      0,
    ],
    [
      "let ignore = false; Promise.resolve(id).then((result) => { if (ignore) return; setValue(result); }); return () => { ignore = true; };",
      0,
    ],
    [
      "let ignore = false; const load = async () => { const result = await fetch(id); if (!ignore) setValue(result); }; load(); return () => { ignore = true; };",
      0,
    ],
    ["const unused = () => queueMicrotask(() => setValue(id));", 0],
    ["load(id).then((result) => setValue(result));", 0],
    ["fetch(id).then((result) => setValue(result));", 0],
    ["queueMicrotask(() => { if (false) setValue(id); });", 0],
    ["setValue(id);", 0],
  ])("matches the direct decision for %s", (effectBody, expectedCount) => {
    expect(countDiagnostics(ASSIGN_HELPER, effectBody)).toBe(expectedCount);
    expect(countDiagnostics(ASSIGN_HELPER, forwardSetterCalls(effectBody))).toBe(expectedCount);
  });

  it.each([
    ["a block helper", "const assign = (setter, value) => { setter(value); };"],
    ["a returned call", "const assign = (setter, value) => { return setter(value); };"],
    ["a function declaration", "function assign(setter, value) { setter(value); }"],
    [
      "a generic TypeScript helper",
      "const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);",
    ],
  ])("reports %s inside a microtask", (_scenario, helper) => {
    expect(countDiagnostics(helper, "queueMicrotask(() => assign(setValue, id));")).toBe(1);
  });

  it("reports reordered arguments and an immutable setter alias", () => {
    expect(
      countDiagnostics(
        "const assign = (value, setter) => setter(value);",
        "queueMicrotask(() => assign(id, setValue));",
      ),
    ).toBe(1);
    expect(
      countDiagnostics(
        ASSIGN_HELPER,
        "const writer = setValue; Promise.resolve(id).then((result) => assign(writer, result));",
      ),
    ).toBe(1);
  });

  it.each(["setValue as CallableFunction", "setValue!", "setValue satisfies CallableFunction"])(
    "reports a transparently wrapped setter argument: %s",
    (setter) => {
      expect(
        countDiagnostics(ASSIGN_HELPER, `queueMicrotask(() => assign((${setter}), id));`),
      ).toBe(1);
    },
  );

  it.each([
    "queueMicrotask(() => clear(setValue));",
    "const load = async () => { await fetch(id); clear(setValue); }; load();",
  ])("reports an implicit undefined write: %s", (effectBody) => {
    expect(countDiagnostics("const clear = (setter) => setter();", effectBody)).toBe(1);
  });

  it.each([
    "queueMicrotask(() => assign.bind(null, consume)(setValue, id));",
    "const bound = assign.bind(null, consume); queueMicrotask(() => bound(setValue, id));",
    "queueMicrotask(() => assign.call(setValue, consume, id));",
    "queueMicrotask(() => assign.apply(setValue, [consume, id]));",
  ])("does not confuse bound arguments or receivers with a setter: %s", (effectBody) => {
    expect(countDiagnostics(ASSIGN_HELPER + " const consume = () => undefined;", effectBody)).toBe(
      0,
    );
  });

  it.each([
    ["an imported helper", 'import { assign } from "writer";'],
    ["an unknown helper", ""],
    ["a returned callback", "const assign = (setter, value) => () => setter(value);"],
    ["a registered callback", "const assign = (setter, value) => subscribe(setter, value);"],
    ["an async helper", "const assign = async (setter, value) => setter(value);"],
    ["a generator helper", "function* assign(setter, value) { setter(value); }"],
    ["a conditional helper", "const assign = (setter, value) => { if (value) setter(value); };"],
    [
      "a two-statement helper",
      "const assign = (setter, value) => { track(value); setter(value); };",
    ],
    ["an optional setter call", "const assign = (setter, value) => setter?.(value);"],
    ["a replaced helper", "let assign = (setter, value) => setter(value); assign = subscribe;"],
    [
      "a reassigned parameter",
      "const assign = (setter, value) => { setter = subscribe; setter(value); };",
    ],
    [
      "a subscription in a default parameter",
      "const assign = (setter, value, registration = subscribe((next) => setter(next))) => setter(value);",
    ],
    [
      "a shadowed setter",
      "const assign = (setter, value) => { const setValue = subscribe; setValue(value); };",
    ],
  ])("keeps %s quiet", (_scenario, helper) => {
    expect(countDiagnostics(ASSIGN_HELPER, "queueMicrotask(() => setValue(id));")).toBe(1);
    expect(countDiagnostics(helper, "queueMicrotask(() => assign(setValue, id));")).toBe(0);
  });

  it.each([
    "let writer = setValue; writer = subscribe; queueMicrotask(() => assign(writer, id));",
    "queueMicrotask(() => assign(subscribe, id));",
    "queueMicrotask(() => assign(value, id));",
  ])("keeps a non-setter argument quiet: %s", (effectBody) => {
    expect(countDiagnostics(ASSIGN_HELPER, effectBody)).toBe(0);
  });
});
