import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
interface ImperativeCommandScenario {
  name: string;
  source: string;
  expected: number;
}
const scenarios: ImperativeCommandScenario[] = [
  {
    name: "direct pure setter retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);useEffect(()=>{writeCount(value)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "pure helper retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);function update(next){writeCount(next)}useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "pure callback helper retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const update=useCallback((next)=>{writeCount(next)},[]);useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "adjacent ref after direct setter",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "adjacent ref before direct setter",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{current.current=value;writeCount(value)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "adjacent ref after function declaration setter",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);function update(next){writeCount(next);current.current=next}useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "adjacent ref before function declaration setter",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);function update(next){current.current=next;writeCount(next)}useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "adjacent ref const arrow helper",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);const update=(next)=>{writeCount(next);current.current=next};useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "adjacent ref anonymous const helper",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);const update=function(next){writeCount(next);current.current=next};useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "adjacent ref native callback helper",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);const update=useCallback((next)=>{writeCount(next);current.current=next},[]);useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "caller adjacent ref before exact helper",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);const update=useCallback((next)=>{writeCount(next)},[]);useEffect(()=>{current.current=true;update(value)},[value,update]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "caller adjacent ref after exact helper",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);function update(next){writeCount(next)}useEffect(()=>{update(value);current.current=true},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "one shot caller guard command",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(false);const update=useCallback((next)=>{writeCount(next);requestAnimationFrame(()=>{})},[]);useEffect(()=>{if(value!==undefined&&!current.current){current.current=true;update(value)}},[value,update]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "namespace React provider",
    source:
      'import * as React from "react";import {useState} from "react";export const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=React.useRef(count);function update(next){writeCount(next);current.current=next}React.useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "default React provider",
    source:
      'import React,{useState} from "react";export const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=React.useRef(count);function update(next){writeCount(next);current.current=next}React.useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "named ref import alias",
    source:
      'import {useEffect,useState,useRef as keepRef} from "react";export const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=keepRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "type only ref exposure ignored",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);type Cell=typeof current;useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "namespace static Children call does not escape provider",
    source:
      'import * as React from "react";import {useState} from "react";export const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=React.useRef(count);React.Children.toArray([]);function update(next){writeCount(next);current.current=next}React.useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "conditional same block adjacency",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{if(enabled){writeCount(value);current.current=value}},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "statement gap retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);void 0;current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "declaration gap retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);const marker=0;current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "different blocks retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);if(enabled){current.current=value}},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "wrong helper frame retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);function decorate(next){current.current=next}function update(next){writeCount(next)}useEffect(()=>{decorate(value);update(value)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "uninvoked nested ref body retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{const later=()=>{current.current=value};writeCount(value)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "optional helper invocation unsupported",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);function update(next){writeCount(next);current.current=next}useEffect(()=>{update?.(value)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "optional setter unsupported",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount?.(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "spread helper arguments unsupported",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);function update(next){writeCount(next);current.current=next}useEffect(()=>{update(...[value])},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "multiple helper calls unsupported",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);function update(next){writeCount(next);current.current=next}useEffect(()=>{update(value);update(other)},[value,other]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "deferred callback not newly quieted",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{setTimeout(()=>{writeCount(value);current.current=value},0)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "ref binding reassigned retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);let current=useRef(count);current=other;useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "ref object escape retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);consume(current);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "ref readonly alias transport retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);const alias=current;useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "ref object spread retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);const snapshot={...current};useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "ref destructure retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);const {current:previous}=current;useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "computed ref assignment retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current["current"]=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "optional ref read retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);consume(current?.current);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "wrong property retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.other=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "ref compound write retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current+=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "ref update retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current++},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "fake local ref provider retained",
    source:
      'import {useState,useEffect} from "react";const useRef=(value)=>({current:value});export const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "type only ref provider retained",
    source:
      'import type {useRef} from "react";import {useState,useEffect} from "react";export const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "foreign ref provider retained",
    source:
      'import {useRef} from "other-hooks";import {useState,useEffect} from "react";export const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "namespace provider replacement retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nimport * as React from "react";React.useRef=()=>({current:0});export const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "namespace provider escape retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nimport * as React from "react";consume(React);export const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "named hook escape retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);const hook=useRef;useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "visible reflection unsupported",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);Object.assign({},{});useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "dynamic React provider unsupported",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);const provider=require("react");useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "shadowed reflection is ordinary local data",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nconst Object={assign:()=>{}};export const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);Object.assign();useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "reassigned helper retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);let update=(next)=>{writeCount(next);current.current=next};update=(next)=>{writeCount(next)};useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "aliased helper unsupported",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);function update(next){writeCount(next);current.current=next}const command=update;useEffect(()=>{command(value)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "parameter default helper unsupported",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);function update(next=0){writeCount(value);current.current=value}useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "named function expression unsupported",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);const update=function command(next){writeCount(next);current.current=next};useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "try frame unsupported",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{try{writeCount(value);current.current=value}finally{}},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "loop frame unsupported",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{for(const marker of [1]){writeCount(value);current.current=value}},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "opaque call alone is not proof",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nexport const Example=({value,other,enabled})=>{const [count,writeCount]=useState(0);useEffect(()=>{unknownOperation();writeCount(value)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "wrong lexical ref owner retained",
    source:
      'import {useEffect,useRef,useState,useCallback} from "react";\nconst current=useRef(0);export const Example=({value})=>{const [count,writeCount]=useState(0);useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "self current assignment retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=current.current},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "parenthesized self current retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=(current.current)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "TS asserted self current retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=(current.current as number)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "readonly self snapshot retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);const snapshot=current.current;useEffect(()=>{writeCount(value);current.current=snapshot},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "readonly self snapshot alias chain retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);const snapshot=current.current;const alias=snapshot;useEffect(()=>{writeCount(value);current.current=alias},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "sequence input unsupported",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=(0,value)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "conditional input unsupported",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value?value:0},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "member input unsupported",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=value.current},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "call result input unsupported",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);const readValue=()=>value;useEffect(()=>{writeCount(value);current.current=readValue()},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "const literal input alias unsupported",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);const constant=1;useEffect(()=>{writeCount(value);current.current=constant},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "mutable parameter input retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);value=1;useEffect(()=>{writeCount(value);current.current=value},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "readonly parameter alias accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);const alias=value;useEffect(()=>{writeCount(value);current.current=alias},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "readonly parameter alias chain accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);const alias=value;const nextAlias=alias;useEffect(()=>{writeCount(value);current.current=nextAlias},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "written intermediate const alias retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);const alias=value;const nextAlias=alias;alias=1;useEffect(()=>{writeCount(value);current.current=nextAlias},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "primitive string write accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current="ready"},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "primitive null write accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=null},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "primitive boolean write accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=true},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "primitive number write accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=1},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "regex object input unsupported",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=/value/},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "unrelated enclosing input unsupported",
    source:
      'import {useEffect,useRef,useState} from "react";export const wrap=(outerValue)=>{const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(count);useEffect(()=>{writeCount(value);current.current=outerValue},[value]);return <output>{count}</output>};return Example}',
    expected: 1,
  },
  {
    name: "closed same numeric initializer retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(0);useEffect(()=>{writeCount(value);current.current=0},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "closed same false initializer retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(false);useEffect(()=>{writeCount(value);current.current=false},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "closed false to true literal accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(false);useEffect(()=>{writeCount(value);current.current=true},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "closed same string initializer retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef("ready");useEffect(()=>{writeCount(value);current.current="ready"},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "closed changed string literal accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef("");useEffect(()=>{writeCount(value);current.current="ready"},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "closed same null initializer retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(null);useEffect(()=>{writeCount(value);current.current=null},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "closed numeric to null literal accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(0);useEffect(()=>{writeCount(value);current.current=null},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "transparent same initializer retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef((0 as number));useEffect(()=>{writeCount(value);current.current=(0 as number)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "readonly literal initializer alias retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const initial=0;const current=useRef(initial);useEffect(()=>{writeCount(value);current.current=0},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "readonly literal initializer alias chain retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const initial=0;const alias=initial;const current=useRef(alias);useEffect(()=>{writeCount(value);current.current=0},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "helper actual ref snapshot retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(0);function update(next){writeCount(value);current.current=next}useEffect(()=>{update(current.current)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "helper actual readonly snapshot alias retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(0);const snapshot=current.current;function update(next){writeCount(value);current.current=next}useEffect(()=>{update(snapshot)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "helper actual same literal retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(0);function update(next){writeCount(value);current.current=next}useEffect(()=>{update(0)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "helper actual changed literal accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(0);function update(next){writeCount(value);current.current=next}useEffect(()=>{update(1)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "helper actual same boolean retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(false);function update(next){writeCount(value);current.current=next}useEffect(()=>{update(false)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "helper actual changed boolean accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(false);function update(next){writeCount(value);current.current=next}useEffect(()=>{update(true)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "helper actual same string retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef("ready");function update(next){writeCount(value);current.current=next}useEffect(()=>{update("ready")},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "helper actual same null retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(null);function update(next){writeCount(value);current.current=next}useEffect(()=>{update(null)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "helper actual owner input accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(0);function update(next){writeCount(value);current.current=next}useEffect(()=>{update(value)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "helper actual readonly owner input alias accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const alias=value;const current=useRef(0);function update(next){writeCount(value);current.current=next}useEffect(()=>{update(alias)},[value]);return <output>{count}</output>};',
    expected: 0,
  },
  {
    name: "helper actual member input unsupported",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(0);function update(next){writeCount(value);current.current=next}useEffect(()=>{update(value.current)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "helper actual conditional input unsupported",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const current=useRef(0);function update(next){writeCount(value);current.current=next}useEffect(()=>{update(value?1:0)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "helper actual call result unsupported",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const readValue=()=>value;const current=useRef(0);function update(next){writeCount(value);current.current=next}useEffect(()=>{update(readValue())},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "helper actual literal alias unsupported",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const [count,writeCount]=useState(0);const literal=1;const current=useRef(0);function update(next){writeCount(value);current.current=next}useEffect(()=>{update(literal)},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "closed same bigint initializer retained",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const[count,setCount]=useState(0);const current=useRef(0n);useEffect(()=>{setCount(value);current.current=0n},[value]);return <output>{count}</output>};',
    expected: 1,
  },
  {
    name: "closed changed bigint literal accepted",
    source:
      'import {useEffect,useRef,useState} from "react";export const Example=({value})=>{const[count,setCount]=useState(0);const current=useRef(0n);useEffect(()=>{setCount(value);current.current=1n},[value]);return <output>{count}</output>};',
    expected: 0,
  },
];
describe("no-derived-state-effect adjacent native ref commands", () => {
  it.each(scenarios)("$name", ({ source, expected }) => {
    const result = runRule(noDerivedStateEffect, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
