import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderFunctionalSetstate } from "./rerender-functional-setstate.js";

interface AwaitContinuationCase {
  name: string;
  code: string;
  expected: number;
}

const cases: AwaitContinuationCase[] = [
  {
    name: "direct-own-await-before-spread",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { await read(); setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 1,
  },
  {
    name: "original-shaped-counted-for-await-then-append",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { const added = []; for (let index=0; index<files.length; index++) { const file=files[index]; if (!file.type.startsWith("image/")) continue; const value=await read(file); added.push(value); } setItems([...items,...added]); };
  return <input onChange={handle} />;
};
`,
    expected: 1,
  },
  {
    name: "same-branch-await-then-spread",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { if (condition) { await read(); setItems([...items, 1]); } };
  return <input onChange={handle} />;
};
`,
    expected: 1,
  },
  {
    name: "conditional-earlier-await-can-precede-common-spread",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { if (condition) await read(); setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 1,
  },
  {
    name: "conditional-branch-return-excludes-common-spread",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { if (condition) { await read(); return; } setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "nested-uninvoked-async-await-is-not-owner-suspension",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { const inner = async () => { await read(); }; setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "nested-fired-async-does-not-suspend-owner",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { const inner = async () => { await read(); }; inner(); setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "setter-before-first-await",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { setItems([...items, 1]); await read(); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "setter-evaluated-inside-await-operand",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { await setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "functional-updater-after-await",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { await read(); setItems(previous => [...previous, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "sync-native-handler",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = (event) => { setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "async-keyword-without-await",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "await-after-unconditional-return",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { return; await read(); setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "await-after-unconditional-throw",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { throw new Error("stop"); await read(); setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "static-false-await-branch",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { if (false) await read(); setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "static-false-loop-await",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { while (false) { await read(); } setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "stable-condition-loop-cannot-both-await-and-naturally-exit",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { while (condition) { await read(); } setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "infinite-for-does-not-reach-common-write",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { for (;;) { await read(); } setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "zero-bound-counted-loop-does-not-await",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { for (let index=0; index<0; index++) { await read(); } setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "mutually-exclusive-stable-predicate-paths",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { if (condition) await read(); if (!condition) setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "short-circuit-await-false",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { false && await read(); setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "unknown-short-circuit-await",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { condition && await read(); setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "setter-argument-itself-awaits",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { setItems([...items, await read()]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "finally-await-after-return",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { try { return; } finally { await read(); } setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "finally-write-after-await",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { try { await read(); } finally { setItems([...items, 1]); } };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "caught-rejection-continuation",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { try { await read(); } catch {} setItems([...items, 1]); };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "nested-setter-function-escape",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { await read(); const later = () => setItems([...items, 1]); return later; };
  return <input onChange={handle} />;
};
`,
    expected: 0,
  },
  {
    name: "named-handler-extra-native-call-site",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { await read(); setItems([...items, 1]); };
  return <button onClick={handle} onBlur={handle}>go</button>;
};
`,
    expected: 1,
  },
  {
    name: "custom-component-handler-does-not-change-own-await-fact",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { await read(); setItems([...items, 1]); };
  return <Widget onChange={handle} />;
};
`,
    expected: 1,
  },
  {
    name: "no-jsx-caller-does-not-change-own-await-fact",
    code: `import { useState } from 'react';
export const Example = ({condition, files, read, fail, limit}) => {
  const [items, setItems] = useState([]);
  const handle = async (event) => { await read(); setItems([...items, 1]); };
  return null;
};
`,
    expected: 1,
  },
  {
    name: "known-empty-array-bound-never-enters",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 const [items,setItems]=useState([]);
 
 const handle=async()=>{ const files=[]; for(let index=0;index<files.length;index++){await read()} setItems([...items,1]); };
 return <input onChange={handle}/>;
};
`,
    expected: 0,
  },
  {
    name: "known-zero-data-length-never-enters",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 const [items,setItems]=useState([]);
 
 const handle=async()=>{ const files={length:0}; for(let index=0;index<files.length;index++){await read()} setItems([...items,1]); };
 return <input onChange={handle}/>;
};
`,
    expected: 0,
  },
  {
    name: "known-zero-getter-length-never-enters",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 const [items,setItems]=useState([]);
 
 const handle=async()=>{ const files={get length(){return 0}}; for(let index=0;index<files.length;index++){await read()} setItems([...items,1]); };
 return <input onChange={handle}/>;
};
`,
    expected: 0,
  },
  {
    name: "single-iteration-branch-setter-before-await",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 const [items,setItems]=useState([]);
 
 const handle=async()=>{ for(let index=0;index<1;index++){if(condition)setItems([...items,1]);await read()} };
 return <input onChange={handle}/>;
};
`,
    expected: 0,
  },
  {
    name: "literal-true-return-before-selected-write",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 const [items,setItems]=useState([]);
 
 const handle=async()=>{ await read(); if(true)return; setItems([...items,1]); };
 return <input onChange={handle}/>;
};
`,
    expected: 0,
  },
  {
    name: "literal-true-return-before-both-await-and-write",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 const [items,setItems]=useState([]);
 
 const handle=async()=>{ if(true)return; await read(); setItems([...items,1]); };
 return <input onChange={handle}/>;
};
`,
    expected: 0,
  },
  {
    name: "visible-array-growth-prevents-loop-exit",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 const [items,setItems]=useState([]);
 
 const handle=async()=>{ const files=[0]; for(let index=0;index<files.length;index++){await read();files.push(0)} setItems([...items,1]); };
 return <input onChange={handle}/>;
};
`,
    expected: 0,
  },
  {
    name: "direct-eval-resets-certified-counter",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 const [items,setItems]=useState([]);
 
 const handle=async()=>{ for(let index=0;index<1;index++){await read();eval("index=-1")} setItems([...items,1]); };
 return <input onChange={handle}/>;
};
`,
    expected: 0,
  },
  {
    name: "counter-value-branch-always-exits-first-iteration",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 const [items,setItems]=useState([]);
 
 const handle=async()=>{ for(let index=0;index<1;index++){await read();if(index===0)return;} setItems([...items,1]); };
 return <input onChange={handle}/>;
};
`,
    expected: 0,
  },
  {
    name: "literal-upper-bound-retained-positive",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 const [items,setItems]=useState([]);
 
 const handle=async()=>{ for(let index=0;index<1;index++){await read()} setItems([...items,1]); };
 return <input onChange={handle}/>;
};
`,
    expected: 1,
  },
  {
    name: "state-symbol-shadow-does-not-expand",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 const [items,setItems]=useState([]);
 
 const handle=async()=>{ await read(); {const items=[];setItems([...items,1])} };
 return <input onChange={handle}/>;
};
`,
    expected: 0,
  },
  {
    name: "fresh-await-owned-local-snapshot-does-not-expand",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 const [items,setItems]=useState([]);
 
 const handle=async()=>{ await read(); const latest=[];setItems([...latest,1]); };
 return <input onChange={handle}/>;
};
`,
    expected: 0,
  },
  {
    name: "readwrite-state-binding-new-branch-declines",
    code: `import { useState } from 'react';
export const Example=({condition, read})=>{
 let [items,setItems]=useState([]);
 
 const handle=async()=>{ await read();items=[];setItems([...items,1]); };
 return <input onChange={handle}/>;
};
`,
    expected: 0,
  },
  {
    name: "compound-guard-cannot-reach-post-await-write",
    code: `import {useState} from 'react'; export const Example=({read})=>{let [items,setItems]=useState([]);const [count,setCount]=useState(0);const [user,setUser]=useState({});const handle=async(flag,other)=>{if(flag && other) await read(); if(flag) return; setItems([...items,1]);};return null;}`,
    expected: 0,
  },
  {
    name: "scalar-post-await-update",
    code: `import {useState} from 'react'; export const Example=({read})=>{let [items,setItems]=useState([]);const [count,setCount]=useState(0);const [user,setUser]=useState({});const handle=async()=>{await read();setCount(count+1)};return null;}`,
    expected: 1,
  },
  {
    name: "object-post-await-update",
    code: `import {useState} from 'react'; export const Example=({read})=>{let [items,setItems]=useState([]);const [count,setCount]=useState(0);const [user,setUser]=useState({});const handle=async()=>{await read();setUser({...user,active:true})};return null;}`,
    expected: 1,
  },
  {
    name: "shadowed-captured-state",
    code: `import {useState} from 'react'; export const Example=({read})=>{let [items,setItems]=useState([]);const [count,setCount]=useState(0);const [user,setUser]=useState({});const handle=async(items)=>{await read();setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "destructured-setter-replacement",
    code: `import {useState} from 'react'; export const Example=({read})=>{let [items,setItems]=useState([]);const [count,setCount]=useState(0);const [user,setUser]=useState({});({setItems}={setItems:()=>{}});const handle=async()=>{await read();setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "destructured-state-replacement",
    code: `import {useState} from 'react'; export const Example=({read})=>{let [items,setItems]=useState([]);const [count,setCount]=useState(0);const [user,setUser]=useState({});({items}={items:[]});const handle=async()=>{await read();setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "derived-inverse-guard",
    code: `import {useState} from 'react'; export const Example=({read,flag,other})=>{const[items,setItems]=useState([]);const inverse=!flag;const handle=async()=>{if(flag)await read();if(inverse)setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "derived-composite-guard",
    code: `import {useState} from 'react'; export const Example=({read,flag,other})=>{const[items,setItems]=useState([]);const both=flag&&other;const handle=async()=>{if(both)await read();if(flag)return;setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "constant-false-await-guard",
    code: `import {useState} from 'react'; export const Example=({read,flag,other})=>{const[items,setItems]=useState([]);const enabled=false;const handle=async()=>{if(enabled)await read();setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "constant-true-exiting-guard",
    code: `import {useState} from 'react'; export const Example=({read,flag,other})=>{const[items,setItems]=useState([]);const enabled=true;const handle=async()=>{if(enabled)return;await read();setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "aliased-empty-loop-bound",
    code: `import {useState} from 'react'; export const Example=({read,flag,other})=>{const[items,setItems]=useState([]);const empty=[];const files=empty;const handle=async()=>{for(let index=0;index<files.length;index++){await read()}setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "spread-empty-loop-bound",
    code: `import {useState} from 'react'; export const Example=({read,flag,other})=>{const[items,setItems]=useState([]);const files=[...[]];const handle=async()=>{for(let index=0;index<files.length;index++){await read()}setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "typed-empty-loop-bound",
    code: `import {useState} from 'react'; export const Example=({read,flag,other})=>{const[items,setItems]=useState([]);const files=[] as unknown[];const handle=async()=>{for(let index=0;index<files.length;index++){await read()}setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "unconditional-loop-continue-before-await",
    code: `import {useState} from 'react'; export const Example=({read,flag,other})=>{const[items,setItems]=useState([]);const handle=async()=>{for(let index=0;index<1;index++){if(true)continue;await read()}setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "wrapped-eval-cannot-reset-loop-counter",
    code: `import {useState} from 'react'; export const Example=({read,flag,other})=>{const[items,setItems]=useState([]);const handle=async()=>{for(let index=0;index<1;index++){await read();eval!("index=-1")}setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "react-namespace-post-await",
    code: `import React from 'react';export const Example=({read})=>{const[items,setItems]=React.useState([]);const handle=async()=>{await read();setItems([...items,1])};return null;}`,
    expected: 1,
  },
  {
    name: "mutated-react-namespace-post-await",
    code: `import React from 'react';React.useState=()=>[[],consume];export const Example=({read})=>{const[items,setItems]=React.useState([]);const handle=async()=>{await read();setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "loop-continue-guard-excludes-later-return-path",
    code: `import {useState} from 'react'; export const Example=({read,flag})=>{const[items,setItems]=useState([]);const handle=async()=>{for(let index=0;index<1;index++){if(!flag)continue;await read();}if(flag)return;setItems([...items,1]);};return null;}`,
    expected: 0,
  },
  {
    name: "loop-continue-guard-excludes-logical-write",
    code: `import {useState} from 'react'; export const Example=({read,flag})=>{const[items,setItems]=useState([]);const handle=async()=>{for(let index=0;index<1;index++){if(!flag)continue;await read();}!flag && setItems([...items,1]);};return null;}`,
    expected: 0,
  },
  {
    name: "loop-continue-guard-excludes-ternary-write",
    code: `import {useState} from 'react'; export const Example=({read,flag})=>{const[items,setItems]=useState([]);const handle=async()=>{for(let index=0;index<1;index++){if(!flag)continue;await read();}flag ? null : setItems([...items,1]);};return null;}`,
    expected: 0,
  },
  {
    name: "numeric-false-await-branch",
    code: `import {useState} from "react";export const Example=({read})=>{const[items,setItems]=useState([]);const handle=async()=>{if(0)await read();setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "empty-string-await-branch",
    code: `import {useState} from "react";export const Example=({read})=>{const[items,setItems]=useState([]);const handle=async()=>{if("")await read();setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "null-await-branch",
    code: `import {useState} from "react";export const Example=({read})=>{const[items,setItems]=useState([]);const handle=async()=>{if(null)await read();setItems([...items,1])};return null;}`,
    expected: 0,
  },
  {
    name: "outer-guard-forces-every-loop-continue",
    code: `import {useState} from "react";export const Example=({read,flag})=>{const[items,setItems]=useState([]);const handle=async()=>{if(flag){for(let index=0;index<1;index++){if(flag)continue;await read();}setItems([...items,1]);}};return null;}`,
    expected: 0,
  },
  {
    name: "opposite-loop-guards-always-continue",
    code: `import {useState} from "react";export const Example=({read,flag})=>{const[items,setItems]=useState([]);const handle=async()=>{for(let index=0;index<1;index++){if(flag)continue;if(!flag)continue;await read();}setItems([...items,1]);};return null;}`,
    expected: 0,
  },
  {
    name: "compound-loop-guard-always-continues",
    code: `import {useState} from "react";export const Example=({read,flag})=>{const[items,setItems]=useState([]);const handle=async()=>{for(let index=0;index<1;index++){if(flag||true)continue;await read();}setItems([...items,1]);};return null;}`,
    expected: 0,
  },
];

describe("rerender-functional-setstate awaited continuations", () => {
  it.each(cases)("$name", ({ code, expected }) => {
    const result = runRule(rerenderFunctionalSetstate, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
