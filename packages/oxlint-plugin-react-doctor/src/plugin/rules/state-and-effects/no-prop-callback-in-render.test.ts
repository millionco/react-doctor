import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPropCallbackInRender } from "./no-prop-callback-in-render.js";

const run = (code: string) => runRule(noPropCallbackInRender, code);

describe("no-prop-callback-in-render", () => {
  it.each([
    [
      "a ref-guarded error notification",
      `import { useRef } from "react";
       const Image = ({ error, onError }) => {
         const notifiedErrorRef = useRef();
         if (error && error !== notifiedErrorRef.current) {
           notifiedErrorRef.current = error;
           onError?.(error);
         }
         return null;
       };`,
    ],
    [
      "a callback on the whole props object",
      `function Image(props) {
         if (props.error) props.onError(props.error);
         return null;
       }`,
    ],
    [
      "an immutable callback alias",
      `const Image = ({ error, onError }) => {
         const notifyError = onError;
         if (error) notifyError(error);
         return null;
       };`,
    ],
    [
      "an IIFE that executes while rendering",
      `const Image = ({ error, onError }) => {
         (() => { if (error) onError(error); })();
         return null;
       };`,
    ],
    [
      "a synchronous iteration callback",
      `const List = ({ items, onVisit }) => {
         items.forEach((item) => { onVisit(item); });
         return null;
       };`,
    ],
    [
      "a concise IIFE",
      `const Image = ({ error, onError }) => {
         if (error) (() => onError(error))();
         return null;
       };`,
    ],
    [
      "a concise forEach callback",
      `const List = ({ items, onVisit }) => {
         items.forEach((item) => onVisit(item));
         return null;
       };`,
    ],
    [
      "a custom hook callback",
      `const useNotifyError = (error, onError) => {
         if (error) onError(error);
       };`,
    ],
    [
      "a handler method on a custom hook options parameter",
      `const useNotifyError = (options) => {
         options.onError();
       };`,
    ],
    [
      "a static-computed handler method on a custom hook options parameter",
      `const useNotifyError = (options) => {
         options["handleError"]();
       };`,
    ],
    [
      "an optional handler method on a custom hook options parameter",
      `const useNotifyError = (options) => {
         options?.onError?.();
       };`,
    ],
    [
      "call on a custom hook callback parameter",
      `const useNotifyError = (notify) => {
         notify.call(null);
       };`,
    ],
    [
      "static-computed apply on a custom hook callback parameter",
      `const useNotifyError = (notify) => {
         notify["apply"](null, []);
       };`,
    ],
    [
      "a destructured callback from a custom hook options parameter",
      `const useNotifyError = (options) => {
         const { notify } = options;
         notify();
       };`,
    ],
    [
      "an opaque method on a custom hook parameter",
      `const useRegistry = (registry) => {
         registry.query();
       };`,
    ],
    [
      "a mutating method on a typed store hook parameter",
      `interface Store<T> { setState(value: T): void }
       const useStoreSync = <T,>(store: Store<T>, state: T) => {
         store.setState(state);
       };`,
    ],
    [
      "a mutating array method on a custom hook parameter",
      `const useMutateItems = (items: string[]) => {
         items.sort();
       };`,
    ],
    [
      "a native-looking method after its parameter is reassigned",
      `const useItems = (items: string[], onRender: typeof items.forEach) => {
         items = { forEach: onRender } as unknown as string[];
         items.forEach(() => {});
       };`,
    ],
    [
      "an overwritten native method",
      `const useItems = (items: string[], onRender: typeof items.forEach) => {
         items.forEach = onRender;
         items.forEach(() => {});
       };`,
    ],
    [
      "a dynamically overwritten native method",
      `const useItems = (
         items: string[],
         methodName: keyof typeof items,
         onRender: typeof items.forEach,
       ) => {
         items[methodName] = onRender;
         items.forEach(() => {});
       };`,
    ],
    [
      "a native-looking method after a synchronous helper reassigns its parameter",
      `const useItems = (items: string[], onRender: typeof items.forEach) => {
         const replaceItems = () => {
           items = { forEach: onRender } as unknown as string[];
         };
         replaceItems();
         items.forEach(() => {});
       };`,
    ],
    [
      "a native type name shadowed by an enclosing type parameter",
      `const useItems = <Array extends { forEach(callback: () => void): void }>(items: Array) => {
         items.forEach(() => {});
       };`,
    ],
    [
      "a mutating Set method on a custom hook parameter",
      `const useMutateValues = (values: Set<string>) => {
         values.add("next");
       };`,
    ],
    [
      "a mutating Map method on a custom hook parameter",
      `const useMutateEntries = (entries: Map<string, number>) => {
         entries.set("next", 1);
       };`,
    ],
    [
      "a method on a locally shadowed native type name",
      `type Array<T> = { forEach(callback: (value: T) => void): void };
       const useItems = (items: Array<string>) => {
         items.forEach((item) => consume(item));
       };`,
    ],
    [
      "a callback parameter passed to native iteration",
      `const useVisitItems = (items: readonly string[], onVisit: (item: string) => void) => {
         items.forEach(onVisit);
       };`,
    ],
    [
      "callback values invoked by native iteration",
      `const useRunCallbacks = (callbacks: ReadonlyArray<() => void>) => {
         callbacks.forEach((callback) => callback());
       };`,
    ],
    [
      "callback methods invoked by native iteration",
      `interface Action { run(): void }
       const useRunActions = (actions: readonly Action[]) => {
         actions.forEach((action) => action.run());
       };`,
    ],
    [
      "nested callback methods invoked by native iteration",
      `interface Action { nested: { run(): void } }
       const useRunActions = (actions: readonly Action[]) => {
         actions.forEach((action) => action.nested.run());
       };`,
    ],
    [
      "callback values invoked by a local iterator binding",
      `const useRunCallbacks = (callbacks: ReadonlyArray<() => void>) => {
         const runCallback = (callback: () => void) => callback();
         callbacks.forEach(runCallback);
       };`,
    ],
    [
      "a local iterator binding that invokes a captured callback parameter",
      `const useVisitItems = (items: readonly string[], onVisit: (item: string) => void) => {
         const visitItem = (item: string) => onVisit(item);
         items.forEach(visitItem);
       };`,
    ],
    [
      "aliased callback values invoked by native iteration",
      `const useRunCallbacks = (callbacks: ReadonlyArray<() => void>) => {
         callbacks.forEach((callback) => {
           const firstAlias = callback;
           const secondAlias = firstAlias;
           secondAlias();
         });
       };`,
    ],
    [
      "destructured callback methods invoked by native iteration",
      `interface Action { run(): void }
       const useRunActions = (actions: readonly Action[]) => {
         actions.forEach((action) => {
           const { run } = action;
           run();
         });
       };`,
    ],
    [
      "reassigned callback values invoked by native iteration",
      `const useRunCallbacks = (callbacks: ReadonlyArray<() => void>) => {
         callbacks.forEach((callback) => {
           let assignedCallback = () => {};
           assignedCallback = callback;
           assignedCallback();
         });
       };`,
    ],
    [
      "rest-destructured callback methods invoked by native iteration",
      `interface Action { run(): void }
       const useRunActions = (actions: readonly Action[]) => {
         actions.forEach((action) => {
           const { ...actionAlias } = action;
           actionAlias.run();
         });
       };`,
    ],
    [
      "array-destructured callback values invoked by native iteration",
      `const useRunCallbacks = (callbackGroups: ReadonlyArray<readonly [() => void]>) => {
         callbackGroups.forEach((callbackGroup) => {
           const [callback] = callbackGroup;
           callback();
         });
       };`,
    ],
    [
      "a callback retrieved from a native collection",
      `const useRunCallback = (callbacks: ReadonlyMap<string, () => void>) => {
         callbacks.get("ready")?.();
       };`,
    ],
    [
      "a callback method retrieved from a native collection",
      `interface Action { run(): void }
       const useRunAction = (actions: ReadonlyArray<Action>) => {
         actions.at(0)?.run();
       };`,
    ],
  ])("reports %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a rendered callback result",
      `const List = ({ item, renderItem }) => <div>{renderItem(item)}</div>;`,
    ],
    [
      "rendered callback results from a concise map callback",
      `const List = ({ items, renderItem }) => <div>{items.map((item) => renderItem(item))}</div>;`,
    ],
    [
      "comparison results from a concise sort callback",
      `const List = ({ items, compareItems }) => {
         const copy = [...items];
         copy.sort((firstItem, secondItem) => compareItems(firstItem, secondItem));
         return <div>{copy.join(", ")}</div>;
       };`,
    ],
    [
      "mapped results from a concise callback",
      `const List = ({ items, transformItem }) => {
         items.map((item) => transformItem(item));
         return null;
       };`,
    ],
    [
      "mapped results from a generic call",
      `const List = ({ items, transformItem }) => {
         items.map<string>((item) => transformItem(item));
         return null;
       };`,
    ],
    [
      "mapped results from Array.from",
      `const List = ({ items, transformItem }) => {
         Array.from(items, (item) => transformItem(item));
         return null;
       };`,
    ],
    [
      "a discarded useMemo result",
      `import { useMemo } from "react";
       const Panel = ({ value, computeValue }) => {
         useMemo(() => computeValue(value), [computeValue, value]);
         return null;
       };`,
    ],
    [
      "a returned callback result",
      `const Panel = ({ value, selectView }) => { return selectView(value); };`,
    ],
    [
      "a locally consumed callback result",
      `const Form = ({ value, validate }) => {
         const validation = validate(value);
         return <output>{validation}</output>;
       };`,
    ],
    [
      "an event handler",
      `const Button = ({ onSave }) => <button onClick={() => onSave()}>Save</button>;`,
    ],
    [
      "an effect",
      `import { useEffect } from "react";
       const Image = ({ error, onError }) => {
         useEffect(() => { if (error) onError(error); }, [error, onError]);
         return null;
       };`,
    ],
    [
      "a deferred callback",
      `const Image = ({ error, onError }) => {
         if (error) queueMicrotask(() => onError(error));
         return null;
       };`,
    ],
    [
      "a useMemo value producer",
      `import { useMemo } from "react";
       const Panel = ({ value, computeValue }) => {
         const result = useMemo(() => computeValue(value), [computeValue, value]);
         return <output>{result}</output>;
       };`,
    ],
    [
      "a shadowed callback name",
      `const Image = ({ error, onError }) => {
         const notify = (onError) => { if (error) onError(error); };
         return notify(() => {});
       };`,
    ],
    [
      "a data method on a destructured prop",
      `const List = ({ items }) => {
         items.forEach((item) => { item.validate(); });
         return null;
       };`,
    ],
    [
      "native array iteration on a typed custom hook parameter",
      `const useItemTotal = (items: readonly string[]) => {
         let total = 0;
         items.forEach((item) => { total += item.length; });
         return total;
       };`,
    ],
    [
      "native array transforms on a custom hook parameter",
      `const useItems = (items: readonly string[]) => {
         items.map((item) => item.length);
         items.filter((item) => item.length > 0);
       };`,
    ],
    [
      "native Map and Set iteration on custom hook parameters",
      `const useEntries = (entries: ReadonlyMap<string, number>, values: ReadonlySet<number>) => {
         entries.forEach((value) => { consume(value); });
         values.forEach((value) => { consume(value); });
       };`,
    ],
    [
      "a read method shared by native collection union members",
      `const useEntries = (values: readonly string[] | ReadonlySet<string>) => {
         values.forEach((value) => { consume(value); });
       };`,
    ],
    [
      "a native string method on a custom hook parameter",
      `const useNormalizedValue = (value: string) => {
         value.trim();
       };`,
    ],
    [
      "non-invoking function and Promise methods on typed custom hook parameters",
      `const useDeferredValue = (callback: () => void, promise: Promise<string>) => {
         callback.bind(null);
         promise.then((value) => consume(value));
       };`,
    ],
    [
      "native iteration through a stable parameter alias",
      `const useItemTotal = (items: readonly string[]) => {
         const values = items;
         values.forEach((item) => { consume(item); });
       };`,
    ],
    [
      "native iteration with a local callback binding",
      `const useItemTotal = (items: readonly string[]) => {
         const visitItem = (item: string) => consume(item);
         items.forEach(visitItem);
       };`,
    ],
    [
      "native iteration that defers a captured callback parameter",
      `const useVisitItems = (items: readonly string[], onVisit: (item: string) => void) => {
         items.forEach((item) => {
           queueMicrotask(() => onVisit(item));
         });
       };`,
    ],
    [
      "native iteration through TypeScript and optional-chain wrappers",
      `const useItemTotal = (items: readonly string[]) => {
         (items as string[])?.forEach?.((item) => { consume(item); });
       };`,
    ],
    [
      "native iteration on a later function-declaration parameter",
      `function useItemTotal(seed: number, items: readonly string[] = []) {
         items.forEach((item) => { consume(seed, item); });
       }`,
    ],
    [
      "a global Array annotation with an unrelated nested type declaration",
      `const useItemTotal = (items: Array<string>) => {
         items.forEach((item) => { consume(item); });
       };
       const unrelated = () => {
         type Array<T> = { value: T };
         return null as Array<string> | null;
       };`,
    ],
    [
      "native iteration before the method is overwritten",
      `const useItems = (items: string[], replacement: typeof items.forEach) => {
         items.forEach((item) => { consume(item); });
         items.forEach = replacement;
       };`,
    ],
  ])("stays silent for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
