import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RuleDiagnostic } from "../../../test-utils/run-rule.js";
import { noChainStateUpdates } from "./no-chain-state-updates.js";

interface DirectHelperCase {
  name: string;
  code: string;
  expectedLocations: ReadonlyArray<Required<Pick<RuleDiagnostic, "line" | "column">>>;
}

const cases: readonly DirectHelperCase[] = [
  {
    name: "direct-self-sync-comparator",
    code: 'import {useEffect,useRef,useState} from "react";\nfunction Example({items}) { const [cursor,setCursor]=useState(-1); const [shown,setShown]=useState(true); const input=useRef(null);  useEffect(()=>{if(cursor>=items.length) setCursor(-1);},[cursor]); return <><input ref={input}/><span>{cursor}:{String(shown)}</span></>; }',
    expectedLocations: [],
  },
  {
    name: "wrapped-self-sync",
    code: 'import {useEffect,useRef,useState} from "react";\nfunction Example({items}) { const [cursor,setCursor]=useState(-1); const [shown,setShown]=useState(true); const input=useRef(null); const reset=()=>setCursor(-1); useEffect(()=>{if(cursor>=items.length) reset();},[cursor]); return <><input ref={input}/><span>{cursor}:{String(shown)}</span></>; }',
    expectedLocations: [],
  },
  {
    name: "wrapped-self-sync-with-focus",
    code: 'import {useEffect,useRef,useState} from "react";\nfunction Example({items}) { const [cursor,setCursor]=useState(-1); const [shown,setShown]=useState(true); const input=useRef(null); const reset=()=>{const node=input.current;if(node){node.focus();setCursor(-1);}}; useEffect(()=>{if(cursor>=items.length) reset();},[cursor]); return <><input ref={input}/><span>{cursor}:{String(shown)}</span></>; }',
    expectedLocations: [],
  },
  {
    name: "retain-direct-other-state",
    code: 'import {useEffect,useRef,useState} from "react";\nfunction Example({items}) { const [cursor,setCursor]=useState(-1); const [shown,setShown]=useState(true); const input=useRef(null); const reset=()=>setCursor(-1); useEffect(()=>{if(cursor>=items.length){setShown(false);reset();}},[cursor]); return <><input ref={input}/><span>{cursor}:{String(shown)}</span></>; }',
    expectedLocations: [
      {
        line: 2,
        column: 203,
      },
    ],
  },
  {
    name: "mixed-helper-writes",
    code: 'import {useEffect,useRef,useState} from "react";\nfunction Example({items}) { const [cursor,setCursor]=useState(-1); const [shown,setShown]=useState(true); const input=useRef(null); const reset=()=>{setCursor(-1);setShown(false);}; useEffect(()=>{if(cursor>=items.length) reset();},[cursor]); return <><input ref={input}/><span>{cursor}:{String(shown)}</span></>; }',
    expectedLocations: [
      {
        line: 2,
        column: 222,
      },
    ],
  },
  {
    name: "mixed-helper-reverse-order",
    code: 'import {useEffect,useRef,useState} from "react";\nfunction Example({items}) { const [cursor,setCursor]=useState(-1); const [shown,setShown]=useState(true); const input=useRef(null); const reset=()=>{setShown(false);setCursor(-1);}; useEffect(()=>{if(cursor>=items.length) reset();},[cursor]); return <><input ref={input}/><span>{cursor}:{String(shown)}</span></>; }',
    expectedLocations: [
      {
        line: 2,
        column: 222,
      },
    ],
  },
  {
    name: "effectful-self-rhs",
    code: 'import {useEffect,useRef,useState} from "react";\nfunction Example({items}) { const [cursor,setCursor]=useState(-1); const [shown,setShown]=useState(true); const input=useRef(null); const reset=()=>setCursor(createCursor()); useEffect(()=>{if(cursor>=items.length) reset();},[cursor]); return <><input ref={input}/><span>{cursor}:{String(shown)}</span></>; }',
    expectedLocations: [
      {
        line: 2,
        column: 215,
      },
    ],
  },
  {
    name: "functional-self-rhs",
    code: 'import {useEffect,useRef,useState} from "react";\nfunction Example({items}) { const [cursor,setCursor]=useState(-1); const [shown,setShown]=useState(true); const input=useRef(null); const reset=()=>setCursor(previous=>previous+1); useEffect(()=>{if(cursor>=items.length) reset();},[cursor]); return <><input ref={input}/><span>{cursor}:{String(shown)}</span></>; }',
    expectedLocations: [
      {
        line: 2,
        column: 221,
      },
    ],
  },
  {
    name: "async-wrapper",
    code: 'import {useEffect,useRef,useState} from "react";\nfunction Example({items}) { const [cursor,setCursor]=useState(-1); const [shown,setShown]=useState(true); const input=useRef(null); const reset=async()=>{await Promise.resolve();setCursor(-1);}; useEffect(()=>{if(cursor>=items.length) void reset();},[cursor]); return <><input ref={input}/><span>{cursor}:{String(shown)}</span></>; }',
    expectedLocations: [],
  },
  {
    name: "independent-state-not-dependency",
    code: 'import {useEffect,useRef,useState} from "react";\nfunction Example({items}) { const [cursor,setCursor]=useState(-1); const [shown,setShown]=useState(true); const input=useRef(null); const reset=()=>setShown(false); useEffect(()=>{if(cursor>=items.length) reset();},[cursor]); return <><input ref={input}/><span>{cursor}:{String(shown)}</span></>; }',
    expectedLocations: [
      {
        line: 2,
        column: 205,
      },
    ],
  },
  {
    name: "helper-local-effectful-alias",
    code: "import {useEffect,useState} from 'react';\nexport function Widget(){ const [slot,setSlot]=useState(0); const createSlot=()=>Math.random();\n const restore=()=>{const next=createSlot();setSlot(next);}; useEffect(()=>{if(slot>0)restore();},[slot]); return null; }\n",
    expectedLocations: [
      {
        line: 3,
        column: 86,
      },
    ],
  },
  {
    name: "effectful-helper-parameter-substitution",
    code: "import {useEffect,useState} from 'react';\nexport function Widget(){ const [slot,setSlot]=useState(0); const createSlot=()=>Math.random();\n const restore=(next)=>{setSlot(next);}; useEffect(()=>{if(slot>0)restore(createSlot());},[slot]); return null; }\n",
    expectedLocations: [
      {
        line: 3,
        column: 66,
      },
    ],
  },
  {
    name: "extra-effectful-unused-invocation-argument",
    code: "import {useEffect,useState} from 'react';\nexport function Widget(){ const [slot,setSlot]=useState(0); const createSlot=()=>Math.random();\n const restore=()=>{setSlot(-1);}; useEffect(()=>{if(slot>0)restore(createSlot());},[slot]); return null; }\n",
    expectedLocations: [
      {
        line: 3,
        column: 60,
      },
    ],
  },
  {
    name: "nested-helper-captured-effectful-alias",
    code: "import {useEffect,useState} from 'react';\nexport function Panel(){const [slot,setSlot]=useState(0);const createSlot=()=>Math.random();const restore=()=>{const next=createSlot();const inner=()=>setSlot(next);inner();};useEffect(()=>{if(slot>0)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 200,
      },
    ],
  },
  {
    name: "setter-member-call-refusal",
    code: "import {useEffect,useState} from 'react';\nexport function Panel(){const [slot,setSlot]=useState(0);const restore=()=>{setSlot.call(null,-1);};useEffect(()=>{if(slot>0)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 125,
      },
    ],
  },
  {
    name: "helper-local-reassigned-value",
    code: "import {useEffect,useState} from 'react';\nexport function Panel(){const [slot,setSlot]=useState(0);const createSlot=()=>Math.random();const restore=()=>{let next=-1;next=createSlot();setSlot(next);};useEffect(()=>{if(slot>0)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 182,
      },
    ],
  },
  {
    name: "helper-local-mutated-record-value",
    code: "import {useEffect,useState} from 'react';\nexport function Panel(){const [slot,setSlot]=useState(0);const createSlot=()=>Math.random();const restore=()=>{const box={next:-1};box.next=createSlot();setSlot(box.next);};useEffect(()=>{if(slot>0)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 198,
      },
    ],
  },
  {
    name: "helper-local-reassigned-set-identity",
    code: "import {useEffect,useState} from 'react';\nexport function Panel(){const [slot,setSlot]=useState(0);const restore=()=>{let next=null;next=new Set();setSlot(next);};useEffect(()=>{if(slot>0)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 146,
      },
    ],
  },
  {
    name: "helper-local-reassigned-date-identity",
    code: "import {useEffect,useState} from 'react';\nexport function Panel(){const [slot,setSlot]=useState(0);const restore=()=>{let next=null;next=new Date();setSlot(next);};useEffect(()=>{if(slot>0)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 147,
      },
    ],
  },
  {
    name: "helper-local-aliased-member-new-identity",
    code: "import {useEffect,useState} from 'react';\nexport function Panel(){const [slot,setSlot]=useState(0);const restore=()=>{const box={next:-1};const alias=box;box.next=new Set();setSlot(alias.next);};useEffect(()=>{if(slot>0)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 178,
      },
    ],
  },
  {
    name: "helper-local-readonly-primitive-aliases",
    code: "import {useEffect,useState} from 'react';\nexport function Panel(){const [slot,setSlot]=useState(0);const restore=()=>{const base=-1;const next=base;setSlot(next);};useEffect(()=>{if(slot>0)restore();},[slot]);return null;}",
    expectedLocations: [],
  },
  {
    name: "captured-mutable-fresh-identity-writer",
    code: "import {useEffect,useState} from 'react';\nexport function Panel(){const [slot,setSlot]=useState({});let next=null;const createNext=()=>{next=new Set();};const restore=()=>{createNext();setSlot(next);};useEffect(()=>{if(slot)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 182,
      },
    ],
  },
  {
    name: "captured-readonly-primitive-aliases",
    code: "import {useEffect,useState} from 'react';\nconst FALLBACK=-1;export function Panel(){const [slot,setSlot]=useState(0);const next=FALLBACK;const restore=()=>setSlot(next);useEffect(()=>{if(slot>0)restore();},[slot]);return null;}",
    expectedLocations: [],
  },
  {
    name: "destructured-number-prototype-value-refusal",
    code: "import {useEffect,useState} from 'react';\nObject.defineProperty(Number.prototype,'next',{get(){return new Set();},configurable:true});export function Panel(){const [slot,setSlot]=useState({});const restore=()=>{const {next}=1;const alias=next;setSlot(alias);};useEffect(()=>{if(slot)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 241,
      },
    ],
  },
  {
    name: "destructured-string-iterator-value-refusal",
    code: "import {useEffect,useState} from 'react';\nObject.defineProperty(String.prototype,Symbol.iterator,{value:function*(){yield new Set();},configurable:true});export function Panel(){const [slot,setSlot]=useState({});const restore=()=>{const [next]='x';const alias=next;setSlot(alias);};useEffect(()=>{if(slot)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 263,
      },
    ],
  },
  {
    name: "helper-regexp-literal-refusal",
    code: "import {useEffect,useState} from 'react';\nexport function Panel(){const [slot,setSlot]=useState({});const restore=()=>{setSlot(/next/);};useEffect(()=>{if(slot)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 118,
      },
    ],
  },
  {
    name: "helper-const-regexp-alias-refusal",
    code: "import {useEffect,useState} from 'react';\nexport function Panel(){const [slot,setSlot]=useState({});const restore=()=>{const next=/next/;const alias=next;setSlot(alias);};useEffect(()=>{if(slot)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 152,
      },
    ],
  },
  {
    name: "helper-signed-bigint-refusal",
    code: "import {useEffect,useState} from 'react';\nexport function Panel(){const [slot,setSlot]=useState({});const restore=()=>{setSlot(-1n);};useEffect(()=>{if(slot)restore();},[slot]);return null;}",
    expectedLocations: [
      {
        line: 2,
        column: 115,
      },
    ],
  },
];

describe("no-chain-state-updates direct helper self-sync", () => {
  it.each(cases)("$name", ({ code, expectedLocations }) => {
    const result = runRule(noChainStateUpdates, code, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(
      expectedLocations.map(({ line, column }) => ({
        line,
        column,
        nodeType: "CallExpression",
        message: "Chaining state updates triggers an extra render each step.",
      })),
    );
  });
});
