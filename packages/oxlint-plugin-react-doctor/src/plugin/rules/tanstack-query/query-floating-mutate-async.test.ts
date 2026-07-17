import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryFloatingMutateAsync } from "./query-floating-mutate-async.js";

const runMutationRule = (source: string) =>
  runRule(
    queryFloatingMutateAsync,
    `import { useMutation } from "@tanstack/react-query";
     ${source}`,
  );

describe("query-floating-mutate-async", () => {
  it("flags a bare call on a useMutation result", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       mutation.mutateAsync(payload);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags imported and destructured aliases", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `import { useMutation as useWrite } from "@tanstack/react-query";
       const { mutateAsync: write } = useWrite(options);
       write(payload);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a secondary alias of a destructured mutateAsync binding", () => {
    const result = runMutationRule(
      `const { mutateAsync } = useMutation(options);
       const save = mutateAsync;
       save(payload);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags namespace and result aliases", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `import * as Query from "@tanstack/react-query";
       const mutation = Query.useMutation(options);
       const aliasedMutation = mutation;
       aliasedMutation.mutateAsync(payload);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on unrelated mutateAsync methods", () => {
    const result = runMutationRule(
      `const queue = createQueue();
       queue.mutateAsync(payload);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent on a same-named local useMutation", () => {
    const result = runRule(
      queryFloatingMutateAsync,
      `const useMutation = () => ({ mutateAsync: save });
       const mutation = useMutation();
       mutation.mutateAsync(payload);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags empty and non-callable catch handlers", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       mutation.mutateAsync(first).catch();
       mutation.mutateAsync(second).catch(undefined);
       mutation.mutateAsync(third).catch(null);`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("accepts callable catch handlers", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const handleError = (error) => report(error);
       mutation.mutateAsync(first).catch(handleError);
       mutation.mutateAsync(second).catch((error) => report(error));
       mutation.mutateAsync(third).catch(console.error);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires a callable second then argument", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const onError = (error) => report(error);
       mutation.mutateAsync(first).then(onSuccess, undefined);
       mutation.mutateAsync(second).then(onSuccess, onError);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags fulfillment-only and finally-only chains", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       mutation.mutateAsync(first).then(onSuccess);
       mutation.mutateAsync(second).finally(stopLoading);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags concise and explicit returns from JSX event handlers", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const first = <button onClick={() => mutation.mutateAsync(payload)} />;
       const second = <button onClick={() => {
         return mutation.mutateAsync(payload);
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not treat arbitrary JSX callback props as event handlers", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const view = <DataLoader load={() => mutation.mutateAsync(payload)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a named event handler that returns mutateAsync", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const handleClick = () => {
         return mutation.mutateAsync(payload);
       };
       const view = <button onClick={handleClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useCallback event handler that returns mutateAsync", () => {
    const result = runMutationRule(
      `import { useCallback } from "react";
       const mutation = useMutation(options);
       const handleClick = useCallback(() => {
         return mutation.mutateAsync(payload);
       }, [mutation]);
       const view = <button onClick={handleClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["conditional consequent", "enabled ? effectCallback : fallback"],
    ["conditional alternate", "enabled ? fallback : effectCallback"],
    ["logical-and right", "enabled && effectCallback"],
    ["logical-or left", "effectCallback || fallback"],
    ["logical-or right", "enabled || effectCallback"],
    ["nullish-coalesce left", "effectCallback ?? fallback"],
    ["nullish-coalesce right", "enabled ?? effectCallback"],
    ["final sequence", "(fallback, effectCallback)"],
    ["transparent TypeScript", "effectCallback as EffectCallback"],
  ])("flags a %s wrapped effect callback", (_wrapperName, callbackExpression) => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const effectCallback = () => mutation.mutateAsync(payload);
       useEffect(${callbackExpression}, [enabled]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a conditional useCallback alias used by an effect", () => {
    const result = runMutationRule(
      `import { useCallback } from "react";
       const mutation = useMutation(options);
       const effectCallback = useCallback(() => mutation.mutateAsync(payload), [mutation]);
       const aliasedCallback = effectCallback;
       useEffect(enabled ? aliasedCallback : fallback, [aliasedCallback, enabled]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["conditional predicate", "effectCallback ? fallback : otherFallback"],
    ["logical-and left", "effectCallback && fallback"],
    ["non-final sequence", "(effectCallback, fallback)"],
  ])("does not treat a %s as the effect callback", (_wrapperName, callbackExpression) => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const effectCallback = () => mutation.mutateAsync(payload);
       useEffect(${callbackExpression}, [effectCallback]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["conditional consequent", "enabled ? effectCallback : fallback"],
    ["conditional alternate", "enabled ? fallback : effectCallback"],
    ["logical-and right", "enabled && effectCallback"],
    ["logical-and left", "effectCallback && fallback"],
    ["logical-or left", "effectCallback || fallback"],
    ["logical-or right", "enabled || effectCallback"],
    ["nullish-coalesce left", "effectCallback ?? fallback"],
    ["nullish-coalesce right", "enabled ?? effectCallback"],
    ["final sequence", "(fallback, effectCallback)"],
    ["transparent TypeScript", "effectCallback as EffectCallback"],
  ])("keeps a %s wrapped callback result reachable", (_wrapperName, callbackExpression) => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const effectCallback = () => mutation.mutateAsync(payload);
       const selectedCallback = ${callbackExpression};
       const promise = selectedCallback();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    "setTimeout",
    "setInterval",
    "requestAnimationFrame",
    "requestIdleCallback",
    "queueMicrotask",
    "setImmediate",
  ])("flags a promise returned from a %s callback", (schedulerName) => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const scheduledCallback = () => mutation.mutateAsync(payload);
       ${schedulerName}(scheduledCallback);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["voided", "void mutation.mutateAsync(payload)"],
    ["rejection-handled", "mutation.mutateAsync(payload).catch(handleError)"],
  ])("accepts a %s promise inside a wrapped effect callback", (_usageName, promiseExpression) => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const handleError = (error) => report(error);
       const effectCallback = () => ${promiseExpression};
       useEffect(enabled ? effectCallback : fallback, [enabled]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags mutateAsync returned through an event-handler helper", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const requestSave = () => mutation.mutateAsync(payload);
       const handleClick = () => requestSave();
       const view = <button onClick={handleClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutateAsync returned through an aliased event-handler helper", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const requestSave = () => mutation.mutateAsync(payload);
       const aliasedRequest = requestSave;
       const view = <button onClick={aliasedRequest} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutateAsync returned from immediately invoked functions", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       (() => mutation.mutateAsync(first))();
       (async () => mutation.mutateAsync(second))();`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags mutateAsync returned from a forEach callback", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       items.forEach((item) => mutation.mutateAsync(item));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags logical and conditional event-handler branches", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const first = <button onClick={() => canSave && mutation.mutateAsync(payload)} />;
       const second = <button onClick={() =>
         isNew ? mutation.mutateAsync(firstPayload) : mutation.mutateAsync(secondPayload)
       } />;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags discarded values inside sequence expressions", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       (mutation.mutateAsync(first), recordAttempt());
       (prepare(), mutation.mutateAsync(second));`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps the final sequence value reachable when its container is consumed", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const promise = (prepare(), mutation.mutateAsync(payload));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent when the promise remains reachable", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       async function awaited() {
         await mutation.mutateAsync(first);
       }
       function returned() {
         return mutation.mutateAsync(second);
       }
       const request = () => mutation.mutateAsync(fourth);
       async function indirectAwait() {
         await request();
       }
       const promise = mutation.mutateAsync(third);
       async function batched() {
         await Promise.all(items.map((item) => mutation.mutateAsync(item)));
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves the explicit void escape hatch", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       void mutation.mutateAsync(payload);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
