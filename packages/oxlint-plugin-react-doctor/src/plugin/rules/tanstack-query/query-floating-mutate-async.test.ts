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

  it.each([
    [
      "direct member binding",
      `const mutation = useMutation(options);
       const save = mutation.mutateAsync;
       save(payload);`,
    ],
    [
      "wrapped member binding and call",
      `const mutation = useMutation(options);
       const save = mutation!.mutateAsync as MutationFunction;
       (save as MutationFunction)(payload);`,
    ],
    [
      "aliased result member binding",
      `const mutation = useMutation(options);
       const aliasedMutation = mutation;
       const save = aliasedMutation.mutateAsync;
       save(payload);`,
    ],
    [
      "destructuring from a bound result",
      `const mutation = useMutation(options);
       const { mutateAsync: save } = mutation;
       save(payload);`,
    ],
  ])("flags a deferred mutateAsync %s", (_bindingName, source) => {
    const result = runMutationRule(source);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a handled deferred mutateAsync member binding", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const save = mutation.mutateAsync;
       const handleError = (error) => report(error);
       save(payload).catch(handleError);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent on an unrelated deferred mutateAsync member binding", () => {
    const result = runMutationRule(
      `const queue = createQueue();
       const save = queue.mutateAsync;
       save(payload);`,
    );
    expect(result.diagnostics).toHaveLength(0);
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

  it("flags a TypeScript-wrapped finally-only chain", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       mutation.mutateAsync(payload).finally!(stopLoading);`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("flags an awaited mutateAsync rejection in a discarded async event handler", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const view = <button onClick={async () => {
         await mutation.mutateAsync(payload);
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an awaited mutateAsync rejection caught inside an async event handler", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const view = <button onClick={async () => {
         try {
           await mutation.mutateAsync(payload);
         } catch (error) {
           report(error);
         }
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes aliased React effect imports", () => {
    const result = runMutationRule(
      `import { useEffect as runEffect } from "react";
       const mutation = useMutation(options);
       const callback = () => mutation.mutateAsync(payload);
       runEffect(callback, []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a local effect-like host handles the returned rejection", () => {
    const result = runMutationRule(
      `const useEffect = (callback) => callback().catch(handleError);
       const mutation = useMutation(options);
       const callback = () => mutation.mutateAsync(payload);
       useEffect(callback);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each(["setTimeout", "queueMicrotask"])(
    "stays silent when a local %s host handles the returned rejection",
    (schedulerName) => {
      const result = runMutationRule(
        `const ${schedulerName} = (callback) => callback().catch(handleError);
         const mutation = useMutation(options);
         const callback = () => mutation.mutateAsync(payload);
         ${schedulerName}(callback);`,
      );
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it("stays silent when a local scheduler object handles the returned rejection", () => {
    const result = runMutationRule(
      `const scheduler = { setTimeout: (callback) => callback().catch(handleError) };
       const mutation = useMutation(options);
       const callback = () => mutation.mutateAsync(payload);
       scheduler.setTimeout(callback);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags promises returned from global scheduler members", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const firstCallback = () => mutation.mutateAsync(first);
       const secondCallback = () => mutation.mutateAsync(second);
       window.setTimeout(firstCallback);
       globalThis.queueMicrotask(secondCallback);`,
    );
    expect(result.diagnostics).toHaveLength(2);
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
    [
      "conditional inline scheduler",
      "setTimeout(enabled ? () => mutation.mutateAsync(payload) : fallback)",
    ],
    ["asserted named scheduler", "setTimeout((scheduledCallback as () => void), 0)"],
    [
      "conditional collection callback",
      "items.forEach(enabled ? () => mutation.mutateAsync(payload) : fallback)",
    ],
  ])("flags a promise returned from a wrapped %s", (_wrapperName, invocation) => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const scheduledCallback = () => mutation.mutateAsync(payload);
       ${invocation};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["voided", "void mutation.mutateAsync(payload)"],
    ["rejection-handled", "mutation.mutateAsync(payload).catch(handleError)"],
  ])("handles a %s promise inside a wrapped effect callback", (usageName, promiseExpression) => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const handleError = (error) => report(error);
       const effectCallback = () => ${promiseExpression};
       useEffect(enabled ? effectCallback : fallback, [enabled]);`,
    );
    expect(result.diagnostics).toHaveLength(usageName === "voided" ? 1 : 0);
  });

  it.each([
    ["conditional", "enabled ? () => mutation.mutateAsync(payload) : undefined"],
    ["logical", "enabled && (() => mutation.mutateAsync(payload))"],
    ["TypeScript", "(() => mutation.mutateAsync(payload)) as () => void"],
  ])(
    "flags mutateAsync returned from a wrapped inline %s effect callback",
    (_wrapperName, callback) => {
      const result = runMutationRule(
        `const mutation = useMutation(options);
       useEffect(${callback}, [enabled]);`,
      );
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("flags mutateAsync returned through an event-handler helper", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const requestSave = () => mutation.mutateAsync(payload);
       const handleClick = () => requestSave();
       const view = <button onClick={handleClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutateAsync returned through a TypeScript-wrapped helper call", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const requestSave = () => mutation.mutateAsync(payload);
       const handleClick = () => (requestSave as () => Promise<void>)();
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

  it.each([
    ["TypeScript assertion", "(() => mutation.mutateAsync(payload)) as () => void"],
    ["satisfies expression", "(() => mutation.mutateAsync(payload)) satisfies () => void"],
    ["conditional selection", "enabled ? () => mutation.mutateAsync(payload) : undefined"],
  ])("flags mutateAsync returned through a wrapped event handler %s", (_wrapperName, handler) => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const view = <button onClick={${handler}} />;`,
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

  it("flags promises used only as conditional and logical tests", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const firstResult = mutation.mutateAsync(first) ? accepted : rejected;
       const secondResult = mutation.mutateAsync(second) && fallback;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags promises used only by statement, unary, and binary tests", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       if (mutation.mutateAsync(first)) consume(first);
       const isMissing = !mutation.mutateAsync(second);
       const isExpected = mutation.mutateAsync(third) === expected;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags discarded map hosts used only by statement, unary, and binary tests", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       if (items.map((item) => mutation.mutateAsync(item))) consume(items);
       const isMissing = !items.map((item) => mutation.mutateAsync(item));
       const isExpected = items.map((item) => mutation.mutateAsync(item)) === expected;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("keeps conditional and logical result branches reachable", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const firstPromise = enabled ? mutation.mutateAsync(first) : fallback;
       const secondPromise = enabled && mutation.mutateAsync(second);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps logical left values reachable through or and nullish coalescing", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const firstPromise = mutation.mutateAsync(first) || fallback;
       const secondPromise = mutation.mutateAsync(second) ?? fallback;
       firstPromise.catch(handleError);
       await secondPromise;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags explicitly voided promises through value-preserving wrappers", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       void (mutation.mutateAsync(first) ?? fallback);
       void (mutation.mutateAsync(second) || fallback);
       void (enabled ? mutation.mutateAsync(third) : fallback);
       void (enabled ? fallback : mutation.mutateAsync(fourth));
       void (prepare(), mutation.mutateAsync(fifth));`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("accepts awaited and rejection-handled promises through value-preserving wrappers", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const handleError = (error) => report(error);
       await (mutation.mutateAsync(first) ?? fallback);
       await (enabled ? mutation.mutateAsync(second) : fallback);
       void (mutation.mutateAsync(third) || fallback).catch(handleError);
       void (prepare(), mutation.mutateAsync(fourth)).catch(handleError);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags discarded rejection-forwarding Promise wrappers", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       Promise.resolve(mutation.mutateAsync(first));
       Promise.all([mutation.mutateAsync(second)]);
       Promise.race([mutation.mutateAsync(third)]);
       Promise.any([mutation.mutateAsync(fourth)]);`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("flags explicitly voided rejection-forwarding Promise wrappers", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       void Promise.resolve(mutation.mutateAsync(first));
       void Promise.all([mutation.mutateAsync(second)]);
       void Promise.race([mutation.mutateAsync(third)]);
       void Promise.any([mutation.mutateAsync(fourth)]);
       void Promise.all(items.map((item) => mutation.mutateAsync(item)));`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it.each(["all", "race", "any"])(
    "flags promises returned through a spread in discarded Promise.%s",
    (methodName) => {
      const result = runMutationRule(
        `const mutation = useMutation(options);
         Promise.${methodName}([existingPromise, ...items.map((item) => mutation.mutateAsync(item))]);`,
      );
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("flags a directly spread mutateAsync promise in a discarded aggregate", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       Promise.all([...mutation.mutateAsync(item)]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts promises returned through a spread in handled Promise aggregates", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const handleError = (error) => report(error);
       await Promise.all([existingPromise, ...items.map((item) => mutation.mutateAsync(item))]);
       Promise.allSettled([...items.map((item) => mutation.mutateAsync(item))]).catch(handleError);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts promises returned through a spread in discarded Promise.allSettled", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       Promise.allSettled([...items.map((item) => mutation.mutateAsync(item))]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags explicitly voided fulfillment-only continuation chains", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       void mutation.mutateAsync(first).then(onSuccess);
       void mutation.mutateAsync(second).finally(stopLoading);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts explicitly voided Promise wrappers with rejection handlers", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const handleError = (error) => report(error);
       void Promise.resolve(mutation.mutateAsync(first)).catch(handleError);
       void Promise.all([mutation.mutateAsync(second)]).then(onSuccess, handleError);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts handled rejection-forwarding Promise wrappers", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const handleError = (error) => report(error);
       await Promise.resolve(mutation.mutateAsync(first));
       Promise.all([mutation.mutateAsync(second)]).catch(handleError);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags promises returned from a discarded map result", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       items.map((item) => mutation.mutateAsync(item));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags promises returned from an explicitly voided map result", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       void items.map((item) => mutation.mutateAsync(item));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps promises reachable through a consumed map result", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const requests = items.map((item) => mutation.mutateAsync(item));
       await Promise.all(requests);`,
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

  it("flags explicit void because it still discards rejection handling", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       void mutation.mutateAsync(payload);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not assume a custom component callback discards returned promises", () => {
    const result = runMutationRule(
      `const mutation = useMutation(options);
       const onFinish = () => mutation.mutateAsync(payload);
       const form = <StepsForm onFinish={onFinish} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
