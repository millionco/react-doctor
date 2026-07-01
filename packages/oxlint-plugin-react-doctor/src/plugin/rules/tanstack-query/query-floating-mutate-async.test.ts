import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryFloatingMutateAsync } from "./query-floating-mutate-async.js";

describe("query-floating-mutate-async", () => {
  it("flags a bare mutateAsync statement", () => {
    const result = runRule(queryFloatingMutateAsync, `mutation.mutateAsync(payload);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutateAsync as the sole statement in a useEffect block", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `useEffect(() => { mutation.mutateAsync(payload); }, [id]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a concise useEffect arrow body", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `useEffect(() => mutation.mutateAsync(payload), [id]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a concise event-handler arrow body", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `const x = <button onClick={() => mutation.mutateAsync(payload)} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an awaited call", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `async function f() { await mutation.mutateAsync(payload); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a returned call", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `function f() { return mutation.mutateAsync(payload); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a voided call", () => {
    const result = runRule(queryFloatingMutateAsync, `void mutation.mutateAsync(payload);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chained catch", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `mutation.mutateAsync(payload).catch(handleError);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an assigned promise", () => {
    const result = runRule(queryFloatingMutateAsync, `const p = mutation.mutateAsync(payload);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag mutateAsync args to an awaited Promise.all", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `async function f() { await Promise.all([a.mutateAsync(x), b.mutateAsync(y)]); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a concise arrow mapped into Promise.all", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `async function f() { await Promise.all(items.map((item) => mutation.mutateAsync(item))); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag refetch or invalidateQueries", () => {
    const refetch = runRule(queryFloatingMutateAsync, `query.refetch();`);
    expect(refetch.diagnostics).toHaveLength(0);
    const invalidate = runRule(queryFloatingMutateAsync, `client.invalidateQueries({ queryKey });`);
    expect(invalidate.diagnostics).toHaveLength(0);
  });

  it("does not flag a computed mutateAsync member", () => {
    const result = runRule(queryFloatingMutateAsync, `obj['mutateAsync'](payload);`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
