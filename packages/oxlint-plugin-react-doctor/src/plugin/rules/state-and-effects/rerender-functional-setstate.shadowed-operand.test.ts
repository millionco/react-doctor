import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderFunctionalSetstate } from "./rerender-functional-setstate.js";

interface OperandCase {
  name: string;
  source: string;
  count: number;
}

const cases: OperandCase[] = [
  {
    name: "captured state alias keeps the existing warning",
    source: `import { useEffect, useState } from "react"; const Counter = ({ data }) => { const [count, setCount] = useState(0); const saved = count; useEffect(() => { const count = saved; setInterval(() => setCount(count + 1), 800); }, []); return <output>{count}</output>; };`,
    count: 1,
  },
  {
    name: "static render input with a nullish fallback",
    source: `import { useEffect, useState } from "react"; const Counter = ({ data }) => { const [count, setCount] = useState(0);  useEffect(() => { const count = data.baseline ?? 0; setInterval(() => setCount(count + 1), 800); }, []); return <output>{count}</output>; };`,
    count: 0,
  },
  {
    name: "visible input member write keeps the existing warning",
    source: `import { useEffect, useState } from "react"; const Counter = ({ data }) => { const [count, setCount] = useState(0);  useEffect(() => { data.baseline = 8; const count = data.baseline ?? 0; setInterval(() => setCount(count + 1), 800); }, []); return <output>{count}</output>; };`,
    count: 1,
  },
  {
    name: "input object escape keeps the existing warning",
    source: `import { useEffect, useState } from "react"; const Counter = ({ data }) => { const [count, setCount] = useState(0); expose(data); useEffect(() => { const count = data.baseline ?? 0; setInterval(() => setCount(count + 1), 800); }, []); return <output>{count}</output>; };`,
    count: 1,
  },
  {
    name: "unknown initializer keeps the existing warning",
    source: `import { useEffect, useState } from "react"; const Counter = ({ data }) => { const [count, setCount] = useState(0);  useEffect(() => { const count = readBaseline(); setInterval(() => setCount(count + 1), 800); }, []); return <output>{count}</output>; };`,
    count: 1,
  },

  {
    name: "local scalar input shadows state",
    source: `import { useEffect, useState } from "react";
    const Counter = ({ baseline }) => { const [count, setCount] = useState(0);
      useEffect(() => { const count = baseline; setInterval(() => setCount(count + 1), 800); }, [baseline]); return <output>{count}</output>; };`,
    count: 0,
  },
  {
    name: "parameter shadows state",
    source: `import { useState } from "react";
    const Counter = () => { const [count, setCount] = useState(0);
      const schedule = (count) => setTimeout(() => setCount(count + 1), 800); return <button onClick={() => schedule(8)}>{count}</button>; };`,
    count: 1,
  },
  {
    name: "local scalar update shadows state",
    source: `import { useEffect, useState } from "react";
    const Counter = ({ baseline }) => { const [count, setCount] = useState(0);
      useEffect(() => { let count = baseline; setInterval(() => setCount(++count), 800); }, [baseline]); return <output>{count}</output>; };`,
    count: 1,
  },
  {
    name: "local collection shadows state",
    source: `import { useEffect, useState } from "react";
    const List = ({ seed }) => { const [items, setItems] = useState([]);
      useEffect(() => { const items = seed; setTimeout(() => setItems([...items, "new"]), 800); }, [seed]); return <output>{items.length}</output>; };`,
    count: 0,
  },
  {
    name: "local record shadows state",
    source: `import { useEffect, useState } from "react";
    const Profile = ({ seed }) => { const [profile, setProfile] = useState({});
      useEffect(() => { const profile = seed; setTimeout(() => setProfile({ ...profile, visible: true }), 800); }, [seed]); return <output>{profile.visible}</output>; };`,
    count: 0,
  },
  {
    name: "deferred scalar reads real state",
    source: `import { useEffect, useState } from "react";
    const Counter = () => { const [count, setCount] = useState(0);
      useEffect(() => { setInterval(() => setCount(count + 1), 800); }, []); return <output>{count}</output>; };`,
    count: 1,
  },
  {
    name: "deferred update reads real state",
    source: `import { useEffect, useState } from "react";
    const Counter = () => { let [count, setCount] = useState(0);
      useEffect(() => { setInterval(() => setCount(++count), 800); }, []); return <output>{count}</output>; };`,
    count: 1,
  },
  {
    name: "deferred collection reads real state",
    source: `import { useEffect, useState } from "react";
    const List = () => { const [items, setItems] = useState([]);
      useEffect(() => { setTimeout(() => setItems([...items, "new"]), 800); }, []); return <output>{items.length}</output>; };`,
    count: 1,
  },
  {
    name: "deferred record reads real state",
    source: `import { useEffect, useState } from "react";
    const Profile = () => { const [profile, setProfile] = useState({});
      useEffect(() => { setTimeout(() => setProfile({ ...profile, visible: true }), 800); }, []); return <output>{profile.visible}</output>; };`,
    count: 1,
  },
  {
    name: "global React useState keeps state detection",
    source: `const Counter = () => { const [count, setCount] = React.useState(0);
      setTimeout(() => setCount(count + 1), 800); return <output>{count}</output>; };`,
    count: 1,
  },
  {
    name: "imported hook alias still distinguishes bindings",
    source: `import { useState as useCounterState } from "react";
    const Counter = ({ baseline }) => { const [count, setCount] = useCounterState(0);
      { const count = baseline; setTimeout(() => setCount(count + 1), 800); } return <output>{count}</output>; };`,
    count: 0,
  },
  {
    name: "two real state updates keep batching detection",
    source: `import { useState } from "react";
    const Counter = () => { const [count, setCount] = useState(0); return <button onClick={() => { setCount(count + 1); setCount(count + 2); }}>{count}</button>; };`,
    count: 2,
  },
];

describe("rerender-functional-setstate binding identity", () => {
  it.each(cases)("$name", ({ source, count }) => {
    const result = runRule(rerenderFunctionalSetstate, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });
});
