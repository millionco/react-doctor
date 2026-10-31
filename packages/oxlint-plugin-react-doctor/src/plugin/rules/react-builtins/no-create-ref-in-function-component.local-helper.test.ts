import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateRefInFunctionComponent } from "./no-create-ref-in-function-component.js";

interface LocalHelperCase {
  name: string;
  code: string;
  filename: string;
  expectedDiagnostics: number;
}

const localHelperCases: LocalHelperCase[] = [
  {
    name: "unqualified-delegating-root-remains-unsupported",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=(label)=> <div ref={makeRef()}>{label}</div>;useEffect(()=>{refs.current[0]?.current?.focus()},[]);return renderItem("item");};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-opaque-branch",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "for-of-caller-remains-deferred",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({labels})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=(label)=> <div ref={makeRef()}>{label}</div>;const nodes=[];for(const label of labels){nodes.push(renderItem(label))}return <>{nodes}</>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "dead-root-literal",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};if(0){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "closed-root-constant",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const active=false;if(active){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "helper-parameter-controls",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const makeRef=(active)=>{if(active){const ref=createRef();consume(ref);return ref}return null};return <div ref={makeRef(false)}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "default-helper-input",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const makeRef=(active=false)=>{const ref=createRef();consume(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "reassigned-helper",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const refs=useRef([]);let makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};makeRef=()=>null;return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "shadowed-helper",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";const makeRef=()=>createRef();export const Panel=()=>{const renderItem=(makeRef)=> <div ref={makeRef()}/>;return renderItem(()=>null);};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "event-only-helper",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};return <button onClick={()=>makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-only-helper",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};useEffect(()=>{makeRef()},[]);return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "module-helper",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";const makeRef=()=>{const ref=createRef();consume(ref);return ref};export const Panel=()=> <div ref={makeRef()}/>;',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "mixed-event-render-escape",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const node=<div ref={makeRef()}/>;return <button onClick={makeRef}>{node}</button>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "helper-alias",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const alias=makeRef;return <div ref={alias()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "helper-cycle",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const makeRef=()=>renderItem();const renderItem=()=>{const ref=createRef();consume(ref);makeRef();return <div ref={ref}/>};return renderItem();};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "helper-lazy-state-initializer",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const [ref]=useState(makeRef);return <div ref={ref}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "helper-eager-state-initializer",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const [ref]=useState(makeRef());return <div ref={ref}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "helper-guarded-persistence",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const holder=useRef(null);const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};if(holder.current===null){holder.current=makeRef()}return <div ref={holder.current}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "write-only-return-caller",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const makeRef=()=>createRef();makeRef().current=null;return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "discard-only",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const makeRef=()=>{createRef()};makeRef();return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "one-shot-test",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";import {render}from"@testing-library/react";it("once",()=>{const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};return <div ref={makeRef()}/>};render(<Panel/>)});',
    filename: "create-ref-render.test.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "namespace-positive",
    code: 'import * as React from "react";export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "namespace-direct-replacement",
    code: 'import * as React from "react";React.createRef=custom;export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "namespace-pattern-replacement",
    code: 'import * as React from "react";({value:React.createRef}=replacement);export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "namespace-loop-replacement",
    code: 'import * as React from "react";for(React.createRef of replacements){}export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "namespace-opaque-escape",
    code: 'import * as React from "react";install(React);export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "type-only-native",
    code: 'import type {createRef}from"react";export const Panel=()=>{const makeRef=()=>{const ref=createRef();consume(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "async-helper",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const makeRef=async()=>{const ref=createRef();consume(ref);return ref};makeRef();return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "namespace-two-helper-root-branches-and-loop",
    code: 'import * as React from "react";import {useRef,useEffect}from"react";interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "primitive-empty-root-guard",
    code: 'import * as React from "react";export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};if(""){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "primitive-negated-root-guard",
    code: 'import * as React from "react";export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};if(!true){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "closed-ref-root-guard",
    code: 'import * as React from "react";export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};const guard=React.useRef(false);if(guard.current){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "same-root-condition-repeated",
    code: 'import * as React from "react";export const Panel=(props)=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};if(props.active&&!props.active){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "same-helper-used-in-initializer-and-render",
    code: 'import * as React from "react";export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};React.useState(makeRef());return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "different-shadowed-function-names",
    code: 'import {createRef,useRef}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};const renderItem=()=>{const makeRef=()=>null;return <div ref={makeRef()}/>};return renderItem();};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "named-import-rename",
    code: 'import {createRef as newRef,useRef}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=newRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "namespace-reflect-provider-write",
    code: 'import * as React from"react";Reflect.set(React,"createRef",custom);export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "namespace-provider-write-default-pattern",
    code: 'import * as React from"react";({value:React.createRef=custom}=replacement);export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "no-caller-helper",
    code: 'import * as React from "react";export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "return-only-ref-helper",
    code: 'import {createRef}from"react";export const Panel=()=>{const makeRef=()=>createRef();return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "wrong-canonical-module",
    code: 'import * as React from"preact/compat";export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "namespace-metadata-write",
    code: 'import * as React from"react";React.displayName="runtime";export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "default-rhs-reference-read",
    code: 'import * as React from"react";const {value=React.createRef}=options;export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "computed-member-key-reference-read-deferred",
    code: 'import * as React from"react";const holder={};holder[React.createRef]=1;export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "property-computed-key-reference-read",
    code: 'import * as React from"react";const holder={[React.createRef]:1};export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "nested-root-contradictory-guards",
    code: 'import * as React from"react";export const Panel=(props)=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};if(props.active){if(!props.active){makeRef()}}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-closed-zero-loop",
    code: 'import * as React from"react";export const Panel=(props)=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};for(let index=0;index<0;index++){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-inner-loop-condition-deferred",
    code: 'import * as React from"react";export const Panel=(props)=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};for(const label of props.labels){if(!props.labels.length){makeRef()}}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "mutable-allocation-binding-deferred",
    code: 'import {createRef}from"react";export const Panel=()=>{const makeRef=()=>{let ref=createRef();ref=external;consume(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "type-only-namespace-deferred",
    code: 'import type * as React from"react";export const Panel=()=>{const makeRef=()=>{const ref=React.createRef();consume(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "typed-namespace-component-and-ref",
    code: 'import * as React from"react";interface PanelProps{label:string}export const Panel:React.FC<PanelProps>=(props)=>{const refs=React.useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};return <div ref={makeRef()}>{props.label}</div>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "as-expression-runtime-provider-escape",
    code: 'import * as React from "react";install(React as unknown);export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "satisfies-expression-runtime-provider-escape",
    code: 'import * as React from "react";install(React satisfies object);export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "non-null-runtime-provider-alias",
    code: 'import * as React from "react";const provider=React!;export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "as-expression-runtime-provider-write",
    code: 'import * as React from "react";(React as typeof React).createRef=custom;export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "named-api-type-position",
    code: 'import {createRef,useRef}from"react";interface Creator{callback:typeof createRef}export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "default-provider-import",
    code: 'import React from "react";export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "named-default-provider-import",
    code: 'import {default as React} from "react";export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "qualified-root-direct-helper-chain",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=(label)=> <div ref={makeRef()}>{label}</div>;useEffect(()=>{refs.current[0]?.current?.focus()},[]);return <section>{renderItem("item")}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "unsupported-arithmetic-predicate",
    code: 'import * as React from"react";export const Panel=(props)=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};if(props.active*0){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "helper-labelled-exit",
    code: 'import {createRef,useRef}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{done:{break done;const ref=createRef();refs.current.push(ref)}return null};makeRef();return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "namespace-sibling-callable-provider-write",
    code: 'import React from"react";const stable={current:null};React.change=function(){this.createRef=()=>stable};React.change();export const Panel=()=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};return <div ref={makeRef()}/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "regex-comparison-literal-deferred",
    code: 'import * as React from"react";export const Panel=(props)=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};if(props.value===/item/){makeRef()} return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "bigint-comparison-literal-deferred",
    code: 'import * as React from"react";export const Panel=(props)=>{const refs=React.useRef([]);const makeRef=()=>{const ref=React.createRef();refs.current.push(ref);return ref};if(props.value===1n){makeRef()} return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-property-write-deferred",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};props.active=false;if(props.active){makeRef()} return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-produced-member-write-deferred",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};const rows=props.getRows();rows.length=0;if(rows.length){makeRef()} return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-pattern-target-write-deferred",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};({value:props.active}=replacement);if(props.active){makeRef()} return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-loop-target-write-deferred",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};for(props.active of options){}if(props.active){makeRef()} return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-pattern-default-rhs-read",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};const {value=props.active}=options;if(props.active){makeRef()} return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-computed-key-read",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};const holder={};holder[props.active]=1;if(props.active){makeRef()} return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "deferred-class-in-helper",
    code: 'import {createRef}from"react";export const Panel=()=>{const makeRef=()=>{class Holder{ref=consume(createRef());}return null;};makeRef();return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "deferred-class-root-caller",
    code: 'import {createRef,useRef}from"react";export const Panel=()=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};class Holder{ref=makeRef();}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-input-alias-write-deferred",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};const alias=props;alias.active=false;if(props.active){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "produced-input-alias-write-deferred",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};const rows=props.getRows();const alias=rows;alias.length=0;if(rows.length){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "produced-input-origin-write-deferred",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};props.getRows=()=>[];const rows=props.getRows();if(rows.length){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-sequential-guard-return-deferred",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};if(props.active)return null;if(props.active){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-own-throw-deferred",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};if(props.active)throw failure;if(props.active){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-input-opaque-escape-deferred",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};install(props);if(props.active){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-member-alias-write-deferred",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};const alias=props.options;alias.active=false;if(props.options.active){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "root-default-member-alias-write-deferred",
    code: 'import {createRef,useRef}from"react";export const Panel=(props)=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref};const options={};const {value=props.options}=options;value.active=false;if(props.options.active){makeRef()}return <div/>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-dependency-canonical-named-effect-direct-dependency",
    code: 'import * as React from "react";import {useRef,useEffect}from"react";interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "effect-dependency-readonly-renamed-effect-import",
    code: 'import * as React from "react";import {useRef,useEffect as watch}from"react";interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}watch(()=>{refs.current[0]?.current?.focus()},[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "effect-dependency-ordinary-captured-array",
    code: 'import * as React from "react";import {useRef,useEffect}from"react";interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const dependencyValues=[props.source];const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-dependency-foreign-effect-provider",
    code: 'import * as React from "react";import {useRef}from"react";import{useEffect}from"other-effect-provider";interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-dependency-shadowed-local-effect",
    code: 'import * as React from "react";import {useRef}from"react";const useEffect=(callback,dependencies)=>consume(callback,dependencies);interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-dependency-type-only-effect-import",
    code: 'import * as React from "react";import {useRef}from"react";import type{useEffect}from"react";interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-dependency-effect-binding-reassignment",
    code: 'import * as React from "react";import {useRef,useEffect}from"react";interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;useEffect=replacement;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-dependency-namespace-effect-provider-replacement",
    code: 'import * as React from "react";import {useRef,useEffect}from"react";React.useEffect=replacement;interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-dependency-namespace-effect-scalar-replacement",
    code: 'import * as React from "react";import {useRef,useEffect}from"react";React.useEffect=null;interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-dependency-namespace-effect-pattern-write",
    code: 'import * as React from "react";import {useRef,useEffect}from"react";({effect:React.useEffect}=replacement);interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-dependency-namespace-effect-loop-write",
    code: 'import * as React from "react";import {useRef,useEffect}from"react";for(React.useEffect of replacements){}interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-dependency-namespace-callee-firstscope-deferred",
    code: 'import * as React from "react";import {useRef,useEffect}from"react";interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}React.useEffect(()=>{refs.current[0]?.current?.focus()},[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-dependency-direct-effect-extra-argument",
    code: 'import * as React from "react";import {useRef,useEffect}from"react";interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[props.source],extra);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
  {
    name: "effect-dependency-unrelated-scalar-provider-metadata",
    code: 'import * as React from "react";import {useRef,useEffect}from"react";React.displayName="runtime";interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(()=>{refs.current[0]?.current?.focus()},[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 1,
  },
  {
    name: "effect-dependency-first-argument-spread-deferred",
    code: 'import * as React from "react";import {useRef,useEffect}from"react";interface SlotProps{source:{read:()=>string[]}}export const Panel:React.FC<SlotProps>=(props)=>{const refs=useRef<React.RefObject<HTMLDivElement>[]>([]);const makeRef=()=>{const ref=React.createRef<HTMLDivElement>();refs.current.push(ref);return ref};const renderItem=(label:string,extra:string|null,id:string|number)=><div key={`item-${id}`} ref={makeRef()} data-extra={extra}>{label}</div>;const items=props.source.read();const nodes=[];if(items.length===2){nodes.push(renderItem("first",null,"first"))}else{for(let index=0;index<items.length-1;index++){nodes.push(renderItem("item",null,index))}}useEffect(...callbacks,[props.source]);return <section>{nodes}</section>;};',
    filename: "create-ref-render.tsx",
    expectedDiagnostics: 0,
  },
];

describe("local direct render helpers", () => {
  for (const testCase of localHelperCases) {
    it(testCase.name, () => {
      const result = runRule(noCreateRefInFunctionComponent, testCase.code, {
        filename: testCase.filename,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedDiagnostics);
    });
  }
});
