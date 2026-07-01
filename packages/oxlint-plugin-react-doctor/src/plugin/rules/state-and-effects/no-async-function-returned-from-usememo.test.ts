import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAsyncFunctionReturnedFromUsememo } from "./no-async-function-returned-from-usememo.js";

describe("no-async-function-returned-from-usememo", () => {
  it("flags a concise-body useMemo returning an async arrow", () => {
    const result = runRule(
      noAsyncFunctionReturnedFromUsememo,
      `const onAddAll = useMemo(() => async () => { await addAll(items); }, [items]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a block-body useMemo that returns an async arrow", () => {
    const result = runRule(
      noAsyncFunctionReturnedFromUsememo,
      `const fn = useMemo(() => { return async () => { await save(); }; }, [dep]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useMemo returning an async function expression", () => {
    const result = runRule(
      noAsyncFunctionReturnedFromUsememo,
      `const fn = useMemo(() => async function () { await save(); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags React.useMemo via the namespace", () => {
    const result = runRule(
      noAsyncFunctionReturnedFromUsememo,
      `const fn = React.useMemo(() => async () => { await save(); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag useCallback with an async function", () => {
    const result = runRule(
      noAsyncFunctionReturnedFromUsememo,
      `const fn = useCallback(async () => { await save(); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useMemo returning a synchronous factory function", () => {
    const result = runRule(
      noAsyncFunctionReturnedFromUsememo,
      `const fn = useMemo(() => () => doThing(), [dep]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useMemo returning a non-function value", () => {
    const result = runRule(
      noAsyncFunctionReturnedFromUsememo,
      `const value = useMemo(() => ({ a: 1, b: 2 }), [dep]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an async callback passed to a non-memo hook", () => {
    const result = runRule(
      noAsyncFunctionReturnedFromUsememo,
      `const fn = useEffect(() => async () => { await x(); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a locally shadowed useMemo", () => {
    const result = runRule(
      noAsyncFunctionReturnedFromUsememo,
      `const value = compute(() => async () => { await x(); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
