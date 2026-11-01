import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

const ASSIGN_HELPER = "const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);";

const buildSource = (helper: string, effectBody: string, dispatchDeclaration?: string): string =>
  `import { useEffect, useReducer } from "react";
  ${helper}
  const reducer = (state: number, action: { type: string }) =>
    action.type === "reset" ? 0 : state + 1;
  const Counter = ({ id }: { id: string }) => {
    ${dispatchDeclaration ?? "const [count, dispatch] = useReducer(reducer, 0);"}
    useEffect(() => { ${effectBody} }, [id]);
    return count;
  };`;

const countDiagnostics = (
  helper: string,
  effectBody: string,
  dispatchDeclaration?: string,
): number => {
  const result = runRule(
    noSetStateAfterAwaitInEffect,
    buildSource(helper, effectBody, dispatchDeclaration),
  );
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.length;
};

describe("no-set-state-after-await-in-effect forwarded reducer dispatch", () => {
  it.each([
    ['queueMicrotask(() => dispatch({ type: "reset" }));', 1],
    ['Promise.resolve(id).then(() => dispatch({ type: "reset" }));', 1],
    ['const load = async () => { await fetch(id); dispatch({ type: "reset" }); }; load();', 1],
    [
      'let ignore = false; queueMicrotask(() => { if (!ignore) dispatch({ type: "reset" }); }); return () => { ignore = true; };',
      0,
    ],
    ['dispatch({ type: "reset" });', 0],
  ])("matches the direct dispatch decision for %s", (effectBody, expectedCount) => {
    const forwardedBody = effectBody.replace(
      /\bdispatch\((\{ type: "reset" \})\)/g,
      "assign(dispatch, $1)",
    );
    expect(countDiagnostics(ASSIGN_HELPER, effectBody)).toBe(expectedCount);
    expect(countDiagnostics(ASSIGN_HELPER, forwardedBody)).toBe(expectedCount);
  });

  it("reports a forwarded dispatch inside a microtask", () => {
    expect(
      countDiagnostics(ASSIGN_HELPER, 'queueMicrotask(() => assign(dispatch, { type: "reset" }));'),
    ).toBe(1);
  });

  it.each([
    ["an async helper", "const assign = async (setter, next) => setter(next);"],
    ["a conditional helper", "const assign = (setter, next) => { if (next) setter(next); };"],
    ["an imported helper", 'import { assign } from "./assign";'],
    [
      "a reassigned helper",
      "let assign = (setter, next) => setter(next); assign = (setter, next) => {};",
    ],
  ])("stays quiet for %s", (_scenario, helper) => {
    expect(
      countDiagnostics(helper, 'queueMicrotask(() => assign(dispatch, { type: "reset" }));'),
    ).toBe(0);
  });

  it("stays quiet when the dispatch binding is reassigned", () => {
    expect(
      countDiagnostics(
        ASSIGN_HELPER,
        'queueMicrotask(() => assign(dispatch, { type: "reset" }));',
        "let [count, dispatch] = useReducer(reducer, 0); dispatch = () => {};",
      ),
    ).toBe(0);
  });

  it("stays quiet for a non-reducer callback forwarded through the helper", () => {
    expect(
      countDiagnostics(
        ASSIGN_HELPER,
        'queueMicrotask(() => assign(dispatch, { type: "reset" }));',
        "const [count] = useReducer(reducer, 0); const dispatch = (action) => console.log(action);",
      ),
    ).toBe(0);
  });

  it.each([
    ["no-adjust-state-on-prop-change", noAdjustStateOnPropChange],
    ["no-reset-all-state-on-prop-change", noResetAllStateOnPropChange],
  ])("leaves %s unchanged for a forwarded dispatch", (_ruleId, rule) => {
    const directResult = runRule(rule, buildSource(ASSIGN_HELPER, 'dispatch({ type: "reset" });'));
    const forwardedResult = runRule(
      rule,
      buildSource(ASSIGN_HELPER, 'assign(dispatch, { type: "reset" });'),
    );
    expect(directResult.diagnostics).toEqual([]);
    expect(forwardedResult.diagnostics).toEqual([]);
  });
});

describe("forwarded reducer dispatch alias provenance", () => {
  it("does not treat an alias captured after dispatch replacement as React dispatch", () => {
    expect(
      countDiagnostics(
        ASSIGN_HELPER,
        'queueMicrotask(() => assign(writer, {type: "reset"}));',
        "let [count, dispatch] = useReducer(reducer, 0); dispatch = () => {}; const writer = dispatch;",
      ),
    ).toBe(0);
  });

  it("reports through an immutable alias chain of an unmodified dispatch", () => {
    expect(
      countDiagnostics(
        ASSIGN_HELPER,
        'queueMicrotask(() => assign(writer, {type: "reset"}));',
        "const [count, dispatch] = useReducer(reducer, 0); const first = dispatch; const writer = first;",
      ),
    ).toBe(1);
  });

  it("does not accept a useReducer name shadowed by a custom factory", () => {
    expect(
      countDiagnostics(
        ASSIGN_HELPER,
        'queueMicrotask(() => assign(dispatch, {type: "reset"}));',
        "const useReducer = () => [0, () => {}]; const [count, dispatch] = useReducer();",
      ),
    ).toBe(0);
  });
});
