import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noStaleTimerRef } from "./no-stale-timer-ref.js";

interface TimerToggleCase {
  readonly name: string;
  readonly source: string;
  readonly count: number;
}

const cases: readonly TimerToggleCase[] = [
  {
    name: "bare toggle",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "closed true readiness",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=useRef(true);const toggle=()=>{if(timer.current || !ready.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "closed false readiness",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=useRef(false);const toggle=()=>{if(timer.current || !ready.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "closed nested true",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=useRef({enabled:{value:true}});const toggle=()=>{if(timer.current || !ready.current.enabled.value){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "closed nested false",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=useRef({enabled:{value:false}});const toggle=()=>{if(timer.current || !ready.current.enabled.value){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "readonly scalar true",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=true;const toggle=()=>{if(timer.current || !ready){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "readonly scalar false",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=false;const toggle=()=>{if(timer.current || !ready){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "getter is unsupported",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=useRef({get value(){return false;}});const toggle=()=>{if(timer.current || !ready.current.value){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "computed constant gate",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=useRef({value:true});const toggle=()=>{if(timer.current || !ready.current[\'value\']){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "unknown computed gate",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const key=\'value\';const ready=useRef({value:true});const toggle=()=>{if(timer.current || !ready.current[key]){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "correlated predicate",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current || !flag || flag){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "called readiness",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current || !readReady()){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "readonly local unknown",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=readReady();const toggle=()=>{if(timer.current || !ready){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "default React namespace",
    source:
      'import React from "react";export const Panel=({tick,flag})=>{const timer=React.useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "import alias",
    source:
      'import {useRef as reference} from "react";export const Panel=({tick,flag})=>{const timer=reference(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "transparent current wrappers",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if((timer.current as unknown)){clearInterval((timer.current!));return;}timer.current=(setInterval(()=>tick(),20) as unknown as number);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "undefined initializer",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef();const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "native global namespace calls",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){window.clearInterval(timer.current);return;}timer.current=globalThis.setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "empty and literal void noops",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{;void 0;if(timer.current){;clearInterval(timer.current);void 0;return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "reset before return",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);timer.current=null;return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "straight line rearm",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{clearInterval(timer.current);timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "terminating finally reset",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){try{clearInterval(timer.current);return;}finally{timer.current=null;}}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "side effect prefix",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{prepare();if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "effectful void prefix",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{void prepare();if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "unconditional throw before scheduling",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}throw Error(\'stopped\');timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "extra conditional branch",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}if(flag)timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "unused handler",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button >{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "constant dead event",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={false?toggle:undefined}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "raw callback handoff",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};handOff(toggle);return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "saved JSX shell",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};const element=<button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;return element;};',
    count: 0,
  },
  {
    name: "local event component",
    source:
      'import {useRef} from "react";const Local=props=><button {...props}/>;export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <Local onClick={toggle}>{timer.current?"Stop":"Start"}</Local>;};',
    count: 0,
  },
  {
    name: "whole timer ref alias",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const alias=timer;const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "whole timer ref escape",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);configure(timer);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "additional timer writer",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const reset=()=>{timer.current=null;};const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "timer current accessor",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);Object.defineProperty(timer,\'current\',{get(){return null;}});const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "shadowed scheduler and clear",
    source:
      'import {useRef} from "react";export const Panel=({tick,setInterval,clearInterval})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "scheduler replacement",
    source:
      'import {useRef} from "react";globalThis.setInterval=()=>0;export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "clear method extracted",
    source:
      'import {useRef} from "react";const cancel=window.clearInterval;export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "reflective scheduler replacement",
    source:
      'import {useRef} from "react";Object.defineProperty(window,"setInterval",{value:()=>0});export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "React hook replacement",
    source:
      'import React from "react";React.useRef=()=>({current:null});export const Panel=({tick,flag})=>{const timer=React.useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "invalid scheduling callback",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(null,20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "coercive delay",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),{valueOf(){return 20;}});};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "async event unsupported",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=async()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "opaque ref recipient is explicit MAY input",
    source:
      'import {useRef} from "react";import {Widget} from "widgets";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=useRef(null);const toggle=()=>{if(timer.current || !ready.current?.value){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <><Widget ref={ready}/><button onClick={toggle}>{timer.current?"Stop":"Start"}</button></>;};',
    count: 1,
  },
  {
    name: "local false ref provider is unsupported",
    source:
      'import {useRef} from "react";const Widget=({ref})=>{ref.current={value:false};return <div/>;};export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=useRef(null);const toggle=()=>{if(timer.current || !ready.current?.value){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <><Widget ref={ready}/><button onClick={toggle}>{timer.current?"Stop":"Start"}</button></>;};',
    count: 0,
  },
  {
    name: "known false ordinary member gate",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=useRef({value:false});const toggle=()=>{if(timer.current || !ready.current.value){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "context publication alone is not a writer",
    source:
      'import {useRef} from "react";import {Context} from "contexts";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=useRef(null);const toggle=()=>{if(timer.current || !ready.current?.value){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <Context.Provider value={{ref:ready}}><button onClick={toggle}>{timer.current?"Stop":"Start"}</button></Context.Provider>;};',
    count: 0,
  },
  {
    name: "nested custom event property data",
    source:
      'import {useRef} from "react";import {Controls,Button} from "controls";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <Controls items={[{children:<Button onClick={toggle}>{timer.current?"Stop":"Start"}</Button>}]}/>;};',
    count: 1,
  },
  {
    name: "historical dead selected clear with independent producer",
    source:
      'import {useEffect,useRef} from "react"; export const TimerPanel=({tick})=>{const timerRef=useRef(null);const gateRef=useRef(false);useEffect(()=>{timerRef.current=setInterval(tick,20);return()=>clearInterval(timerRef.current);},[tick]);const onClick=()=>{if(gateRef.current){clearInterval(timerRef.current);return;}timerRef.current=null;};return <button onClick={onClick} data-pending={timerRef.current ? "yes":"no"}>Stop</button>;};',
    count: 0,
  },
  {
    name: "historical closed false ref blocks only producer",
    source:
      'import {useRef} from "react"; export const TimerPanel=({tick})=>{const timerRef=useRef(null);const gateRef=useRef(false);const onClick=()=>{if(timerRef.current || !gateRef.current){clearInterval(timerRef.current);return;}timerRef.current=setInterval(tick,20);};return <button onClick={onClick} data-pending={timerRef.current ? "yes":"no"}>Toggle</button>;};',
    count: 0,
  },
  {
    name: "readonly captured parameter MAY gate",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current || !flag){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "timer ref destructuring is unsupported",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const {current:stored}=timer;const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "native timer function alias escapes",
    source:
      'import {useRef} from "react";const schedulingFunction=setInterval;export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "global timer namespace escapes",
    source:
      'import {useRef} from "react";configure(window);export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "explicit dynamic code is unsupported",
    source:
      'import {useRef} from "react";Function(\'return 1\')();export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "dynamic module source is unsupported",
    source:
      'import {useRef} from "react";const loading=import(\'node:\'+\'vm\');export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "B1-readiness-logical-alias",
    source:
      'import {useRef} from "react";export const Panel=()=>{const ready=useRef({enabled:true});const snapshot=ready.current||{};snapshot.enabled=false;const timer=useRef(null);const toggle=()=>{if(timer.current||!ready.current.enabled){clearInterval(timer.current);return;}timer.current=setInterval(()=>{},20);};return <button onClick={toggle}/>;};',
    count: 0,
  },
  {
    name: "B2-event-overwritten-by-spread",
    source:
      'import {useRef} from "react";export const Panel=()=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>{},20);};return <button onClick={toggle} {...{onClick:()=>{}}}/>;};',
    count: 0,
  },
  {
    name: "B2-readiness-ref-overwritten-by-spread",
    source:
      'import {useRef} from "react";import {Widget} from "widgets";export const Panel=()=>{const ready=useRef(null);const timer=useRef(null);const toggle=()=>{if(timer.current||!ready.current?.value){clearInterval(timer.current);return;}timer.current=setInterval(()=>{},20);};return <><Widget ref={ready} {...{ref:null}}/><button onClick={toggle}/></>;};',
    count: 0,
  },
  {
    name: "B3-browser-defaultview-timer-replacement",
    source:
      'import {useRef} from "react";document.defaultView.setInterval=()=>0;export const Panel=()=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>{},20);};return <button onClick={toggle}/>;};',
    count: 0,
  },
  {
    name: "B3-erased-protected-global-function",
    source:
      'import {useRef} from "react";declare const Function:any;Function("globalThis.setInterval=()=>0")();export const Panel=()=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>{},20);};return <button onClick={toggle}/>;};',
    count: 0,
  },
  {
    name: "B4-render-readiness-correlation",
    source:
      'import {useRef} from "react";export const Panel=({flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current||!flag){clearInterval(timer.current);return;}timer.current=setInterval(()=>{},20);};return flag?null:<button onClick={toggle}/>;};',
    count: 0,
  },
  {
    name: "duplicate event attribute",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle} onClick={()=>{}}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "duplicate ref attribute",
    source:
      'import {useRef} from "react";import {Widget} from "widgets";export const Panel=({tick,flag})=>{const timer=useRef(null);const ready=useRef(null);const toggle=()=>{if(timer.current || !ready.current?.value){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <><Widget ref={ready} ref={null}/><button onClick={toggle}>{timer.current?"Stop":"Start"}</button></>;};',
    count: 0,
  },
  {
    name: "timer method captured from unknown receiver",
    source:
      'import {useRef} from "react";const cancel=document.defaultView.clearInterval;export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "resolved const timer property replacement",
    source:
      'import {useRef} from "react";const key=\'setInterval\';document.defaultView[key]=()=>0;export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "erased Reflect capability",
    source:
      'import {useRef} from "react";declare const Reflect:any;Reflect.set(window,\'setInterval\',()=>0);export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "logical render readiness correlation",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current || !flag){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return !flag && <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "early component exit readiness correlation",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current || !flag){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};if(flag)return null;return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "native nonchildren attribute is not a render",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <div data-payload={<button onClick={toggle}>{timer.current?"Stop":"Start"}</button>}/>;};',
    count: 0,
  },
  {
    name: "native effective children attribute",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <div children={<button onClick={toggle}>{timer.current?"Stop":"Start"}</button>}/>;};',
    count: 1,
  },
  {
    name: "native children attribute overridden by actual child",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <div children={<button onClick={toggle}>{timer.current?"Stop":"Start"}</button>}>Other content</div>;};',
    count: 0,
  },
  {
    name: "imported children attribute overridden by actual child",
    source:
      'import {useRef} from "react";import {Box} from "boxes";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <Box children={<button onClick={toggle}>{timer.current?"Stop":"Start"}</button>}>Other content</Box>;};',
    count: 0,
  },
  {
    name: "object is not a native render child",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <div children={{entry:<button onClick={toggle}>{timer.current?"Stop":"Start"}</button>}}/>;};',
    count: 0,
  },
  {
    name: "disabled native button",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle} disabled>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "explicitly enabled native button",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onClick={toggle} disabled={false}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "invented native event is unsupported",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <button onImaginaryActivate={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "disabled parent fieldset",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return <fieldset disabled><button onClick={toggle}>{timer.current?"Stop":"Start"}</button></fieldset>;};',
    count: 0,
  },
  {
    name: "dead nested owner return",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};if(false)return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;return null;};',
    count: 0,
  },
  {
    name: "earlier component return",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};return null;return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "earlier component throw",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};throw Error(\'closed\');return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "conditional earlier component return conservatively unsupported",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};if(flag)return null;return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 0,
  },
  {
    name: "nested function return does not exit component",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};const label=()=>{return \'Ready\';};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
  {
    name: "nested function throw does not exit component",
    source:
      'import {useRef} from "react";export const Panel=({tick,flag})=>{const timer=useRef(null);const toggle=()=>{if(timer.current){clearInterval(timer.current);return;}timer.current=setInterval(()=>tick(),20);};const fail=()=>{throw Error(\'later\');};return <button onClick={toggle}>{timer.current?"Stop":"Start"}</button>;};',
    count: 1,
  },
];

describe("stored native timer toggle risk", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noStaleTimerRef, testCase.source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.count);
    });
  }
});
