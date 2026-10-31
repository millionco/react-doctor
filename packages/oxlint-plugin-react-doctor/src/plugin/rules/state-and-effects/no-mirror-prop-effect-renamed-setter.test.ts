import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMirrorPropEffect } from "./no-mirror-prop-effect.js";

const cases = [
  {
    name: "canonical renamed setter",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "namespace effect with named state",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  React.useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "namespace state and effect",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = React.useState(value);  React.useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "namespace import",
    code: 'import * as React from "react";  export const Panel = ({value, reset}) => { const [draft,writeDraft] = React.useState(value);  React.useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "named aliases",
    code: 'import {useState as useNativeState,useEffect as useNativeEffect} from "react";  export const Panel = ({value, reset}) => { const[draft,writeDraft]=useNativeState(value);  useNativeEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "ordinary local edit retained",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <button onClick={()=>writeDraft("edited")}>{draft}</button>; };',
    expected: 1,
  },
  {
    name: "typed namespace causal shape",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; type Props = React.PropsWithChildren<{value:string[]}>;  export const Panel = ({value}:Props) => { const [draft, writeDraft] = useState(value);  React.useEffect(()=>{writeDraft(value);},[value]); return <button onClick={()=>writeDraft([...draft])}>{draft.map((entry)=><span key={entry}>{entry}</span>)}</button>; };',
    expected: 1,
  },
  {
    name: "setter dependency precise",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value,writeDraft]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "layout effect",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useLayoutEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "concise setter callback",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>writeDraft(value),[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "anonymous ordinary callback",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(function(){writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "legacy setter unchanged",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const[draft,setDraft]=useState(value);  useEffect(()=>setDraft(value),[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "unbound native names deferred",
    code: "  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };",
    expected: 0,
  },
  {
    name: "foreign state hook deferred",
    code: 'import {useState} from "foreign-state";import {useEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "foreign effect hook deferred",
    code: 'import {useState} from "react";import {useEffect} from "foreign-effects";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "type only state deferred",
    code: 'import type {useState} from "react";import {useEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "type only effect deferred",
    code: 'import {useState} from "react";import type {useEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "fake local state",
    code: 'import {useEffect} from "react"; const useState=(input)=>[input,()=>{}]; export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "fake local effect",
    code: 'import {useState} from "react"; const useEffect=(callback)=>callback(); export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "state namespace replaced",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; React.useState = replacement; export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "effect namespace replaced",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; React.useEffect = replacement; export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "state named pattern write",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; [useState] = replacements; export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "effect named loop write",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; for(useEffect of replacements) {} export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "namespace escape",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; expose(React); export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "hook escape",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; expose(useState); export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "genuine eval unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; eval("replace hook"); export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "genuine Function unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; Function("return null"); export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "constructor carrier unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; const compile = (()=>{}).constructor; export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "require alias unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; const load = require; export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "builtin loader import unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; import {createRequire} from "node:module";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "literal dynamic React import unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; import("react"); export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "literal dynamic module import unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; import("module"); export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "shadowed Function separate",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react"; const Function=()=>null;Function(); export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "mutable pair deferred",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { let [draft,writeDraft]=useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "setter binding replacement",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value); writeDraft = replacement; useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "setter pattern replacement",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value); [writeDraft] = replacements; useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "setter loop target replacement",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value); for(writeDraft of replacements) {} useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "setter alias unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value); const edit=writeDraft; useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "setter escaped unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value); expose(writeDraft); useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "prop binding replacement",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value); value = replacement; useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "prop pattern replacement",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value); [value] = replacements; useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "callback parameter shadow setter",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect((writeDraft)=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "callback parameter shadow prop",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect((value)=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "named callback self shadow setter",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(function writeDraft(){writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "named ordinary callback deferred",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(function synchronize(){writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "async callback deferred",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(async()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "generator callback deferred",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(function*(){writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "unknown callback input deferred",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect((unused)=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "callback alias stays legacy quiet",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value); const synchronize=()=>writeDraft(value); useEffect(synchronize,[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "extra callback work deferred",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{notify();writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "wrong initializer argument",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(other);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "unrelated setter",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeOther(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "new member initializer unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = (props) => { const[draft,writeDraft]=useState(props.value);  useEffect(()=>{writeDraft(props.value);},[props]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "new member only dependency unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = (props) => { const[draft,writeDraft]=useState(props.value);  useEffect(()=>{writeDraft(props.value);},[props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "separate identifier reset",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value,reset]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "separate member reset",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value,reset.version]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "separate call reset",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value,readReset()]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "spread reset unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value,...resets]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "array reset unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value,[]]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "hole unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value,,]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "literal extra unsupported",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value,1]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "initial only seed exemption",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({initialValue}) => { const[draft,writeDraft]=useState(initialValue);  useEffect(()=>{writeDraft(initialValue);},[initialValue]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "optional setter deferred",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft?.(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "extra setter argument deferred",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value,other);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "extra state argument deferred",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const[draft,writeDraft]=useState(value,other);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "extra effect argument deferred",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value],other); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "nested effect deferred",
    code: 'import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  const synchronize=()=>useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "legacy custom prefixed path unchanged",
    code: "  export const Panel = ({value, reset}) => { const[draft,setDraft]=useState(value);  useEffect(()=>{setDraft(value);},[value]); return <output>{draft}</output>; };",
    expected: 1,
  },
];

describe("no-mirror-prop-effect renamed native setters", () => {
  it.each(cases)("$name", ({ code, expected }) => {
    const result = runRule(noMirrorPropEffect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
