import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";

const cases = [
  {
    name: "rejects native carrier alias provider rewriting",
    code: 'const world=globalThis; world.require("react").useRef=()=>({current:0});import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "rejects erased carrier alias provider rewriting",
    code: 'declare const globalThis:any;const world=globalThis; world.require("react").useRef=()=>({current:0});import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "preserves harmless erased carrier checks",
    code: 'declare const globalThis:any;typeof globalThis;void globalThis;import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "rejects an erased global carrier provider member",
    code: 'declare const globalThis:any;globalThis.require("react").useRef = () => ({current:0});import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "preserves unrelated erased global carrier references",
    code: 'declare const globalThis:any;globalThis.unrelated;import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "preserves an inert erased declaration",
    code: 'declare const require: any;import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after declare const require: any;",
    code: 'declare const require: any;require("react").useRef = () => ({current:0});import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after interface require {}",
    code: 'interface require {}require("react").useRef = () => ({current:0});import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: 'rejects runtime provider rewriting after import type require from "provider-types";',
    code: 'import type require from "provider-types";require("react").useRef = () => ({current:0});import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "rejects type-only import-equals provider rewrites",
    code: 'import type require = require("provider-types");require("react").useRef = () => ({current:0});import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "preserves genuine import-equals value binding",
    code: 'import require = require("provider-values");require("react").useRef = () => ({current:0});import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "preserves genuine value binding with merged interface",
    code: 'const require = () => ({}); interface require {}require("react").useRef = () => ({current:0});import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "rejects empty namespace provider masking",
    code: 'namespace require {}require("react").useRef = () => ({current:0});import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "rejects type-only namespace provider masking",
    code: 'namespace require { export interface Marker {} }require("react").useRef = () => ({current:0});import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "rejects nested type-only namespace provider masking",
    code: 'namespace require { export namespace Nested { export type Marker = unknown; } }require("react").useRef = () => ({current:0});import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "preserves an inert empty namespace",
    code: 'namespace require {}import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "preserves a genuine runtime namespace",
    code: 'namespace require { export const marker = 1; } void require;import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "rejects opaque runtime imported provider exposure",
    code: 'import React from "react";function rewrite(){mutate(React);}rewrite();declare const globalThis:any;typeof globalThis;void globalThis;import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "rejects imported provider exposure beneath inner interface",
    code: 'import React from "react";function rewrite(){interface React{}mutate(React);}rewrite();declare const globalThis:any;typeof globalThis;void globalThis;import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "rejects imported provider exposure beneath inner type alias",
    code: 'import React from "react";function rewrite(){type React=unknown;mutate(React);}rewrite();declare const globalThis:any;typeof globalThis;void globalThis;import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "rejects imported provider exposure beneath erased namespace",
    code: 'import React from "react";namespace ProofScope{namespace React{}mutate(React);}declare const globalThis:any;typeof globalThis;void globalThis;import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "preserves genuine inner runtime provider shadow",
    code: 'import React from "react";function rewrite(){const React={};interface React{}mutate(React);}rewrite();declare const globalThis:any;typeof globalThis;void globalThis;import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 0,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(noDerivedStateEffect, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
