import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const cases = [
  {
    name: "stateful fixed slot positive",
    code: "import{useMemo,useState}from'react';const widths=[47,68,75,82];function Row({value}){const[initial]=useState(value);return <input defaultValue={initial}/>};export function View({items,count}){const rows=useMemo(()=>Array.from({length:count},(_,i)=>`${widths[i%widths.length]}%`),[count]); return <div>{rows.map((width,index)=><Row key={index} value={width}/>)}</div>}\n",
    expected: 0,
  },
  {
    name: "literal jsx positive",
    code: "import{useMemo,useState}from'react';const widths=[47,68,75,82];function Row({value}){const[initial]=useState(value);return <input defaultValue={initial}/>};export function View({items,count}){const rows=useMemo(()=>Array.from({length:count},(_,i)=>`${widths[i%widths.length]}%`),[count]); return <div>{rows.map((width,index)=><div key={index}><span>{width}</span><input defaultValue=\"fixed\"/></div>)}</div>}\n",
    expected: 0,
  },
  {
    name: "destructured list default retain",
    code: "import{useMemo,useState}from'react';const widths=[47,68,75,82];function Row({value}){const[initial]=useState(value);return <input defaultValue={initial}/>};export function View({items,count}){const {rows=useMemo(()=>Array.from({length:count},(_,i)=>`${widths[i%widths.length]}%`),[count])}={rows:items}; return <div>{rows.map((width,index)=><Row key={index} value={width}/>)}</div>}\n",
    expected: 1,
  },
  {
    name: "destructured pattern default retain",
    code: "import{useMemo,useState}from'react';function Row({value}){const[initial]=useState(value);return <input defaultValue={initial}/>};export function View({items,count}){const {widths=[47,68,75,82]}={widths:items};const rows=useMemo(()=>Array.from({length:count},(_,i)=>`${widths[i%widths.length]}%`),[count]); return <div>{rows.map((width,index)=><Row key={index} value={width}/>)}</div>}\n",
    expected: 1,
  },
  {
    name: "mixed indexed data retain",
    code: "import{useMemo,useState}from'react';const widths=[47,68,75,82];function Row({value}){const[initial]=useState(value);return <input defaultValue={initial}/>};export function View({items,count}){const rows=useMemo(()=>Array.from({length:count},(_,i)=>`${widths[i%widths.length]}%`),[count]); return <div>{rows.map((width,index)=><Row key={index} value={items[index]}/>)}</div>}\n",
    expected: 1,
  },
  {
    name: "volatile captured width retain",
    code: "import{useMemo,useState}from'react';const widths=[47,68,75,82];function Row({value}){const[initial]=useState(value);return <input defaultValue={initial}/>};export function View({items,count}){const rows=useMemo(()=>Array.from({length:count},(_,i)=>`${widths[i%widths.length]}%`),[count]); return <div>{rows.map((width,index)=><Row key={index} value={items[width]}/>)}</div>}\n",
    expected: 1,
  },
  {
    name: "fake array provider retain",
    code: "import{useMemo,useState}from'react';function Row({value}){const[initial]=useState(value);return <input defaultValue={initial}/>};export function View({items}){const Array={from:()=>items};const rows=useMemo(()=>Array.from({length:items.length},(_,i)=>i),[items]);return <div>{rows.map((value,index)=><Row key={index} value={value}/>)}</div>}\n",
    expected: 1,
  },
  {
    name: "data mapper retain",
    code: "import{useMemo,useState}from'react';function Row({value}){const[initial]=useState(value);return <input defaultValue={initial}/>};export function View({items}){const rows=useMemo(()=>Array.from({length:items.length},(_,i)=>items[i]),[items]);return <div>{rows.map((value,index)=><Row key={index} value={value}/>)}</div>}\n",
    expected: 1,
  },
  {
    name: "reordered source retain",
    code: "import{useMemo,useState}from'react';function Row({value}){const[initial]=useState(value);return <input defaultValue={initial}/>};export function View({items}){const rows=useMemo(()=>Array.from(items).reverse(),[items]);return <div>{rows.map((value,index)=><Row key={index} value={value}/>)}</div>}\n",
    expected: 1,
  },
  {
    name: "mutable pattern retain",
    code: "import{useMemo,useState}from'react';function Row({value}){const[initial]=useState(value);return <input defaultValue={initial}/>};export function View({items}){const pattern=items;const rows=useMemo(()=>Array.from({length:items.length},(_,i)=>pattern[i%pattern.length]),[items]);return <div>{rows.map((value,index)=><Row key={index} value={value}/>)}</div>}\n",
    expected: 1,
  },
  {
    name: "fake memo retain",
    code: "import{useState}from'react';function Row({value}){const[initial]=useState(value);return <input defaultValue={initial}/>};export function View({items}){const useMemo=()=>items;const rows=useMemo(()=>Array.from({length:items.length},(_,i)=>i),[items]);return <div>{rows.map((value,index)=><Row key={index} value={value}/>)}</div>}\n",
    expected: 1,
  },
] as const;

describe("memoized count-only placeholder slots", () => {
  for (const { name, code, expected } of cases) {
    it(name, () => {
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    });
  }
});
