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

  it("flags an optional-chained bare mutateAsync statement", () => {
    const result = runRule(queryFloatingMutateAsync, `ref.current?.mutateAsync(payload);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an awaited optional-chained mutateAsync", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `async function f() { await ref.current?.mutateAsync(payload); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a floating destructured mutateAsync call", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `const { mutateAsync } = useMutation(opts); mutateAsync(payload);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an awaited destructured mutateAsync call", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `const { mutateAsync } = useMutation(opts);
       async function f() { await mutateAsync(payload); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare mutateAsync identifier with no useMutation destructure", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `const mutateAsync = () => save(payload); mutateAsync(payload);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a mutateAsync parameter shadowing a useMutation destructure", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `const { mutateAsync } = useMutation(opts);
       const run = (mutateAsync) => { mutateAsync(payload); };
       run(fireAndForgetCallback);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags mutateAsync followed only by a fulfillment .then", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `mutation.mutateAsync(payload).then(onSuccess);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutateAsync followed only by .finally", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `mutation.mutateAsync(payload).finally(stopLoading);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a two-argument .then with a rejection handler", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `mutation.mutateAsync(payload).then(onSuccess, onError);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a .then chain closed by .catch", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `mutation.mutateAsync(payload).then(onSuccess).catch(onError);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a returned .then chain", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `function f() { return mutation.mutateAsync(payload).then(onSuccess); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags both branches of a ternary concise handler body", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `const x = <button onClick={() => (isNew ? create.mutateAsync(v) : update.mutateAsync(v))} />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a logical-guarded concise handler body", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `const x = <button onClick={() => canSave && mutation.mutateAsync(v)} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a ternary branch assigned to a variable", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `const p = isNew ? create.mutateAsync(v) : null;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a logical left-operand mutateAsync statement", () => {
    const result = runRule(queryFloatingMutateAsync, `mutation.mutateAsync(payload) && refetch();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutateAsync discarded as a bare ternary test", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `mutation.mutateAsync(payload) ? onDone() : onFail();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a logical left-operand assigned to a variable", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `const didStart = mutation.mutateAsync(payload) && true;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
