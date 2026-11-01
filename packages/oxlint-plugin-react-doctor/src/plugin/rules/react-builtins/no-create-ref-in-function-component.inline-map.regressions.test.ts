import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateRefInFunctionComponent } from "./no-create-ref-in-function-component.js";

const cases = [
  {
    name: "inline-native-map-observed-ref",
    code: 'import {createRef,useEffect} from "react"; export const Example=()=>{const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 1,
  },
  {
    name: "map-in-event-stays-deferred",
    code: 'import {createRef} from "react";export const Example=()=> <button onClick={()=>[1].map(()=>createRef())}/>;',
    expectedCount: 0,
  },
  {
    name: "map-in-effect-stays-effect",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{useEffect(()=>{[1].map(()=>createRef())},[]);return <div/>};',
    expectedCount: 0,
  },
  {
    name: "visible-custom-deferred-map",
    code: 'import {createRef} from "react";const rows={map(callback){globalThis.saved=callback;return []}};export const Example=()=>{const refs=rows.map(()=>createRef());return <div data-count={refs.length}/>};',
    expectedCount: 0,
  },
  {
    name: "state-initializer-map-retains-exception",
    code: 'import {createRef,useState} from "react";export const Example=()=>{const[refs]=useState(()=>[1].map(()=>createRef()));return <div ref={refs[0]}/>};',
    expectedCount: 0,
  },
  {
    name: "module-map-not-component",
    code: 'import {createRef} from "react";export const refs=[1].map(()=>createRef());',
    expectedCount: 0,
  },
  {
    name: "shadow-create-ref",
    code: "const createRef=()=>({current:null});export const Example=()=>{const refs=[1].map(()=>createRef());return <div data-ref={String(refs[0])}/>};",
    expectedCount: 0,
  },
  {
    name: "named-provider-alias-map",
    code: 'import {createRef as makeRef,useEffect} from "react";export const Example=()=>{const refs=[1].map(()=>makeRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>};',
    expectedCount: 1,
  },
  {
    name: "readonly-default-import-array",
    code: 'import {createRef,useEffect} from "react";import rows from "./rows";export const Example=()=>{const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 1,
  },
  {
    name: "readonly-named-import-array",
    code: 'import {createRef,useEffect} from "react";import {rows} from "./rows";export const Example=()=>{const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 1,
  },
  {
    name: "local-dense-primitive-array",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const rows=["first",true,2];const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 1,
  },
  {
    name: "direct-native-event-current-read",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());return <button onClick={()=>{void refs[0].current}} ref={refs[0]}/>;};',
    expectedCount: 1,
  },
  {
    name: "named-typed-handler-native-event",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());const focus=(index:number)=>{void refs[index].current?.focus()};return <button onClick={()=>focus(0)} ref={refs[0]}/>;};',
    expectedCount: 1,
  },
  {
    name: "same-receiver-render-map-native-event",
    code: 'import {createRef,useEffect} from "react";import rows from "./rows";export const Example=()=>{const refs=rows.map(()=>createRef());function focus(index:number){void refs[index]?.current?.focus()}return <>{rows.map((_item,index)=><button key={index} onClick={()=>focus(index)} ref={refs[index]}/>)}</>;};',
    expectedCount: 1,
  },
  {
    name: "different-receiver-render-map-unsupported",
    code: 'import {createRef,useEffect} from "react";import rows from "./rows";import otherRows from "./other";export const Example=()=>{const refs=rows.map(()=>createRef());function focus(index:number){void refs[index].current}return <>{otherRows.map((_item,index)=><button key={index} onClick={()=>focus(index)}/>)}</>;};',
    expectedCount: 0,
  },
  {
    name: "unused-map-result",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());return <div/>;};',
    expectedCount: 0,
  },
  {
    name: "discarded-map-call",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{[1,2].map(()=>createRef());return <div/>};',
    expectedCount: 0,
  },
  {
    name: "void-result-without-observation",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());void refs;return <div/>;};',
    expectedCount: 0,
  },
  {
    name: "length-only-result",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());return <div data-count={refs.length}/>;};',
    expectedCount: 0,
  },
  {
    name: "dom-ref-only-unsupported",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "unknown-consumer-unsupported",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());consume(refs);return <div/>;};',
    expectedCount: 0,
  },
  {
    name: "current-assignment-only-scratch",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());useEffect(()=>{refs[0].current=null},[refs]);return <div/>;};',
    expectedCount: 0,
  },
  {
    name: "unused-local-observer",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());const focus=()=>{void refs[0].current};return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "recursive-unused-observer",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());const focus=()=>{void refs[0].current;focus()};return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "opaque-component-event-unsupported",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());return <Widget onClick={()=>{void refs[0].current}}/>;};',
    expectedCount: 0,
  },
  {
    name: "mutable-result-container",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{let refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "result-element-replacement",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());refs[0]={current:null};useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "result-current-write-with-independent-read",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());refs[0].current=null;useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "empty-receiver",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "sparse-receiver",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[,1].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "spread-receiver",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[...values].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "object-element-receiver",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[{}].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "call-element-receiver",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[produce()].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "null-element-receiver",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[null].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "unknown-local-producer",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const rows=produce();const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "cast-only-array-proof-unsupported",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=(produce() as number[]).map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "custom-deferred-map-with-observation",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const rows={map(callback){globalThis.saved=callback;return []}};const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "mutable-local-array",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{let rows=[1,2];const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "receiver-map-replacement",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const rows=[1,2];rows.map=defer;const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "receiver-dynamic-write",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const rows=[1,2];rows[key]=value;const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "receiver-whole-escape",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const rows=[1,2];consume(rows);const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "receiver-alias-escape",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const rows=[1,2];const alias=rows;const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "receiver-method-extraction",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const rows=[1,2];const mapper=rows.map;const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "async-map-callback",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(async()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "ordinary-function-map-callback",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(function(){return createRef()});useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "single-return-block-map-callback",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>{return createRef()});useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 1,
  },
  {
    name: "computed-map-call",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2]["map"](()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "optional-map-call",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map?.(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "second-map-argument",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef(), null);useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "global-array-prototype-replacement",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{Array.prototype.map=defer;const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "namespace-array-prototype-replacement",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{globalThis.Array.prototype.map=defer;const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "prototype-discovery-replacement",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{Object.getPrototypeOf([]).map=defer;const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "array-constructor-escape",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{consume(Array);const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "unrelated-array-static-call",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{void Array.isArray([]);const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 1,
  },
  {
    name: "ambient-eval-mask",
    code: 'import {createRef,useEffect} from "react";declare const eval:(source:string)=>unknown;export const Example=()=>{eval("Array.prototype.map=defer");const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "erased-inner-receiver-write",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const rows=[1,2];function reset(){interface rows{};rows.map=defer}reset();const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "type-only-import-receiver",
    code: 'import {createRef,useEffect} from "react";import type rows from "./rows";export const Example=()=>{const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "harmless-unrelated-interface",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{interface Label{value:string}const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 1,
  },
  {
    name: "readonly-local-function-event-optional-index",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());const focus=(index:number)=>{void refs[index]?.current?.focus()};return <button onMouseEnter={()=>focus(0)}/>;};',
    expectedCount: 1,
  },
  {
    name: "untyped-observer-index-unsupported",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());const focus=(index)=>{void refs[index].current};return <button onClick={()=>focus(0)}/>;};',
    expectedCount: 0,
  },
  {
    name: "named-observer-binding-reassigned",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());let focus=(index:number)=>{void refs[index].current};focus=ignore;return <button onClick={()=>focus(0)}/>;};',
    expectedCount: 0,
  },
  {
    name: "effect-provider-shadowed",
    code: 'import {createRef} from "react";const useEffect=storeCallback;export const Example=()=>{const refs=[1,2].map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "exported-receiver-unsupported",
    code: 'import {createRef,useEffect} from "react";export const rows=[1,2];export const Example=()=>{const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div ref={refs[0]}/>;};',
    expectedCount: 0,
  },
  {
    name: "namespace-import-is-not-ordinary-array",
    code: 'import {createRef} from "react";import * as rows from "./rows";export const Example=()=>{const refs=rows.map(()=>createRef());return <button onClick={()=>{void refs[0].current}}/>};',
    expectedCount: 0,
  },
  {
    name: "unrendered-native-event-element",
    code: 'import {createRef} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());const unused=<button onClick={()=>{void refs[0].current}}/>;return <div/>};',
    expectedCount: 0,
  },
  {
    name: "unknown-native-event-prop",
    code: 'import {createRef} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());return <button onNotARealEvent={()=>{void refs[0].current}}/>};',
    expectedCount: 0,
  },
  {
    name: "duplicate-native-event-overrides-witness",
    code: 'import {createRef} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());return <button onClick={()=>{void refs[0].current}} onClick={undefined}/>};',
    expectedCount: 0,
  },
  {
    name: "spread-after-native-event-overrides-witness",
    code: 'import {createRef} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());return <button onClick={()=>{void refs[0].current}} {...props}/>};',
    expectedCount: 0,
  },
  {
    name: "spread-before-native-event-conservatively-declines",
    code: 'import {createRef} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());return <button {...props} onClick={()=>{void refs[0].current}}/>};',
    expectedCount: 0,
  },
  {
    name: "unrendered-same-receiver-event-map",
    code: 'import {createRef} from "react";import rows from "./rows";export const Example=()=>{const refs=rows.map(()=>createRef());function focus(index:number){void refs[index].current}const unused=rows.map((_item,index)=><button key={index} onClick={()=>focus(index)}/>);return <div/>};',
    expectedCount: 0,
  },
  {
    name: "opaque-wrapper-does-not-prove-rendered-handler",
    code: 'import {createRef} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());return <Opaque><button onClick={()=>{void refs[0].current}}/></Opaque>};',
    expectedCount: 0,
  },
  {
    name: "unused-event-callback-jsx-inside-same-receiver-map",
    code: 'import {createRef} from "react";import rows from "./rows";export const Example=()=>{const refs=rows.map(()=>createRef());function focus(index:number){void refs[index].current}return <>{rows.map((_item,index)=>{const unused=<button onClick={()=>focus(index)}/>;return <div key={index}/>})}</>};',
    expectedCount: 0,
  },
  {
    name: "readonly-rendered-jsx-local-event",
    code: 'import {createRef} from "react";export const Example=()=>{const refs=[1,2].map(()=>createRef());const button=<button onClick={()=>{void refs[0].current}}/>;return button};',
    expectedCount: 1,
  },
  {
    name: "same-receiver-rendered-map-result-local",
    code: 'import {createRef} from "react";import rows from "./rows";export const Example=()=>{const refs=rows.map(()=>createRef());function focus(index:number){void refs[index]?.current}const buttons=rows.map((_item,index)=><button key={index} onMouseEnter={()=>focus(index)}/>);return <>{buttons}</>};',
    expectedCount: 1,
  },
  {
    name: "single-return-effect-observer",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>{return createRef()});useEffect(()=>{void refs[0]?.current},[refs]);return <div/>;};',
    expectedCount: 1,
  },
  {
    name: "parenthesized-single-return-effect-observer",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>{return (((createRef())))});useEffect(()=>{void refs[0]?.current},[refs]);return <div/>;};',
    expectedCount: 1,
  },
  {
    name: "single-return-extra-expression-deferred",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>{observe();return createRef()});useEffect(()=>{void refs[0]?.current},[refs]);return <div/>;};',
    expectedCount: 0,
  },
  {
    name: "single-return-extra-declaration-deferred",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>{const label="x";return createRef()});useEffect(()=>{void refs[0]?.current},[refs]);return <div/>;};',
    expectedCount: 0,
  },
  {
    name: "conditional-multiple-return-deferred",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>{if(enabled)return createRef();return createRef()});useEffect(()=>{void refs[0]?.current},[refs]);return <div/>;};',
    expectedCount: 0,
  },
  {
    name: "single-return-conditional-expression-deferred",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const refs=[1,2].map(()=>{return enabled ? createRef() : fallbackRef});useEffect(()=>{void refs[0]?.current},[refs]);return <div/>;};',
    expectedCount: 0,
  },
  {
    name: "single-return-custom-map-deferred",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{const rows={map:(callback)=>[callback()]};const refs=rows.map(()=>{return createRef()});useEffect(()=>{void refs[0]?.current},[refs]);return <div/>;};',
    expectedCount: 0,
  },
  {
    name: "single-return-discarded-map-deferred",
    code: 'import {createRef,useEffect} from "react";export const Example=()=>{[1,2].map(()=>{return createRef()});const refs=[];useEffect(()=>{void refs[0]?.current},[refs]);return <div/>;};',
    expectedCount: 0,
  },
];

describe("inline map observed ref allocations", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noCreateRefInFunctionComponent, testCase.code, {
        filename: "synthetic.tsx",
        forceJsx: true,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
    });
  }
});
