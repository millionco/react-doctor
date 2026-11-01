import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateRefInFunctionComponent } from "./no-create-ref-in-function-component.js";
const reviewCases = [
  {
    name: "baseline-effect-observed",
    code: 'import {createRef,useEffect} from "react"; export const Example=()=>{const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 1,
  },
  {
    name: "merged-result-binding",
    code: 'import {createRef,useEffect} from "react"; export const Example=()=>{const refs=[1,2].map(()=>createRef());interface refs{};useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 1,
  },
  {
    name: "inner-erased-result-read",
    code: 'import {createRef,useEffect} from "react"; export const Example=()=>{const refs=[1,2].map(()=>createRef());useEffect(()=>{interface refs{};void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 1,
  },
  {
    name: "inner-erased-imported-receiver",
    code: 'import rows from "./rows";import {createRef,useEffect} from "react"; export const Example=()=>{interface rows{};const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 1,
  },
  {
    name: "merged-event-observer-binding",
    code: 'import {createRef} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());const focus=(index:number)=>{void refs[index].current};interface focus{};return <button onClick={()=>focus(0)}/>;};',
    expectedCount: 1,
  },
  {
    name: "merged-numeric-index-parameter",
    code: 'import {createRef} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());const focus=(index:number)=>{interface index{};void refs[index].current};return <button onClick={()=>focus(0)}/>;};',
    expectedCount: 1,
  },
  {
    name: "hidden-result-replacement-control",
    code: 'import {createRef,useEffect} from "react"; export const Example=()=>{const refs=[1,2].map(()=>createRef());const rewrite=()=>{interface refs{};refs[0]={current:null}};rewrite();useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 0,
  },
  {
    name: "genuine-inner-result-shadow-control",
    code: 'import {createRef,useEffect} from "react"; export const Example=()=>{const refs=[1,2].map(()=>createRef());useEffect(()=>{const refs=[{current:null}];interface refs{};void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 0,
  },
  {
    name: "global-eval-replaces-array-map",
    code: 'globalThis.eval("Array.prototype.map = function(callback) { return [] }");import {createRef,useEffect} from "react"; export const Example=()=>{const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 0,
  },
  {
    name: "function-constructor-replaces-array-map",
    code: 'Function("Array.prototype.map = function(callback) { return [] }")();import {createRef,useEffect} from "react"; export const Example=()=>{const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 0,
  },
  {
    name: "ownership-ordinary-effect",
    code: "import {createRef,useEffect} from 'react';import {stableRef,replaceAll} from './helpers';export const Example=()=>{const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};",
    expectedCount: 1,
  },
  {
    name: "ownership-replace-fill",
    code: "import {createRef,useEffect} from 'react';import {stableRef,replaceAll} from './helpers';export const Example=()=>{const refs=[1,2].map(()=>createRef());refs.fill(stableRef);useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};",
    expectedCount: 0,
  },
  {
    name: "ownership-replace-splice",
    code: "import {createRef,useEffect} from 'react';import {stableRef,replaceAll} from './helpers';export const Example=()=>{const refs=[1,2].map(()=>createRef());refs.splice(0,refs.length,stableRef,stableRef);useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};",
    expectedCount: 0,
  },
  {
    name: "ownership-replace-define-property",
    code: "import {createRef,useEffect} from 'react';import {stableRef,replaceAll} from './helpers';export const Example=()=>{const refs=[1,2].map(()=>createRef());Object.defineProperty(refs,0,{value:stableRef});useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};",
    expectedCount: 0,
  },
  {
    name: "ownership-opaque-array-consumer",
    code: "import {createRef,useEffect} from 'react';import {stableRef,replaceAll} from './helpers';export const Example=()=>{const refs=[1,2].map(()=>createRef());replaceAll(refs);useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};",
    expectedCount: 0,
  },
  {
    name: "ownership-alias-fill",
    code: "import {createRef,useEffect} from 'react';import {stableRef,replaceAll} from './helpers';export const Example=()=>{const refs=[1,2].map(()=>createRef());const alias=refs;alias.fill(stableRef);useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};",
    expectedCount: 0,
  },
  {
    name: "ownership-readonly-length",
    code: "import {createRef,useEffect} from 'react';import {stableRef,replaceAll} from './helpers';export const Example=()=>{const refs=[1,2].map(()=>createRef());void refs.length;useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};",
    expectedCount: 1,
  },
  {
    name: "ownership-direct-element-replacement",
    code: "import {createRef,useEffect} from 'react';import {stableRef,replaceAll} from './helpers';export const Example=()=>{const refs=[1,2].map(()=>createRef());refs[0]=stableRef;refs[1]=stableRef;useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};",
    expectedCount: 0,
  },
  {
    name: "inert-eval-function-keys",
    code: 'const metadata={eval:"label",Function:"label"};void metadata;import {createRef,useEffect} from "react"; export const Example=()=>{const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 1,
  },
  {
    name: "genuine-local-function-provider",
    code: 'const Function=()=>()=>{};Function()();import {createRef,useEffect} from "react"; export const Example=()=>{const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 1,
  },
  {
    name: "genuine-local-eval-carrier",
    code: 'const globalThis={eval:()=>{}};globalThis.eval("label");import {createRef,useEffect} from "react"; export const Example=()=>{const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 1,
  },
];
describe("observed inline map bounded review", () => {
  for (const source of reviewCases) {
    it(source.name, () => {
      const result = runRule(noCreateRefInFunctionComponent, source.code, {
        filename: "synthetic.tsx",
        forceJsx: true,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(source.expectedCount);
    });
  }
});
