import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { collectEffectStateWriteFacts } from "./utils/collect-effect-state-write-facts.js";
import * as accumulatorPredicates from "./utils/is-consumed-state-accumulator.js";
import * as effectAst from "./utils/effect/ast.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";

interface AccumulatorCase {
  name: string;
  source: string;
  expected: boolean;
}

const cases: ReadonlyArray<AccumulatorCase> = [
  {
    name: "direct-addition",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },
  {
    name: "ceil-const-alias",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },
  {
    name: "single-clamp-sibling",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);if(next>amount){setCount(amount);return false;}setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },
  {
    name: "state-free-frame-arithmetic",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const duration=400;const interval=20;const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount/(duration/interval))});return <span>{count}</span>;};',
    expected: true,
  },
  {
    name: "state-annihilated-zero",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count*0+amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "discarded-sequence",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount((count,amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "cancelled-state",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count-count+amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "shadowed-state-name",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(count:number,amount:number)=>{setCount(count+amount);};useEffect(()=>{step(0,amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "unreachable-write",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{return;setCount(count+amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "dead-if",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{if(false){setCount(count+amount);}};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "equivalent-equality-guard",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{if(count===amount){setCount(count+0);}};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "early-inequality-return",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{if(count!==amount)return;setCount(count+0);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "other-writer-control",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const reset=()=>setCount(0);const step=(amount:number)=>{if(count===amount)setCount(amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "mutable-rhs-alias",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{let next=count+amount;next=amount;setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "readonly-syntax-but-binding-write",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=count+amount;if(amount)next=amount;setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "conditional-rhs",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(amount?count+amount:amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "opaque-value-helper",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const round=(value:number)=>value*0;const step=(amount:number)=>{setCount(round(count+amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "member-getter-step",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const input={get step(){return amount;}};const step=(amount:number)=>{setCount(count+input.step);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "mutable-frame-parameter",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{amount=0;setCount(count+amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "default-frame-parameter",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number=0)=>{setCount(count+amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "rest-frame-parameter",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(...amount:number[])=>{setCount(count+amount[0]);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "functional-updater",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(previous=>previous+amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "deferred-invocation",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{setTimeout(()=>step(amount),10)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "ceil-replaced",
    source:
      'Math.ceil=()=>0;import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(Math.ceil(count+amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "math-assigned-through-alias",
    source:
      'const intrinsic=Math;intrinsic.ceil=()=>0;import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(Math.ceil(count+amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "math-opaque-escape",
    source:
      'unknown(Math);import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(Math.ceil(count+amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "provider-math-replaced",
    source:
      'globalThis.Math.ceil=()=>0;import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(Math.ceil(count+amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "reflection-replacement",
    source:
      'Object.assign(Math,{ceil:()=>0});import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(Math.ceil(count+amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "provider-eval",
    source:
      'globalThis.eval("Math.ceil=()=>0");import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(Math.ceil(count+amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "derived-constructor",
    source:
      'const {constructor:execute}=()=>{};execute("Math.ceil=()=>0")();import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(Math.ceil(count+amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "unknown-computed-pattern",
    source:
      'const getKey=()=>"constructor";const {[getKey()]:execute}=()=>{};execute("Math.ceil=()=>0")();import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(Math.ceil(count+amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "mutable-react-api",
    source:
      'import * as React from "react";React.useState=custom;import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "opaque-prop-call",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(read())});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "state-fed-step",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(count)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "unknown-numeric-seed",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(getSeed());const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "nonfinite-literal-step",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(Infinity)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "metadata-read-differential",
    source:
      'const label=Math.ceil.name;import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(Math.ceil(count+amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "default-rhs-read-is-not-binding-write",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);let target;({target=amount}={});const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },
  {
    name: "local-math-object-shadow",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const Math={ceil:(value:number)=>0};const step=(amount:number)=>{setCount(Math.ceil(count+amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "math-parameter-shadow",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,Math:{ceil:(value:number)=>number})=>{setCount(Math.ceil(count+amount));};useEffect(()=>{step(amount,{ceil:()=>0})});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "foreign-math-import",
    source:
      'import Math from "opaque-rounding";import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(Math.ceil(count+amount));};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "type-only-state-api",
    source:
      'import {useEffect} from "react";import type {useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "mutable-selected-state-api-alias",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{let stateApi=useState;stateApi=custom;const[count,setCount]=stateApi(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "selected-state-api-escape",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{unknown(useState);const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "constant-infinite-arithmetic-step",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(1/0)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "constant-nan-arithmetic-step",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(0/0)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "constant-overflow-step",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(1e308*1e308)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "opaque-frame-escape",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};unknown(step);useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-callable-alias",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};const alias=step;useEffect(()=>{alias(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-binding-replacement",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};if(amount)step=custom;useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "named-self-frame",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=function Inner(amount:number){Inner(0);setCount(count+amount);};useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-runtime-arguments",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{void arguments;setCount(count+amount);};useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "clamp-limit-mismatch",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);if(next>amount){setCount(0);return false;}setCount(next);};useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "clamp-alias-before-initialization",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{if(next>amount){setCount(amount);return false;}const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "multiple-clamp-protocol",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);if(next>amount){setCount(amount);return false;}if(next>amount){setCount(amount);return false;}setCount(next);};useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "type-only-effect-api",
    source:
      'import {useState} from "react";import type {useEffect} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "namespace-state-outside-first-scope",
    source:
      'import {useEffect} from "react";import * as React from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=React.useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "conditional-frame-entry",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{if(amount)step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "dead-frame-entry",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{if(false)step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "unreachable-frame-entry",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{return;step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "declared-object-step-prop",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:{valueOf():number}})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "direct-opaque-step-prop",
    source:
      'import {useEffect,useState} from "react";const View=({amount})=>{const[count,setCount]=useState(0);useEffect(()=>{setCount(count+amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "named-number-contract-clamp",
    source:
      'import {useEffect,useState} from "react";interface Options{amount:number}const View=({amount}:Options)=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);if(next>amount){setCount(amount);return false;}setCount(next);};useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: true,
  },
  {
    name: "opaque-setter-escape",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);unknown(setCount);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "setter-metadata-unsupported",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const name=setCount.name;const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "extra-frame-argument-unsupported",
    source:
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount,opaque());});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "resolved-const-global-math",
    source:
      'import {useEffect,useState} from "react";const namespaceKey="Math";globalThis[namespaceKey].ceil=()=>3;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "resolved-template-global-math",
    source:
      'import {useEffect,useState} from "react";globalThis[`Math`].ceil=()=>3;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "resolved-const-template-global-math",
    source:
      'import {useEffect,useState} from "react";const namespaceKey=`Math`;globalThis[namespaceKey].ceil=()=>3;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "global-provider-alias-math",
    source:
      'import {useEffect,useState} from "react";const provider=globalThis;provider.Math.ceil=()=>3;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "global-self-projection-math",
    source:
      'import {useEffect,useState} from "react";globalThis.self.Math.ceil=()=>3;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "global-nested-globalthis-math",
    source:
      'import {useEffect,useState} from "react";globalThis.globalThis.Math.ceil=()=>3;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "node-global-self-projection-math",
    source:
      'import {useEffect,useState} from "react";global.self.Math.ceil=()=>3;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "aliased-self-projection-math",
    source:
      'import {useEffect,useState} from "react";const provider=globalThis.self;provider.Math.ceil=()=>3;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "shadowed-globalthis-receiver",
    source:
      'import {useEffect,useState} from "react";const globalThis={Math:{ceil:()=>3}};globalThis.Math.ceil=()=>3;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "shadowed-window-receiver",
    source:
      'import {useEffect,useState} from "react";const window={Math:{ceil:()=>3}};window.Math.ceil=()=>3;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "benign-global-provider-reference-conservative",
    source:
      'import {useEffect,useState} from "react";void globalThis.description;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "bare-ceil-genuine-direct-positive",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);useEffect(()=>{setCount(Math.ceil(count+amount));});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "global-math-replacement-does-not-change-addition-profile",
    source:
      'import {useEffect,useState} from "react";const namespaceKey="Math";globalThis[namespaceKey].ceil=()=>3;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=count+amount;setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },
  {
    name: "effect-default-provider-direct-replacement",
    source:
      'import React from "react";React.useEffect=customEffect;import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "effect-default-provider-pattern-replacement",
    source:
      'import React from "react";({driver:React.useEffect}=replacement);import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "effect-default-provider-loop-replacement",
    source:
      'import React from "react";for(React.useEffect of replacements){}import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "effect-namespace-provider-replacement",
    source:
      'import * as React from "react";React.useEffect=customEffect;import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "effect-default-provider-const-alias",
    source:
      'import React from "react";const Driver=React;Driver.useEffect=customEffect;import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "effect-default-provider-opaque-escape",
    source:
      'import React from "react";install(React);import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "effect-native-method-value-escape",
    source:
      'import React from "react";install(React.useEffect);import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "effect-default-as-provider-replacement",
    source:
      'import {default as Driver} from "react";Driver.useEffect=customEffect;import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "effect-default-provider-metadata-read",
    source:
      'import React from "react";void React.useEffect.description;import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "effect-default-provider-default-rhs-read",
    source:
      'import React from "react";let selected;({selected=React.useEffect}={});import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "effect-default-provider-known-computed-metadata",
    source:
      'import React from "react";void React["useEffect"].description;import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "effect-provider-computed-pattern-read-conservative",
    source:
      'import React from "react";let selected;({[React.useEffect]:selected}={});import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "effect-foreign-provider-mutation-distinct-source",
    source:
      'import Driver from "unrelated-hooks";Driver.useEffect=customEffect;import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "effect-shadowed-default-provider-receiver",
    source:
      'import React from "react";const shadow=()=>{const React={useEffect:()=>null};React.useEffect=customEffect;};import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "effect-native-namespace-call-unsupported",
    source:
      'import React,{useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};React.useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "effect-native-renamed-import-positive",
    source:
      'import {useEffect as driveEffect,useState as createState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=createState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};driveEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "canonical-only-both-preact/compat",
    source:
      'import {useEffect,useState} from "preact/compat";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-driver-preact/compat",
    source:
      'import {useState} from "react";import {useEffect} from "preact/compat";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-state-preact/compat",
    source:
      'import {useEffect} from "react";import {useState} from "preact/compat";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-driver-replacement-preact/compat",
    source:
      'import Driver from "preact/compat";import {useState} from "react";import {useEffect} from "preact/compat";Driver.useEffect=customEffect;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-both-preact/hooks",
    source:
      'import {useEffect,useState} from "preact/hooks";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-driver-preact/hooks",
    source:
      'import {useState} from "react";import {useEffect} from "preact/hooks";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-state-preact/hooks",
    source:
      'import {useEffect} from "react";import {useState} from "preact/hooks";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-driver-replacement-preact/hooks",
    source:
      'import Driver from "preact/hooks";import {useState} from "react";import {useEffect} from "preact/hooks";Driver.useEffect=customEffect;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-both-@wordpress/element",
    source:
      'import {useEffect,useState} from "@wordpress/element";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-driver-@wordpress/element",
    source:
      'import {useState} from "react";import {useEffect} from "@wordpress/element";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-state-@wordpress/element",
    source:
      'import {useEffect} from "react";import {useState} from "@wordpress/element";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-driver-replacement-@wordpress/element",
    source:
      'import Driver from "@wordpress/element";import {useState} from "react";import {useEffect} from "@wordpress/element";Driver.useEffect=customEffect;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-both-react-dom",
    source:
      'import {useEffect,useState} from "react-dom";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-driver-react-dom",
    source:
      'import {useState} from "react";import {useEffect} from "react-dom";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-state-react-dom",
    source:
      'import {useEffect} from "react";import {useState} from "react-dom";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "canonical-only-driver-replacement-react-dom",
    source:
      'import Driver from "react-dom";import {useState} from "react";import {useEffect} from "react-dom";Driver.useEffect=customEffect;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "known-literal-zero-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/0));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "known-negative-zero-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/-0));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "known-component-const-zero-divisor",
    source:
      'import {useEffect,useState} from "react";const divisor=0;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "known-const-negative-zero-divisor",
    source:
      'import {useEffect,useState} from "react";const divisor=-0;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "known-arithmetic-zero-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/(1-1)));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "known-arithmetic-alias-zero-divisor",
    source:
      'import {useEffect,useState} from "react";const divisor=4-4;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "known-zero-plain-addition-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=count+(amount/0);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "known-negative-zero-plain-addition-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=count+(amount/-0);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "literal-nonfinite-arithmetic-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/(1/0)));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "literal-overflow-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/(1e308*1e308)));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "nonfinite-global-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/Infinity));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "nan-global-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/NaN));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "mutable-divisor-binding",
    source:
      'import {useEffect,useState} from "react";let divisor=0;divisor=2;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "cyclic-divisor-alias",
    source:
      'import {useEffect,useState} from "react";const divisor=otherDivisor;const otherDivisor=divisor;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: false,
  },

  {
    name: "finite-nonzero-literal-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/2));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "finite-negative-literal-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/-2));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "finite-const-alias-divisor",
    source:
      'import {useEffect,useState} from "react";const divisor=2;export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "finite-nested-arithmetic-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/((8-2)/3)));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "finite-nonzero-plain-addition-divisor",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=count+(amount/2);setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },

  {
    name: "unknown-typed-denominator-source-role",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+(amount/amount));setCount(next);};useEffect(()=>{step(amount)});return <span>{count}</span>;};',
    expected: true,
  },
  {
    name: "frame-zero",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount,0);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-negative-zero",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount,-0);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-positive-zero",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount,+0);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-double-negative-zero",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount,-(-0));});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-parenthesized-zero",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount,(0));});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-readonly-owner-zero-alias",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const zeroDivisor=0;const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount,zeroDivisor);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-readonly-owner-negative-zero-alias",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const zeroDivisor=-0;const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount,zeroDivisor);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-local-zero-alias",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const currentDivisor=divisor;const next=Math.ceil(count+(amount/currentDivisor));setCount(next);};useEffect(()=>{step(amount,0);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-local-unary-zero-alias",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const currentDivisor=-divisor;const next=Math.ceil(count+(amount/currentDivisor));setCount(next);};useEffect(()=>{step(amount,-0);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-unary-parameter-zero",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/(-divisor)));setCount(next);};useEffect(()=>{step(amount,0);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "frame-nonzero",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount,2);});return <span>{count}</span>;};',
    expected: true,
  },
  {
    name: "frame-negative-nonzero",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount,-2);});return <span>{count}</span>;};',
    expected: true,
  },
  {
    name: "frame-nonzero-owner-alias",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const nonzeroDivisor=2;const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};useEffect(()=>{step(amount,nonzeroDivisor);});return <span>{count}</span>;};',
    expected: true,
  },
  {
    name: "frame-nonzero-local-alias",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const currentDivisor=divisor;const next=Math.ceil(count+(amount/currentDivisor));setCount(next);};useEffect(()=>{step(amount,2);});return <span>{count}</span>;};',
    expected: true,
  },
  {
    name: "nested-forwarded-frame-0",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};const forward=(input:number,denominator:number)=>{step(input,denominator);};useEffect(()=>{forward(amount,0);});return <span>{count}</span>;};',
    expected: false,
  },
  {
    name: "nested-forwarded-frame-negative-0",
    source:
      'import {useEffect,useState} from "react";export const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number,divisor:number)=>{const next=Math.ceil(count+(amount/divisor));setCount(next);};const forward=(input:number,denominator:number)=>{step(input,denominator);};useEffect(()=>{forward(amount,-0);});return <span>{count}</span>;};',
    expected: false,
  },
];

describe("consumed state accumulators", () => {
  for (const fixture of cases) {
    it(fixture.name, () => {
      const predicates: boolean[] = [];
      const probe: Rule = {
        id: "accumulator-probe",
        severity: "warn",
        create: (context) => ({
          CallExpression(node) {
            if (
              !isNodeOfType(node, "CallExpression") ||
              !isReactHookCall(node, "useEffect", context.scopes)
            )
              return;
            const analysis = getProgramAnalysis(node);
            if (!analysis) return;
            const facts = collectEffectStateWriteFacts(analysis, context, node, context.filename, {
              includeConsumedStateAccumulator: true,
            });
            predicates.push(...facts.map((fact) => Boolean(fact.hasConsumedStateAccumulator)));
          },
        }),
      };
      const result = runRule(probe, fixture.source);
      expect(result.parseErrors).toEqual([]);
      expect(predicates.some(Boolean)).toBe(fixture.expected);
    });
  }
});

describe("accumulator fact cache isolation", () => {
  for (const optInFirst of [false, true]) {
    it(`preserves the baseline view when opt-in-first is ${optInFirst}`, () => {
      const source =
        'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);if(next>amount){setCount(amount);return false;}setCount(next);};useEffect(()=>{step(amount);});return <span>{count}</span>;};';
      let didInspect = false;
      const predicateSpy = vi.spyOn(accumulatorPredicates, "isConsumedStateAccumulator");
      const callableSpy = vi.spyOn(effectAst, "resolveToFunction");
      const probe: Rule = {
        id: "cache-order-probe",
        severity: "warn",
        create: (context) => ({
          CallExpression(node) {
            if (
              !isNodeOfType(node, "CallExpression") ||
              !isNodeOfType(node.callee, "Identifier") ||
              node.callee.name !== "useEffect"
            )
              return;
            const analysis = getProgramAnalysis(node);
            if (!analysis) return;
            const baseline = () =>
              collectEffectStateWriteFacts(analysis, context, node, context.filename);
            const enriched = () =>
              collectEffectStateWriteFacts(analysis, context, node, context.filename, {
                includeConsumedStateAccumulator: true,
              });
            const firstView = optInFirst ? enriched() : baseline();
            const callableCountAfterFirstView = callableSpy.mock.calls.length;
            expect(callableCountAfterFirstView).toBeGreaterThan(0);
            const baselineFacts = baseline();
            const legacyKeys = [
              "callExpression",
              "setterReference",
              "stateDeclarator",
              "sourceReferences",
              "hasIndependentWriter",
              "isDeferred",
              "isRenderKnownCopy",
              "isSynchronousRenderValue",
              "matchesStateInitializer",
              "readsWrittenState",
              "resetsSourceState",
              "writtenIndexedMemberRootReference",
              "writesPropDerivedMemberValue",
            ];
            for (const fact of baselineFacts)
              expect(Object.keys(fact).sort()).toEqual([...legacyKeys].sort());
            const beforeFields = baselineFacts.map((fact) => Object.entries(fact));
            const enrichedFacts = enriched();
            expect(baselineFacts).toHaveLength(2);
            expect(enrichedFacts.map((fact) => fact.hasConsumedStateAccumulator)).toEqual([
              false,
              true,
            ]);
            expect(firstView).toBe(optInFirst ? enrichedFacts : baselineFacts);
            expect(baseline()).toBe(baselineFacts);
            expect(enriched()).toBe(enrichedFacts);
            expect(predicateSpy).toHaveBeenCalledTimes(2);
            expect(callableSpy.mock.calls.length).toBe(callableCountAfterFirstView);
            expect(enrichedFacts).not.toBe(baselineFacts);
            baselineFacts.forEach((fact, index) => {
              expect(Object.hasOwn(fact, "hasConsumedStateAccumulator")).toBe(false);
              expect(Object.entries(fact)).toEqual(beforeFields[index]);
              expect(enrichedFacts[index]).not.toBe(fact);
              for (const [key, value] of beforeFields[index]) {
                expect(Reflect.get(enrichedFacts[index], key)).toBe(value);
              }
            });
            didInspect = true;
          },
        }),
      };
      const result = runRule(probe, source);
      expect(result.parseErrors).toEqual([]);
      expect(didInspect).toBe(true);
      predicateSpy.mockRestore();
      callableSpy.mockRestore();
    });
  }

  it("retains distinct selected frames for the same setter node", () => {
    const source =
      'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{setCount(count+amount);};useEffect(()=>{step(amount);step(1/0);});return <span>{count}</span>;};';
    let didInspect = false;
    const probe: Rule = {
      id: "frame-identity-probe",
      severity: "warn",
      create: (context) => ({
        CallExpression(node) {
          if (
            !isNodeOfType(node, "CallExpression") ||
            !isNodeOfType(node.callee, "Identifier") ||
            node.callee.name !== "useEffect"
          )
            return;
          const analysis = getProgramAnalysis(node);
          if (!analysis) return;
          const baseline = collectEffectStateWriteFacts(analysis, context, node);
          const enriched = collectEffectStateWriteFacts(analysis, context, node, context.filename, {
            includeConsumedStateAccumulator: true,
          });
          expect(baseline).toHaveLength(2);
          expect(baseline[0].callExpression).toBe(baseline[1].callExpression);
          expect(baseline[0]).not.toBe(baseline[1]);
          expect(enriched.map((fact) => fact.hasConsumedStateAccumulator)).toEqual([true, false]);
          expect(collectEffectStateWriteFacts(analysis, context, node)).toBe(baseline);
          didInspect = true;
        },
      }),
    };
    expect(runRule(probe, source).parseErrors).toEqual([]);
    expect(didInspect).toBe(true);
  });

  it("keeps empty baseline and enriched views separately cached", () => {
    const source =
      'import {useEffect} from "react";const View=()=>{useEffect(()=>{});return null;};';
    let didInspect = false;
    const probe: Rule = {
      id: "empty-cache-probe",
      severity: "warn",
      create: (context) => ({
        CallExpression(node) {
          if (
            !isNodeOfType(node, "CallExpression") ||
            !isNodeOfType(node.callee, "Identifier") ||
            node.callee.name !== "useEffect"
          )
            return;
          const analysis = getProgramAnalysis(node);
          if (!analysis) return;
          const baseline = collectEffectStateWriteFacts(analysis, context, node);
          const enriched = collectEffectStateWriteFacts(analysis, context, node, context.filename, {
            includeConsumedStateAccumulator: true,
          });
          expect(baseline).toEqual([]);
          expect(enriched).toEqual([]);
          expect(baseline).not.toBe(enriched);
          expect(collectEffectStateWriteFacts(analysis, context, node)).toBe(baseline);
          expect(
            collectEffectStateWriteFacts(analysis, context, node, context.filename, {
              includeConsumedStateAccumulator: true,
            }),
          ).toBe(enriched);
          didInspect = true;
        },
      }),
    };
    expect(runRule(probe, source).parseErrors).toEqual([]);
    expect(didInspect).toBe(true);
  });
});

describe("derived consumers share only the opted-in view", () => {
  for (const effectFirst of [false, true]) {
    it(`keeps clamp warnings with effect-first ${effectFirst}`, () => {
      const source =
        'import {useEffect,useState} from "react";const View=({amount}:{amount:number})=>{const[count,setCount]=useState(0);const step=(amount:number)=>{const next=Math.ceil(count+amount);if(next>amount){setCount(amount);return false;}setCount(next);};useEffect(()=>{step(amount);});return <span>{count}</span>;};';
      const probe: Rule = {
        id: "consumer-order-probe",
        severity: "warn",
        create: (context) => {
          const first = (effectFirst ? noDerivedStateEffect : noDerivedState).create(context);
          const second = (effectFirst ? noDerivedState : noDerivedStateEffect).create(context);
          return {
            CallExpression(node) {
              first.CallExpression?.(node);
              second.CallExpression?.(node);
            },
          };
        },
      };
      const result = runRule(probe, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(2);
      expect(
        result.diagnostics.filter((diagnostic) => diagnostic.message.startsWith("Storing")),
      ).toHaveLength(1);
      expect(
        result.diagnostics.filter((diagnostic) => diagnostic.message.startsWith("You pay")),
      ).toHaveLength(1);
    });
  }
});
