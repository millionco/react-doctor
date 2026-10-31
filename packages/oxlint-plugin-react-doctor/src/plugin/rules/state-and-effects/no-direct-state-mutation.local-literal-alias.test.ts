import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

const cases = [
  {
    name: "local-object-member-write",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 1,
  },
  {
    name: "local-array-push",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = [0]; const [items, setItems] = useState(initial); items.push(1); return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "nested-data-member-write",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { details: { label: "ready" } }; const [snapshot, setSnapshot] = useState(initial); snapshot.details.label = "changed"; return <output />; };',
    options: {},
    expectedDiagnostics: 1,
  },
  {
    name: "computed-state-member-write",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); snapshot["count"] = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 1,
  },
  {
    name: "transparent-assertion-initializer",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = ({ count: 0 } as {count:number}); const [snapshot, setSnapshot] = useState((initial)); snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 1,
  },
  {
    name: "typed-binding-initializer",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial: {count:number} = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 1,
  },
  {
    name: "shared-two-state-initializers",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); const [other, setOther] = useState(initial); snapshot.count = 1;other.count = 2; return <output />; };',
    options: {},
    expectedDiagnostics: 2,
  },
  {
    name: "import-aliased-hook",
    code: 'import { useState as useSnapshot } from "react"; export const Panel=()=>{ const initial={count:0}; const [snapshot,setSnapshot]=useSnapshot(initial); snapshot.count=1; return <output/>; };',
    options: {},
    expectedDiagnostics: 1,
  },
  {
    name: "namespace-hook",
    code: 'import * as React from "react"; export const Panel=()=>{ const initial={count:0}; const [snapshot,setSnapshot]=React.useState(initial); snapshot.count=1; return <output/>; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "component-arrow-event-write",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); const update = () => { snapshot.count = 1; }; return <button onClick={update}>Update</button>; };',
    options: {},
    expectedDiagnostics: 1,
  },
  {
    name: "array-sort",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = [2,1]; const [items,setItems]=useState(initial); items.sort(); return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "pure-type-query-does-not-escape",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); let selected: typeof initial; snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 1,
  },
  {
    name: "module-binding-unsupported",
    code: 'import { useState } from "react";\nconst initial={count:0}; export const Panel=()=>{const [snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "mutable-let-binding",
    code: 'import { useState } from "react";\nexport const Panel = () => { let initial={count:0};const [snapshot,setSnapshot]=useState(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "second-const-alias",
    code: 'import { useState } from "react";\nexport const Panel = () => { const original={count:0};const initial=original;const [snapshot,setSnapshot]=useState(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "factory-call-initializer",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial=createInitial();const [snapshot,setSnapshot]=useState(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "opaque-instance",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial=new Controller();const [snapshot,setSnapshot]=useState(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "parameter-initializer",
    code: 'import { useState } from "react";\nexport const Panel=({initial})=>{const [snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "spread-object",
    code: 'import { useState } from "react";\nexport const Panel = () => { const previous={count:0};const initial={...previous};const [snapshot,setSnapshot]=useState(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "spread-array",
    code: 'import { useState } from "react";\nexport const Panel = () => { const previous=[0];const initial=[...previous];const [items,setItems]=useState(initial);items.push(1); return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "getter-property",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial={get count(){return 0;}};const [snapshot,setSnapshot]=useState(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "method-property",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial={count:0,refresh(){}};const [snapshot,setSnapshot]=useState(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "prototype-property",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial={__proto__:controller,count:0};const [snapshot,setSnapshot]=useState(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "computed-initial-property",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial={["count"]:0};const [snapshot,setSnapshot]=useState(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "dynamic-leaf",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial={count:props.count};const [snapshot,setSnapshot]=useState(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "escaped-call",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); consume(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "retained-identity-alias",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); const retained=initial;snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "read-extra-initial-member",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); void initial.count;snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "initial-object-mutated",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); initial.count=2;snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "initialization-after-hook",
    code: 'import { useState } from "react";\nexport const Panel = () => { const [snapshot,setSnapshot]=useState(initial);const initial={count:0};snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "owner-global-eval-read",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); void eval;snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "nested-owner-global-eval-read",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); const inspect=()=>{void eval;};snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "runtime-enum-owner",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); enum Mode {Ready=1} snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "runtime-namespace-owner",
    code: 'import { useState } from "react";namespace Mode {export const ready=1;}\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "safe-new-object-update",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); setSnapshot(previous=>({...previous,count:1})); return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "shadowed-state-parameter",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); const update=(snapshot)=>{snapshot.count=1;}; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "unrelated-direct-literal-legacy",
    code: 'import { useState } from "react";\nexport const Panel = () => { const [snapshot,setSnapshot]=useState({count:0});snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 1,
  },
  {
    name: "fake-hook-provider",
    code: 'import { useState } from "react";\nexport const Panel = () => { const useState=(value)=>[value,()=>{}];const initial={count:0};const [snapshot,setSnapshot]=useState(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "literal-function-leaf",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial={count:0,callback:()=>0};const [snapshot,setSnapshot]=useState(initial);snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "unrelated-ordinary-global-read",
    code: 'import { useState } from "react";\nexport const Panel = () => { const initial = { count: 0 }; const [snapshot, setSnapshot] = useState(initial); void console;snapshot.count = 1; return <output />; };',
    options: {},
    expectedDiagnostics: 1,
  },
  {
    name: "default-provider-property-replaced",
    code: 'import React,{useState}from"react";React.useState=replacement;export const Panel=()=>{const initial={count:0};const [snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "default-provider-transported",
    code: 'import React,{useState}from"react";consume(React);export const Panel=()=>{const initial={count:0};const [snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "named-provider-transported",
    code: 'import{useState}from"react";consume(useState);export const Panel=()=>{const initial={count:0};const [snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "selected-state-let-reassigned",
    code: 'import{useState}from"react";export const Panel=()=>{const initial={count:0};let[snapshot,setSnapshot]=useState(initial);snapshot={count:2};snapshot.count=3;return <output/>;};',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "default-provider-type-only-read",
    code: 'import React,{useState}from"react";type Event=React.FormEvent;export const Panel=()=>{const initial={count:0};const [snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    options: {},
    expectedDiagnostics: 1,
  },
  {
    name: "ordinary-named-hook-other-direct-call",
    code: 'import{useState}from"react";export const Other=()=>{const[value,setValue]=useState(0);return <output>{value}</output>;};export const Panel=()=>{const initial={count:0};const [snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    options: {},
    expectedDiagnostics: 1,
  },
  {
    name: "type-only-selected-hook",
    code: 'import type{useState}from"react";export const Panel=()=>{const initial={count:0};const [snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "module-global-eval-reference",
    code: 'import{useState}from"react";void eval;export const Panel=()=>{const initial={count:0};const [snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    options: {},
    expectedDiagnostics: 0,
  },
  {
    name: "named-import-alias-write",
    code: 'import{useState as useSnapshot}from"react";useSnapshot=replacement;export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useSnapshot(initial);snapshot.count=1;return <output/>;};',
    options: {},
    expectedDiagnostics: 0,
  },
];

describe("no-direct-state-mutation local literal initializer", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noDirectStateMutation, testCase.code, testCase.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedDiagnostics);
    });
  }
});
