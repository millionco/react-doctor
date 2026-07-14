import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noImpureStateUpdater } from "./no-impure-state-updater.js";

const run = (code: string) => runRule(noImpureStateUpdater, code);

describe("no-impure-state-updater", () => {
  it.each([
    [
      "browser storage mutation",
      `import { useState } from "react";
       const Counter = () => {
         const [count, setCount] = useState(0);
         const increment = () => setCount((previousCount) => {
           localStorage.setItem("count", String(previousCount + 1));
           return previousCount + 1;
         });
         return <button onClick={increment}>{count}</button>;
       };`,
    ],
    [
      "a notification",
      `import { useState } from "react";
       import { toast } from "sonner";
       const Counter = () => {
         const [count, setCount] = useState(0);
         const increment = () => setCount((previousCount) => {
           toast.error("Try again");
           return previousCount + 1;
         });
         return <button onClick={increment}>{count}</button>;
       };`,
    ],
    [
      "a notification package subpath",
      `import { useState } from "react";
       import message from "antd/es/message";
       const Counter = () => {
         const [count, setCount] = useState(0);
         const increment = () => setCount((previousCount) => {
           message.error("Try again");
           return previousCount + 1;
         });
         return <button onClick={increment}>{count}</button>;
       };`,
    ],
    [
      "a DOM measurement",
      `import { useRef, useState } from "react";
       const Gallery = () => {
         const containerRef = useRef(null);
         const [width, setWidth] = useState(0);
         const measure = () => setWidth(() => containerRef.current.getBoundingClientRect().width);
         return <div ref={containerRef} onClick={measure}>{width}</div>;
       };`,
    ],
    [
      "a DOM measurement through a local alias",
      `import { useRef, useState } from "react";
       const Gallery = () => {
         const containerRef = useRef(null);
         const [width, setWidth] = useState(0);
         const measure = () => setWidth(() => {
           const container = containerRef.current;
           return container.getBoundingClientRect().width;
         });
         return <div ref={containerRef} onClick={measure}>{width}</div>;
       };`,
    ],
    [
      "a nested state update",
      `import { useState } from "react";
       const Form = () => {
         const [value, setValue] = useState(0);
         const [error, setError] = useState(null);
         const update = () => setValue((previousValue) => {
           setError(null);
           return previousValue + 1;
         });
         return <button onClick={update}>{value}{error}</button>;
       };`,
    ],
    [
      "a captured ref mutation",
      `import { useRef, useState } from "react";
       const Counter = () => {
         const countRef = useRef(0);
         const [count, setCount] = useState(0);
         const increment = () => setCount((previousCount) => {
           countRef.current = previousCount + 1;
           return previousCount + 1;
         });
         return <button onClick={increment}>{count}</button>;
       };`,
    ],
    [
      "a timer inside a synchronous callback",
      `import { useState } from "react";
       const Counter = () => {
         const [count, setCount] = useState(0);
         const increment = () => setCount((previousCount) => {
           [previousCount].forEach(() => setTimeout(save, 0));
           return previousCount + 1;
         });
         return <button onClick={increment}>{count}</button>;
       };`,
    ],
    [
      "a named updater function",
      `import { useState } from "react";
       const Counter = () => {
         const [count, setCount] = useState(0);
         const updateCount = (previousCount) => {
           localStorage.setItem("count", String(previousCount));
           return previousCount + 1;
         };
         setCount(updateCount);
         return count;
       };`,
    ],
    [
      "a deep captured assignment",
      `import { useState } from "react";
       const cache = { nested: { value: 0 } };
       const Counter = () => {
         const [count, setCount] = useState(0);
         setCount((previousCount) => {
           cache.nested.value = previousCount;
           return previousCount;
         });
         return count;
       };`,
    ],
    [
      "a window timer",
      `import { useState } from "react";
       const Counter = () => {
         const [count, setCount] = useState(0);
         setCount((previousCount) => {
           window.setTimeout(save, 0);
           return previousCount;
         });
         return count;
       };`,
    ],
    [
      "globalThis storage mutation",
      `import { useState } from "react";
       const Counter = () => {
         const [count, setCount] = useState(0);
         setCount((previousCount) => {
           globalThis.localStorage.setItem("count", String(previousCount));
           return previousCount;
         });
         return count;
       };`,
    ],
    [
      "an aliased notification import",
      `import { useState } from "react";
       import { toast as notify } from "sonner";
       const Counter = () => {
         const [count, setCount] = useState(0);
         setCount((previousCount) => {
           notify.error("Try again");
           return previousCount;
         });
         return count;
       };`,
    ],
    [
      "an aliased notification hook",
      `import { useState } from "react";
       import { useToast as useNotifier } from "@chakra-ui/react";
       const Counter = () => {
         const notifier = useNotifier();
         const [count, setCount] = useState(0);
         setCount((previousCount) => {
           notifier.error("Try again");
           return previousCount;
         });
         return count;
       };`,
    ],
    [
      "a document DOM measurement",
      `import { useState } from "react";
       const Counter = () => {
         const [width, setWidth] = useState(0);
         setWidth(() => document.body.getBoundingClientRect().width);
         return width;
       };`,
    ],
  ])("reports %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a setter parameter invoked from an effect helper",
      `import { useEffect, useState } from "react";
       const invokeSetter = (setter, nextValue) => setter(nextValue);
       const Component = () => {
         const [value, setValue] = useState(0);
         useEffect(() => invokeSetter(setValue, value), [value]);
         return value;
       };`,
    ],
    [
      "a pure arithmetic updater",
      `import { useState } from "react";
       const Counter = () => {
         const [count, setCount] = useState(0);
         return <button onClick={() => setCount((previousCount) => previousCount + 1)}>{count}</button>;
       };`,
    ],
    [
      "local mutation used to build the next value",
      `import { useState } from "react";
       const List = () => {
         const [items, setItems] = useState([]);
         const add = () => setItems((previousItems) => {
           const nextItems = [...previousItems];
           nextItems.push("new");
           return nextItems;
         });
         return <button onClick={add}>{items.length}</button>;
       };`,
    ],
    [
      "a locally created Map accumulator",
      `import { useState } from "react";
       const Index = () => {
         const [index, setIndex] = useState(new Map());
         const rebuild = () => setIndex((previousIndex) => {
           const nextIndex = new Map(previousIndex);
           nextIndex.set("updated", true);
           return nextIndex;
         });
         return <button onClick={rebuild}>{index.size}</button>;
       };`,
    ],
    [
      "a side effect in a nested event callback",
      `import { useState } from "react";
       const Counter = () => {
         const [state, setState] = useState({ onSave: null });
         const prepare = () => setState((previousState) => ({
           ...previousState,
           onSave: () => localStorage.setItem("saved", "true"),
         }));
         return <button onClick={prepare}>{Boolean(state.onSave)}</button>;
       };`,
    ],
    [
      "a userland setter-shaped function",
      `const useState = () => [0, (updater) => updater(0)];
       const Counter = () => {
         const [count, setCount] = useState();
         setCount((previousCount) => {
           localStorage.setItem("count", String(previousCount));
           return previousCount;
         });
         return count;
       };`,
    ],
    [
      "a value update outside the updater",
      `import { useState } from "react";
       const Counter = () => {
         const [count, setCount] = useState(0);
         const increment = () => {
           localStorage.setItem("count", String(count + 1));
           setCount((previousCount) => previousCount + 1);
         };
         return <button onClick={increment}>{count}</button>;
       };`,
    ],
    [
      "a pure userland geometry method",
      `import { useState } from "react";
       const geometry = { getBoundingClientRect: () => ({ width: 10 }) };
       const Panel = () => {
         const [width, setWidth] = useState(0);
         setWidth(() => geometry.getBoundingClientRect().width);
         return width;
       };`,
    ],
    [
      "an unrelated imported message object",
      `import { message } from "./domain-message";
       import { useState } from "react";
       const Panel = () => {
         const [value, setValue] = useState(0);
         setValue(() => message.info());
         return value;
       };`,
    ],
    [
      "a local hook with a notification-shaped name",
      `import { useState } from "react";
       const useToast = () => ({ success: () => 1 });
       const Panel = () => {
         const toast = useToast();
         const [value, setValue] = useState(0);
         setValue(() => toast.success());
         return value;
       };`,
    ],
    [
      "a deferred callback passed to a userland map method",
      `import { useState } from "react";
       const scheduler = { map: (callback) => () => callback() };
       const Counter = () => {
         const [count, setCount] = useState(0);
         setCount((previousCount) => {
           const deferred = scheduler.map(() => localStorage.setItem("count", "1"));
           return previousCount + Number(Boolean(deferred));
         });
         return count;
       };`,
    ],
    [
      "a shadowed window timer",
      `import { useState } from "react";
       const window = { setTimeout: () => 1 };
       const Counter = () => {
         const [count, setCount] = useState(0);
         setCount((previousCount) => previousCount + window.setTimeout());
         return count;
       };`,
    ],
    [
      "a data parameter forwarded to a setter",
      `import { useState } from "react";
       const Repro = () => {
         const [selected, setSelected] = useState(null);
         const [open, setOpen] = useState(false);
         const openEditModal = (row) => {
           setSelected(row);
           setOpen(true);
         };
         return <button onClick={() => openEditModal({ id: "x" })}>{String(open)}</button>;
       };`,
    ],
    [
      "a data parameter forwarded from a promise callback",
      `import { useState } from "react";
       const Panel = () => {
         const [colorMode, setColorMode] = useState(null);
         const sync = () => resolveColorMode().then((nativeColorMode) => setColorMode(nativeColorMode));
         return <button onClick={sync}>{colorMode}</button>;
       };`,
    ],
    [
      "a destructured parameter forwarded to a setter",
      `import { useState } from "react";
       const Panel = () => {
         const [colorMode, setColorMode] = useState(null);
         const onChange = ({ colorMode: nextColorMode }) => setColorMode(nextColorMode);
         return <select onChange={onChange}>{colorMode}</select>;
       };`,
    ],
    [
      "a data parameter forwarded inside a memoized callback",
      `import { useCallback, useState } from "react";
       const Panel = () => {
         const [diff, setDiff] = useState(null);
         const [path, setPath] = useState(null);
         const apply = useCallback((nextDiff) => {
           setDiff(nextDiff);
           setPath(nextDiff.path);
         }, []);
         return <button onClick={() => apply({ path: "x" })}>{path}</button>;
       };`,
    ],
    [
      "a promise continuation with destructured parameters",
      `import { useState } from "react";
       const Component = () => {
         const [a, setA] = useState(0);
         const [b, setB] = useState(0);
         const sync = () => {
           Promise.all([fetchA(), fetchB()])
             .then(([a, b]) => {
               setA(a);
               setB(b);
             });
         };
         return <button onClick={sync}>{a + b}</button>;
       };
       declare function fetchA(): Promise<number>;
       declare function fetchB(): Promise<number>;`,
    ],
    [
      "a callback with adjacent side effect outside updater",
      `import { useState } from "react";
       const Component = () => {
         const [items, setItems] = useState([]);
         const persist = (next) => {
           setItems(next);
           localStorage.setItem("items", JSON.stringify(next));
         };
         return <button onClick={() => persist(["new"])}>{items.length}</button>;
       };`,
    ],
  ])("stays silent for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
