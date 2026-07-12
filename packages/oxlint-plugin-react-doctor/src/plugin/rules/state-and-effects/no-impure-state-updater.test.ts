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
  ])("reports %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
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
  ])("stays silent for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
