import {
  PROVIDER_PROOF_SMALL_COMPONENT_COUNT,
  PROVIDER_PROOF_LARGE_COMPONENT_COUNT,
  PROVIDER_PROOF_MAX_GROWTH_RATIO,
} from "../../../test-utils/constants.js";
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
         return <div />;
       }`,
    ],
    [
      "an immutable callback alias",
      `const Image = ({ error, onError }) => {
         const notifyError = onError;
         if (error) notifyError(error);
         return <div />;
       };`,
    ],
    [
      "an IIFE that executes while rendering",
      `const Image = ({ error, onError }) => {
         (() => { if (error) onError(error); })();
         return <div />;
       };`,
    ],
    [
      "a synchronous iteration callback",
      `const List = ({ items, onVisit }) => {
         items.forEach((item) => { onVisit(item); });
         return <div />;
       };`,
    ],
    [
      "a concise IIFE",
      `const Image = ({ error, onError }) => {
         if (error) (() => onError(error))();
         return <div />;
       };`,
    ],
    [
      "a concise forEach callback",
      `const List = ({ items, onVisit }) => {
         items.forEach((item) => onVisit(item));
         return <div />;
       };`,
    ],
    [
      "a custom hook callback",
      `const useNotifyError = (error, onError) => {
         if (error) onError(error);
       };`,
    ],
    [
      "a component prop forwarded to a custom hook callback",
      `const useNotifyError = (error, onError) => {
         if (error) onError(error);
       };
       const Image = ({ error, onError }) => {
         useNotifyError(error, onError);
         return <div />;
       };`,
    ],
    [
      "a component prop forwarded in a custom hook options object",
      `const useNotifyError = (options) => {
         options.onError();
       };
       const Image = ({ onError }) => {
         useNotifyError({ onError });
         return <div />;
       };`,
    ],
    [
      "a component prop forwarded through chained custom hooks",
      `const useNotifyError = (onError) => {
         onError();
       };
       const useImageError = (onError) => {
         useNotifyError(onError);
       };
       const Image = ({ onError }) => {
         useImageError(onError);
         return <div />;
       };`,
    ],
    [
      "a defaulted component options prop forwarded to a custom hook",
      `const useNotifyError = ({ onError }) => {
         onError();
       };
       const Image = ({ options = {} }) => {
         useNotifyError(options);
         return <div />;
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
      "a custom hook whose name is shadowed by a CommonJS export",
      `function useItems(items) {
         items.forEach(() => {});
       }
       function exposeReplacement() {
         const useItems = () => {};
         exports.useItems = useItems;
       }`,
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
      "compiled native iteration in a CommonJS-exported custom hook",
      `exports.useMultipleFocusControl = useMultipleFocusControl;
       function useMultipleFocusControl(activeDrawersIds) {
         activeDrawersIds.forEach((drawerId) => {
           consume(drawerId);
         });
       }`,
    ],
    [
      "an arrow custom hook exported through CommonJS",
      `const useSyncState = (setState) => {
         setState("fresh");
       };
       exports.useSyncState = useSyncState;`,
    ],
    [
      "a custom hook exported through an ESM specifier",
      `const useSyncState = (setState) => {
         setState("fresh");
       };
       export { useSyncState };`,
    ],
    [
      "same-component state setters passed to a local custom hook",
      `import { useState } from "react";
       const useSyncState = (state, setState) => {
         if (state === "stale") setState("fresh");
       };
       const Panel = () => {
         const [state, setState] = useState("fresh");
         useSyncState(state, setState);
         return <div>{state}</div>;
       };`,
    ],
    [
      "state setters on an exported custom hook options object",
      `interface SyncOptions {
         state: string;
         setState: (state: string) => void;
       }
       export const useSyncState = ({ state, setState }: SyncOptions) => {
         if (state === "stale") setState("fresh");
       };`,
    ],
    [
      "an options object with a sibling prop and local state setter",
      `import { useState } from "react";
       const useSyncState = ({ onReady, setState }) => {
         if (onReady) setState("fresh");
       };
       const Panel = ({ onReady }) => {
         const [state, setState] = useState("fresh");
         const options = { onReady, setState };
         useSyncState(options);
         return <div>{state}</div>;
       };`,
    ],
    [
      "a defaulted options setter with a sibling prop",
      `import { useState } from "react";
       const useSyncState = ({ onReady, setState = () => {} }) => {
         if (onReady) setState("fresh");
       };
       const Panel = ({ onReady }) => {
         const [state, setState] = useState("fresh");
         useSyncState({ onReady, setState });
         return <div>{state}</div>;
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

  it.each([
    [
      "a PascalCase plugin installer arrow with an explicit void return",
      `interface PluginProps {
         addModule: (name: string) => void;
       }
       const EventsHarnessPlugin = ({ addModule }: PluginProps): void => {
         addModule("test-events");
       };
       const installPlugin = (props: PluginProps): void => {
         EventsHarnessPlugin(props);
       };`,
      0,
    ],
    [
      "a PascalCase plugin installer declaration with an inferred void return",
      `interface PluginProps {
         addModule: (name: string) => void;
       }
       function EventsHarnessPlugin({ addModule }: PluginProps) {
         addModule("test-events");
       }
       const installPlugin = (props: PluginProps): void => {
         EventsHarnessPlugin(props);
       };`,
      0,
    ],
    [
      "a PascalCase plugin installer arrow without a return statement",
      `interface PluginProps {
         addModule: (name: string) => void;
       }
       const EventsHarnessPlugin = ({ addModule }: PluginProps) => {
         addModule("test-events");
       };`,
      0,
    ],
    [
      "a behavior-equivalent camelCase plugin installer",
      `interface PluginProps {
         addModule: (name: string) => void;
       }
       const eventsHarnessPlugin = ({ addModule }: PluginProps): void => {
         addModule("test-events");
       };
       const installPlugin = (props: PluginProps): void => {
         eventsHarnessPlugin(props);
       };`,
      0,
    ],
    [
      "a plugin installer invoked directly",
      `interface PluginProps {
         addModule: (name: string) => void;
       }
       function EventsHarnessPlugin({ addModule }: PluginProps): void {
         addModule("test-events");
       }
       const config = { modules: [] as string[] };
       EventsHarnessPlugin({ addModule: (name) => config.modules.push(name) });`,
      0,
    ],
    [
      "a plugin installer invoked from an array iteration",
      `interface PluginProps {
         addModule: (name: string) => void;
       }
       interface Plugin {
         (props: PluginProps): void;
       }
       function EventsHarnessPlugin({ addModule }: PluginProps): void {
         addModule("test-events");
       }
       const installPlugins = (plugins: readonly Plugin[], props: PluginProps): void => {
         plugins.forEach((plugin) => plugin(props));
       };
       installPlugins([EventsHarnessPlugin], { addModule: () => undefined });`,
      0,
    ],
    [
      "a plugin installer mutating only fresh render-local configuration",
      `interface PluginProps {
         addModule: (name: string) => void;
       }
       interface Plugin {
         (props: PluginProps): void;
       }
       function EventsHarnessPlugin({ addModule }: PluginProps): void {
         addModule("test-events");
       }
       const withPlugins = (plugins: readonly Plugin[]) => {
         const config = { modules: [] as string[] };
         const addModule = (name: string): void => {
           config.modules.push(name);
         };
         plugins.forEach((plugin) => plugin({ addModule }));
         return config;
       };
       withPlugins([EventsHarnessPlugin]);`,
      0,
    ],
    [
      "an aliased and TypeScript-wrapped plugin callback",
      `interface PluginProps {
         addModule: (name: string) => void;
       }
       function EventsHarnessPlugin({ addModule }: PluginProps): void {
         const registerModule = addModule;
         (registerModule satisfies PluginProps["addModule"])("test-events");
       }`,
      0,
    ],
    [
      "a PascalCase installer with a misleading userland hook and null return",
      `interface PluginProps {
         addModule: (name: string) => void;
       }
       const useRegistry = (): void => undefined;
       function EventsHarnessPlugin({ addModule }: PluginProps) {
         useRegistry();
         addModule("test-events");
         return null;
       }`,
      0,
    ],
    [
      "a PascalCase installer with a shadowed React hook name and null return",
      `interface PluginProps {
         addModule: (name: string) => void;
       }
       const useState = (): void => undefined;
       function EventsHarnessPlugin({ addModule }: PluginProps) {
         useState();
         addModule("test-events");
         return null;
       }`,
      0,
    ],
    [
      "an unrendered hookless null-returning PascalCase function",
      `interface RenderLikeProps {
         onRender: () => void;
       }
       function RenderLike({ onRender }: RenderLikeProps) {
         onRender();
         return null;
       }`,
      0,
    ],
    [
      "a hookless null component proven by JSX use",
      `interface NullComponentProps {
         onRender: () => void;
       }
       function NullComponent({ onRender }: NullComponentProps) {
         onRender();
         return null;
       }
       const node = <NullComponent onRender={() => undefined} />;`,
      1,
    ],
    [
      "a memo-wrapped hookless null component proven by JSX use",
      `import { memo } from "react";
       interface NullComponentProps {
         onRender: () => void;
       }
       const NullComponent = memo(({ onRender }: NullComponentProps) => {
         onRender();
         return null;
       });
       const node = <NullComponent onRender={() => undefined} />;`,
      1,
    ],
    [
      "a forwardRef-wrapped hookless null component proven by JSX use",
      `import * as React from "react";
       interface NullComponentProps {
         onRender: () => void;
       }
       const NullComponent = React.forwardRef<unknown, NullComponentProps>(
         ({ onRender }, forwardedRef) => {
           onRender();
           return null;
         },
       );
       const node = <NullComponent onRender={() => undefined} />;`,
      1,
    ],
    [
      "an observer-wrapped hookless null component proven by JSX use",
      `import { observer } from "mobx-react-lite";
       interface NullComponentProps {
         onRender: () => void;
       }
       const NullComponent = observer(({ onRender }: NullComponentProps) => {
         onRender();
         return null;
       });
       const node = <NullComponent onRender={() => undefined} />;`,
      1,
    ],
    [
      "a hookless null component proven by React createElement use",
      `import { createElement } from "react";
       interface NullComponentProps {
         onRender: () => void;
       }
       function NullComponent({ onRender }: NullComponentProps) {
         onRender();
         return null;
       }
       const node = createElement(NullComponent, { onRender: () => undefined });`,
      1,
    ],
    [
      "a hookless null component proven by an immutable createElement alias",
      `import { createElement } from "react";
       interface NullComponentProps {
         onRender: () => void;
       }
       function NullComponent({ onRender }: NullComponentProps) {
         onRender();
         return null;
       }
       const renderElement = createElement;
       const node = renderElement(NullComponent, { onRender: () => undefined });`,
      1,
    ],
    [
      "a hookless null component proven through a const JSX alias",
      `interface NullComponentProps {
         onRender: () => void;
       }
       function NullComponent({ onRender }: NullComponentProps) {
         onRender();
         return null;
       }
       const AliasedNullComponent = NullComponent;
       const node = <AliasedNullComponent onRender={() => undefined} />;`,
      1,
    ],
    [
      "a hookless null component proven through a TypeScript-wrapped alias",
      `interface NullComponentProps {
         onRender: () => void;
       }
       interface NullComponentType {
         (props: NullComponentProps): null;
       }
       function NullComponent({ onRender }: NullComponentProps) {
         onRender();
         return null;
       }
       const AliasedNullComponent = NullComponent satisfies NullComponentType;
       const node = <AliasedNullComponent onRender={() => undefined} />;`,
      1,
    ],
    [
      "a hookless null component proven through nested TypeScript-wrapped aliases",
      `interface NullComponentProps {
         onRender: () => void;
       }
       interface NullComponentType {
         (props: NullComponentProps): null;
       }
       function NullComponent({ onRender }: NullComponentProps) {
         onRender();
         return null;
       }
       const AliasedNullComponent =
         (NullComponent as NullComponentType) satisfies NullComponentType;
       const node = <AliasedNullComponent onRender={() => undefined} />;`,
      1,
    ],
    [
      "a hookless null component proven through a nested TypeScript-wrapped createElement argument",
      `import { createElement } from "react";
       interface NullComponentProps {
         onRender: () => void;
       }
       interface NullComponentType {
         (props: NullComponentProps): null;
       }
       function NullComponent({ onRender }: NullComponentProps) {
         onRender();
         return null;
       }
       const node = createElement(
         (NullComponent as NullComponentType) satisfies NullComponentType,
         { onRender: () => undefined },
       );`,
      1,
    ],
    [
      "a hookless null function declaration hoisted outside its block",
      `function Parent() {
         if (true) {
           function NullComponent({ onRender }) {
             onRender();
             return null;
           }
           const node = <NullComponent onRender={() => undefined} />;
         }
         return null;
       }`,
      1,
    ],
    [
      "a hookless null var component hoisted outside its block",
      `function Parent() {
         if (true) {
           var NullComponent = ({ onRender }) => {
             onRender();
             return null;
           };
           const node = <NullComponent onRender={() => undefined} />;
         }
         return null;
       }`,
      1,
    ],
    [
      "a hookless null function passed to a shadowed createElement lookalike",
      `interface NullComponentProps {
         onRender: () => void;
       }
       const createElement = (...values: unknown[]): unknown => values;
       function NullComponent({ onRender }: NullComponentProps) {
         onRender();
         return null;
       }
       createElement(NullComponent, { onRender: () => undefined });`,
      0,
    ],
    [
      "a reassigned PascalCase function whose replacement is rendered",
      `interface PluginProps {
         addModule: (name: string) => void;
       }
       function EventsHarnessPlugin({ addModule }: PluginProps) {
         addModule("test-events");
         return null;
       }
       EventsHarnessPlugin = () => null;
       const node = <EventsHarnessPlugin addModule={() => undefined} />;`,
      0,
    ],
    [
      "a genuine JSX component that calls a prop callback during render",
      `interface RenderPositiveProps {
         onRender: () => void;
       }
       const RenderPositive = ({ onRender }: RenderPositiveProps) => {
         onRender();
         return <div />;
       };`,
      1,
    ],
    [
      "a genuine fragment component",
      `interface RenderPositiveProps {
         onRender: () => void;
       }
       function RenderPositive({ onRender }: RenderPositiveProps) {
         onRender();
         return <>Ready</>;
       }`,
      1,
    ],
    [
      "a genuine createElement component",
      `import { createElement } from "react";
       interface RenderPositiveProps {
         onRender: () => void;
       }
       function RenderPositive({ onRender }: RenderPositiveProps) {
         onRender();
         return createElement("div");
       }`,
      1,
    ],
    [
      "a genuine component returning props children",
      `interface RenderPositiveProps {
         onRender: () => void;
         children: unknown;
       }
       function RenderPositive(props: RenderPositiveProps) {
         props.onRender();
         return props.children;
       }`,
      1,
    ],
    [
      "a null component with a proven React Hook",
      `import { useState } from "react";
       interface RenderPositiveProps {
         onRender: () => void;
       }
       function RenderPositive({ onRender }: RenderPositiveProps) {
         useState(0);
         onRender();
         return null;
       }`,
      1,
    ],
    [
      "a null component with an aliased proven React Hook",
      `import { useState as useLocalState } from "react";
       interface RenderPositiveProps {
         onRender: () => void;
       }
       function RenderPositive({ onRender }: RenderPositiveProps) {
         useLocalState(0);
         onRender();
         return null;
       }`,
      1,
    ],
    [
      "a custom Hook invoking its callback parameter",
      `interface InstallOptions {
         addModule: (name: string) => void;
       }
       const useInstallPlugin = ({ addModule }: InstallOptions): void => {
         addModule("test-events");
       };`,
      1,
    ],
    [
      "a TypeScript-wrapped prop callback in a genuine component",
      `interface RenderPositiveProps {
         onRender: () => void;
       }
       function RenderPositive({ onRender }: RenderPositiveProps) {
         (onRender satisfies () => void)();
         return (<div />);
       }`,
      1,
    ],
    [
      "a genuine component that defers a prop callback to an event",
      `interface EventNegativeProps {
         onRender: () => void;
       }
       const EventNegative = ({ onRender }: EventNegativeProps) => (
         <button type="button" onClick={onRender}>Run</button>
       );`,
      0,
    ],
    [
      "a genuine component that defers a prop callback to an effect",
      `import { useEffect } from "react";
       interface EffectNegativeProps {
         onRender: () => void;
       }
       const EffectNegative = ({ onRender }: EffectNegativeProps) => {
         useEffect(() => onRender(), [onRender]);
         return <div />;
       };`,
      0,
    ],
  ])("classifies component ownership for %s", (_caseName, sourceCode, expectedDiagnosticCount) => {
    const result = run(sourceCode);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnosticCount);
  });
});

describe("no-prop-callback-in-render constructor callbacks", () => {
  it.each([
    {
      label: "default-runtime-react",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady}=props; onReady(); } render() { return <output/>; } }',
      expected: 1,
    },
    {
      label: "pure-component",
      code: 'import React from "react";\n\nexport class Panel extends React.PureComponent { constructor(props) { super(props); const {onReady}=props; if(true) onReady(); } render() { return <output/>; } }',
      expected: 1,
    },
    {
      label: "namespace-runtime-react",
      code: 'import * as React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady}=props; onReady(); } render() { return <output/>; } }',
      expected: 1,
    },
    {
      label: "named-renamed-component",
      code: 'import {Component as Base} from "react";\n\nexport class Panel extends Base { constructor(props) { super(props); const {onReady}=props; onReady(); } render() { return <output/>; } }',
      expected: 1,
    },
    {
      label: "renamed-property",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady: notify}=props; if(true) notify(); } render() { return <output/>; } }',
      expected: 1,
    },
    {
      label: "explicit-discard",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady}=props; void onReady(); } render() { return <output/>; } }',
      expected: 1,
    },
    {
      label: "consumed-output",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const {createValue}=props; this.state={output:createValue()}; } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "stored-local-result",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const {createValue}=props; const value=createValue(); this.state={value}; } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "nested-deferred-closure",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady}=props; this.onClick=()=>{onReady();}; } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "nested-iife-outside-v1",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady}=props; (()=>{onReady();})(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "mount-notification",
      code: 'import React from "react"; export class Panel extends React.Component {componentDidMount(){this.props.onReady();} render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "ordinary-class",
      code: "export class Panel {constructor(props){const {onReady}=props;onReady();}}",
      expected: 0,
    },
    {
      label: "local-callback-homonym",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const onReady=()=>{}; onReady(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "imported-callback",
      code: 'import React from "react";\nimport {onReady} from "./callbacks";\nexport class Panel extends React.Component { constructor(props) { super(props); onReady(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "type-only-react",
      code: 'import type React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady}=props; onReady(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "shadowed-react",
      code: 'import React from "react"; function make(React){return class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady();}}}',
      expected: 0,
    },
    {
      label: "parameter-reassignment",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); props={onReady:()=>{}};const {onReady}=props;onReady(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "callback-binding-write",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady}=props; ({onReady}=other); onReady(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "fallback-not-proven-prop",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady=()=>{}}=props; onReady(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "further-local-alias",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady}=props;const notify=onReady;notify(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "direct-this-props-outside-v1",
      code: 'import React from "react";\n\nexport class Panel extends React.Component { constructor(props) { super(props); this.props.onReady(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "provider-mutation",
      code: 'import React from "react";\nReact.Component=class {};\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady}=props;onReady(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "secondary-provider-mutation",
      code: 'import React from "react";\nimport OtherReact from "react"; OtherReact.Component=class {};\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady}=props;onReady(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "provider-extraction",
      code: 'import React from "react";\nconst provider=React; mutate(provider);\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady}=props;onReady(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "reflective-provider-replacement",
      code: 'import React from "react";\nObject.defineProperty(React,"Component",{get:()=>class {}});\nexport class Panel extends React.Component { constructor(props) { super(props); const {onReady}=props;onReady(); } render() { return <output/>; } }',
      expected: 0,
    },
    {
      label: "existing-function-render-positive",
      code: "export function Panel({onReady}){onReady();return <output/>;}",
      expected: 1,
    },
    {
      label: "manual-module-construction",
      code: 'import React from "react";\n\nexport class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}\nnew Panel({onReady(){}});',
      expected: 0,
    },
    {
      label: "manual-event-construction",
      code: 'import React from "react";\n\nexport class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}\nexport const launch=()=>new Panel({onReady(){}});',
      expected: 0,
    },
    {
      label: "manual-alias-construction",
      code: 'import React from "react";\n\nexport class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}\nconst Build=Panel;new Build({onReady(){}});',
      expected: 0,
    },
    {
      label: "unrelated-new-is-conservative",
      code: 'import React from "react";\n\nexport class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}\nconst data=new Map();',
      expected: 0,
    },
    {
      label: "missing-super-props",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super({});const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "before-binding-initialization",
      code: 'import React from "react";\n\nexport class Panel extends React.Component {constructor(props){super(props);onReady();const {onReady}=props;}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "optional-callback-outside-v1",
      code: 'import React from "react";\n\nexport class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady?.();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "props-escape-before-extraction",
      code: 'import React from "react";\n\nexport class Panel extends React.Component {constructor(props){super(props);install(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "props-property-write",
      code: 'import React from "react";\n\nexport class Panel extends React.Component {constructor(props){super(props);props.onReady=()=>{};const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "selected-computed-binding",
      code: 'import React from "react";\n\nexport class Panel extends React.Component {constructor(props){super(props);const {["onReady"]:onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "ambient-loader-runtime-use",
      code: 'import React from "react";declare function require(name:string):any; require("react").Component=class {};export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "runtime-type-only-provider-alias",
      code: 'import React from "react";\nimport type OtherReact from "react";OtherReact.Component=class {};\nexport class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "eval-provider-replacement",
      code: 'import React from "react";\neval("replaceReact()");\nexport class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "dynamic-provider-import",
      code: 'import React from "react";\nimport("react").then(replaceReact);\nexport class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "runtime-typescript-parameter",
      code: 'import React from "react";\nclass Other {constructor(public marker=replaceReact()){}}\nexport class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "pragma-nonreact-construction",
      code: '/** @jsxImportSource custom-jsx */\nimport React from "react";\n\nexport class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "props-read-outside-v1",
      code: 'import React from "react";\n\nexport class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;if(props)onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "class-prototype-provider-extraction",
      code: 'import React from "react";\nconst {prototype:provider}=React.Component; mutate(provider);\nexport class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "runtime-react-reexport",
      code: 'import React from "react";export {Component as ExternalComponent} from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "runtime-react-star-reexport",
      code: 'import React from "react";export * from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "default-as-runtime-react",
      code: 'import {default as React} from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 1,
    },
    {
      label: "nested-class-factory-outside-v1",
      code: 'import React from "react"; export const createPanel=()=>{ class Panel extends React.Component {constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}};return Panel;};',
      expected: 0,
    },
    {
      label: "arguments-props-mutation",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);arguments[0].onReady=()=>{};const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "this-props-mutation-before-extraction",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);this.props.onReady=()=>{};const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "this-escape-before-extraction",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);install(this);const {onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "sibling-default-mutation",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {ignored=(this.props.onReady=()=>{}),onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "sibling-computed-mutation",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {[replaceProps()]:ignored,onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
    {
      label: "prior-declarator-mutation",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const ignored=(this.props.onReady=()=>{}),{onReady}=props;onReady();}render(){return <output/>;}}',
      expected: 0,
    },
  ])("$label", ({ code, expected }) => {
    const result = run(code);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(expected);
  });
});

describe("no-prop-callback-in-render constructor initialization boundary", () => {
  it.each([
    {
      label: "instance-field-replaces-prop",
      code: 'import React from "react";export class Panel extends React.Component{replacement=(this.props.onReady=()=>{});constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
    },
    {
      label: "instance-field-without-initializer",
      code: 'import React from "react";export class Panel extends React.Component{replacement;constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
    },
    {
      label: "declared-typescript-field",
      code: 'import React from "react";export class Panel extends React.Component{declare replacement: unknown;constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
    },
    {
      label: "props-setter-replaces-prop",
      code: 'import React from "react";export class Panel extends React.Component{set props(value){value.onReady=()=>{};}constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
    },
    {
      label: "props-getter-boundary",
      code: 'import React from "react";export class Panel extends React.Component{get props(){return {onReady:()=>{}};}constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
    },
    {
      label: "static-field-boundary",
      code: 'import React from "react";export class Panel extends React.Component{static replacement=0;constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
    },
    {
      label: "static-block-boundary",
      code: 'import React from "react";export class Panel extends React.Component{static {}constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
    },
    {
      label: "computed-method-boundary",
      code: 'import React from "react";export class Panel extends React.Component{["other"](){}constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
    },
    {
      label: "method-decorator-boundary",
      code: 'import React from "react";export class Panel extends React.Component{@decorate other(){}constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
    },
    {
      label: "auto-accessor-boundary",
      code: 'import React from "react";export class Panel extends React.Component{accessor replacement=0;constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
    },
    {
      label: "static-method-conservative-boundary",
      code: 'import React from "react";export class Panel extends React.Component{static other(){}constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
    },
    {
      label: "class-decorator-boundary",
      code: 'import React from "react";@decorate export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>;}}',
    },
  ])("$label", ({ code }) => {
    const result = run(code);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("no-prop-callback-in-render constructor reachability", () => {
  it.each([
    {
      label: "literal-false-if",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;if(false)onReady();}render(){return <output/>;}}',
    },
    {
      label: "literal-true-else",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;if(true){}else onReady();}render(){return <output/>;}}',
    },
    {
      label: "literal-false-conditional",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;false?onReady():null;}render(){return <output/>;}}',
    },
    {
      label: "literal-true-alternate",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;true?null:onReady();}render(){return <output/>;}}',
    },
    {
      label: "false-logical-right",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;false&&onReady();}render(){return <output/>;}}',
    },
    {
      label: "true-logical-right",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;true||onReady();}render(){return <output/>;}}',
    },
    {
      label: "nullish-value-outside-v1",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;true??onReady();}render(){return <output/>;}}',
    },
    {
      label: "unary-dead-if",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;if(!true)onReady();}render(){return <output/>;}}',
    },
    {
      label: "constant-alias-dead-if",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;const enabled=false;if(enabled)onReady();}render(){return <output/>;}}',
    },
    {
      label: "preceding-return",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;return;onReady();}render(){return <output/>;}}',
    },
    {
      label: "preceding-throw",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;throw "stop";onReady();}render(){return <output/>;}}',
    },
    {
      label: "constant-if-return",
      code: 'import React from "react";export class Panel extends React.Component{constructor(props){super(props);const {onReady}=props;if(true)return;onReady();}render(){return <output/>;}}',
    },
  ])("$label", ({ code }) => {
    const result = run(code);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("program provider proof growth", () => {
  it("checks stable provider imports once as sibling components grow", () => {
    const results = [
      PROVIDER_PROOF_SMALL_COMPONENT_COUNT,
      PROVIDER_PROOF_LARGE_COMPONENT_COUNT,
    ].map((size) => {
      const source =
        'import {Component} from "react";' +
        Array.from(
          { length: size },
          (_, index) =>
            `export class Panel${index} extends Component {constructor(props){super(props);const {onReady}=props;onReady();}render(){return <output/>}}`,
        ).join("\n");
      let symbolVisits = 0;
      const measuredRule = {
        ...noPropCallbackInRender,
        create: (context: Parameters<typeof noPropCallbackInRender.create>[0]) => {
          const symbols = new Proxy(context.scopes.rootScope.symbols, {
            get: (target, property, receiver) => {
              if (typeof property === "string" && /^\d+$/.test(property)) symbolVisits += 1;
              return Reflect.get(target, property, receiver);
            },
          });
          const rootScope = new Proxy(context.scopes.rootScope, {
            get: (target, property, receiver) =>
              property === "symbols" ? symbols : Reflect.get(target, property, receiver),
          });
          const scopes = new Proxy(context.scopes, {
            get: (target, property, receiver) =>
              property === "rootScope" ? rootScope : Reflect.get(target, property, receiver),
          });
          return noPropCallbackInRender.create({ ...context, scopes });
        },
      };
      const result = runRule(measuredRule, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(size);
      return symbolVisits;
    });
    expect(results[0]).toBeGreaterThan(0);
    expect(results[1]).toBeLessThanOrEqual(results[0] * PROVIDER_PROOF_MAX_GROWTH_RATIO);
  });
});
