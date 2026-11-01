import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferUseEffectEvent } from "./prefer-use-effect-event.js";

interface MemoGraphCase {
  readonly name: string;
  readonly code: string;
  readonly expected: number;
}

const cases: ReadonlyArray<MemoGraphCase> = [
  {
    name: "direct empty callback already quiet",
    code: 'import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const callback = useCallback(() => "ready", []); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 0,
  },
  {
    name: "two hop empty memo chain",
    code: 'import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 0,
  },
  {
    name: "three hop empty memo chain",
    code: 'import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const middle = useCallback(() => leaf(), [leaf]); const callback = useCallback(() => middle(), [middle]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 0,
  },
  {
    name: "two independent memo chains",
    code: 'import { useCallback, useEffect } from "react"; export const Example = ({ active }) => { const firstLeaf = useCallback(() => "first", []); const first = useCallback(() => firstLeaf(), [firstLeaf]); const secondLeaf = useCallback(() => "second", []); const second = useCallback(() => secondLeaf(), [secondLeaf]); useEffect(() => { const timer = setTimeout(() => { first(); second(); }, 0); return () => clearTimeout(timer); }, [active, first, second]); return null; };',
    expected: 0,
  },
  {
    name: "changing prop dependency",
    code: 'import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const callback = useCallback(() => value, [value]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "memo chain with changing leaf",
    code: 'import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => value, [value]); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "omitted dependency array",
    code: 'import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const callback = useCallback(() => "ready"); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "dynamic dependency array",
    code: 'import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const dependencies = value; const callback = useCallback(() => "ready", dependencies); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "mutable leaf binding",
    code: 'import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { let leaf = useCallback(() => "ready", []); leaf = value; const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "foreign hook leaf",
    code: 'import { useCallback, useEffect } from "react"; import { useCallback as otherCallback } from "other-library"; export const Example = ({ active, value }) => { const leaf = otherCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "direct effect body call already excluded",
    code: 'import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { callback(); }, [callback, active]); return null; };',
    expected: 0,
  },
  {
    name: "reactive body capture omitted at leaf",
    code: 'import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => value, []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "selected callback missing reactive capture",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf()+value,[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "nested missing reactive capture",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>{const nested=()=>value;return leaf()+nested()},[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "cycle between memo bindings",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>callback(),[callback]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "mutable selected callback",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); let callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "reassigned selected callback",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); callback=()=>2; useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "mutable leaf without write",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ let leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "memo aliases unsupported",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const alias=leaf; const callback=useCallback(()=>alias(),[alias]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "dependency hole",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[,leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "spread dependency",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[...[] ,leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "member dependency",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[holder.leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "optional memo call",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback?.(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "extra memo argument",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf],1); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "generator memo callback",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(function*(){yield leaf()},[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "async memo callback",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(async()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "unknown callback factory",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(makeCallback(leaf),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "cross component memo origin",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=foreignMemo; const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "module scoped captured function",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; const readGlobal=()=>1; export const Example=({delay,value})=>{ const leaf=useCallback(()=>readGlobal(),[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "local literal producer dependency",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=1; const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "memo provider import alias positive",
    code: 'import {useCallback as useMemoized,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useMemoized(()=>1,[]); const callback=useMemoized(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "native namespace memo provider positive",
    code: 'import * as React from "react"; export const Example=({delay,value})=>{ const leaf=React.useCallback(()=>1,[]); const callback=React.useCallback(()=>leaf(),[leaf]); React.useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "native default type usage positive",
    code: 'import React from "react"; type Component=React.FC; import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "shadowed memo provider",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const useCallback=(callback)=>callback; const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "type only memo provider",
    code: 'import {type useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "foreign memo provider",
    code: 'import {useEffect} from "react"; import {useCallback} from "other"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "provider runtime argument escape",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; unknown(useCallback); export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "namespace provider mutation",
    code: 'import * as React from "react"; React.useCallback=replace; import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "default provider escape",
    code: 'import React from "react"; unknown(React); import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "global reflection exposure",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; Reflect.set(unknown,"useCallback",replace); export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "global eval exposure",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; eval("replacement"); export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "constructor carrier exposure",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; const compile=(()=>{}).constructor; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "prototype carrier exposure",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; const prototype=unknown.__proto__; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "callback argument escape",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); unknown(callback); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "callback JSX transport",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return <button onClick={callback}/>;};',
    expected: 1,
  },
  {
    name: "callback another effect",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);useEffect(()=>{setTimeout(()=>callback(),delay)},[delay,callback]);return null;};',
    expected: 2,
  },
  {
    name: "callback property access",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); callback.displayName;useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "callback alias transport",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); const alias=callback;useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "leaf argument escape",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); unknown(leaf);useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "leaf outside graph direct use",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); leaf();useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "leaf member write",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); leaf.extra=1;useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "selected optional invocation",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback?.(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "selected spread invocation",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(...[]),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "leaf optional invocation",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf?.(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "leaf spread invocation",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(...[]),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "leaf call invocation",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf.call(null),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "unused additional reactive dependency",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf,value]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "readonly const alias of a memo node",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const alias=leaf;const callback=useCallback(()=>alias(),[alias]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "stable setter terminus",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const [,leaf]=useState(0); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "stable ref terminus",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useRef(0); const callback=useCallback(()=>leaf.current,[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "stable hook plus memo edge",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const [,writeValue]=useState(0);const callback=useCallback(()=>{writeValue(leaf())},[leaf,writeValue]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "closed nested function own locals",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>{const nested=(entry)=>leaf()+entry;return nested(1)},[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "transparent memo call and callback",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=(useCallback((()=>leaf()),[leaf]) as ()=>number); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "own parameter callback",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback((entry=1)=>leaf()+entry,[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "use layout effect owner",
    code: 'import {useCallback,useLayoutEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const leaf=useCallback(()=>1,[]); const callback=useCallback(()=>leaf(),[leaf]); useLayoutEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "fake stable setter terminus",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const [,leaf]=fakeState(0); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "shadowed stable hook provider",
    code: 'import {useCallback,useEffect,useState,useRef} from "react"; export const Example=({delay,value})=>{ const useState=(entry)=>[entry,()=>{}];const [,leaf]=useState(0); const callback=useCallback(()=>leaf(),[leaf]); useEffect(()=>{const id=setTimeout(()=>callback(),delay);return()=>clearTimeout(id)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "local fake leaf under native memo stays warned",
    code: 'import {useCallback as nativeMemo,useEffect} from "react";const useCallback=(callback)=>callback;export const Example=({delay})=>{const leaf=useCallback(()=>1,[]);const callback=nativeMemo(()=>leaf(),[leaf]);useEffect(()=>{setTimeout(()=>callback(),delay)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "type only namespace carrier does not block",
    code: 'import type * as ReactTypes from "react";import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 0,
  },
  {
    name: "selected callback capture writes stay warned",
    code: 'import {useCallback,useEffect} from "react";export const Example=({delay,value})=>{const leaf=useCallback(()=>1,[]);const callback=useCallback(()=>{value++;return leaf()},[leaf]);useEffect(()=>{setTimeout(()=>callback(),delay)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "raw state value leaf stays warned",
    code: 'import {useCallback,useEffect,useState} from "react";export const Example=({delay})=>{const [value]=useState(0);const callback=useCallback(()=>value,[value]);useEffect(()=>{setTimeout(()=>callback(),delay)},[delay,callback]);return null;};',
    expected: 1,
  },
  {
    name: "memo captures shadowing own parameter safely",
    code: 'import {useCallback,useEffect} from "react";export const Example=({delay,value})=>{const leaf=useCallback((value)=>value,[]);const callback=useCallback(()=>leaf(1),[leaf]);useEffect(()=>{setTimeout(()=>callback(),delay)},[delay,callback]);return null;};',
    expected: 0,
  },
  {
    name: "actual shaped two branches with independent memo roots",
    code: 'import React,{useCallback,useEffect} from "react";interface Props {active:boolean} export const Example:React.FC<Props>=({active})=>{const first=useCallback((entry:number)=>Math.floor(entry),[]);const middle=useCallback((entry:number)=>first(entry),[first]);const callback=useCallback((entry:number)=>middle(entry),[middle]);const second=useCallback((entry:number)=>Math.ceil(entry),[]);const other=useCallback((entry:number)=>second(entry),[second]);useEffect(()=>{if(!active)return;let handle=0;const frame=()=>{callback(1);other(2);handle=requestAnimationFrame(frame)};handle=requestAnimationFrame(frame);return()=>cancelAnimationFrame(handle)},[active,callback,other]);return null;};',
    expected: 0,
  },
];

describe("prefer-use-effect-event — closed local memo graphs", () => {
  for (const fixture of cases) {
    it(fixture.name, () => {
      const result = runRule(preferUseEffectEvent, fixture.code, {
        filename: "fixture.tsx",
        forceJsx: true,
        settings: { "react-doctor": { capabilities: ["react", "react:19", "react:19.2"] } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(fixture.expected);
    });
  }
});
