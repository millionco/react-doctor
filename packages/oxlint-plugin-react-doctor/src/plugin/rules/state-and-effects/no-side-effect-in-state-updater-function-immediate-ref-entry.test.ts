import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import * as entryResolver from "../../utils/create-state-updater-entry-exclusion-resolver.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { captureCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

interface EntryFixture {
  name: string;
  code: string;
  providers: Record<string, string>;
  hasCertifiedEntry: boolean;
}

const entryFixtures: EntryFixture[] = [
  {
    name: "fixed 0 ordinary-current-last-read-first-helper-read",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: true,
  },
  {
    name: "fixed 1 earlier-ordinary-current-write",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>{gate.current=Boolean(enabled);setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});};return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: true,
  },
  {
    name: "fixed 2 negative-caller-polarity-positive-callee",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && !gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: true,
  },
  {
    name: "fixed 3 earlier-known-hook-normal-cell-writes",
    code: "import {useCallback,useRef,useState} from 'react';import {useGate} from './use-gate';\nexport const Widget=({enabled})=>{const gate=useRef(false);useGate(gate,enabled);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {
      "src/use-gate.ts":
        "import {useEffect} from 'react';export const useGate=(gate,enabled)=>{useEffect(()=>{gate.current=Boolean(enabled);},[enabled]);};",
    },
    hasCertifiedEntry: true,
  },
  {
    name: "fixed 4 broken-caller-guard",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 5 different-ref-same-property",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const other=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!other.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 6 call-after-last-cell-read",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){mutate();scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 7 later-conjunct-call",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(gate.current && mutate()){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 8 argument-side-effect",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll(gate.current=false);} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 9 default-parameter-side-effect",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback((unused=(gate.current=false))=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 10 helper-prefix-current-write",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{gate.current=false;if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 11 helper-prefix-opaque-call",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{mutate();if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 12 deferred-between-reads",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){setTimeout(scroll,0);} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 13 second-unguarded-updater-entry",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();}scroll(); return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: true,
  },
  {
    name: "fixed 14 ref-descriptor-getter",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);Object.defineProperty(gate,'current',{get:()=>Math.random()>0.5});const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 15 ref-alias-descriptor-write",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const alias=gate;Reflect.defineProperty(alias,'current',{get:()=>Math.random()>0.5});const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 16 unknown-object-member-getter",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate={get current(){return Math.random()>0.5}};const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 17 fake-use-ref-provider",
    code: "import {useCallback,useState} from 'react';\nconst useRef=()=>({get current(){return Math.random()>0.5}});export const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 18 callee-parameter-shadow-cell",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback((gate)=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 19 snapshot-before-write",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{const snapshot=gate.current;gate.current=false;if(snapshot){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 20 unknown-escaped-ref-consumer",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);expose(gate);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 21 callee-first-condition-right-ref-read",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(mutate() && !gate.current){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "fixed 22 post-helper-other-side-effect",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();}analytics.track('after'); return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: true,
  },
  {
    name: "fixed 23 catch-finally-still-analyzed",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}finally{analytics.track('finally');}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: true,
  },
  {
    name: "supplemental 0 consumer-arguments-descriptor",
    code: "import {useCallback,useRef,useState} from 'react';import {useGate} from './use-gate';\nexport const Widget=({enabled})=>{const gate=useRef(false);useGate(gate,enabled);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {
      "src/use-gate.ts":
        "export function useGate(gate,enabled){Object.defineProperty(arguments[0],'current',{get:()=>Math.random()>0.5});}",
    },
    hasCertifiedEntry: false,
  },
  {
    name: "supplemental 1 consumer-catch-computed-descriptor",
    code: "import {useCallback,useRef,useState} from 'react';import {useGate} from './use-gate';\nexport const Widget=({enabled})=>{const gate=useRef(false);useGate(gate,enabled);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {
      "src/use-gate.ts":
        "export function useGate(gate,enabled){try{throw {}}catch({[Object.defineProperty(gate,'current',{get:()=>Math.random()>0.5})]:ignored}){}}",
    },
    hasCertifiedEntry: false,
  },
  {
    name: "supplemental 2 consumer-export-replaced-in-catch",
    code: "import {useCallback,useRef,useState} from 'react';import {useGate} from './use-gate';\nexport const Widget=({enabled})=>{const gate=useRef(false);useGate(gate,enabled);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {
      "src/use-gate.ts":
        "export function useGate(gate,enabled){gate.current=enabled;}try{throw {}}catch({[(useGate=(gate)=>Object.defineProperty(gate,'current',{get:()=>Math.random()>0.5}))]:ignored}){}",
    },
    hasCertifiedEntry: false,
  },
  {
    name: "supplemental 3 consumer-other-parameter-default",
    code: "import {useCallback,useRef,useState} from 'react';import {useGate} from './use-gate';\nexport const Widget=({enabled})=>{const gate=useRef(false);useGate(gate,enabled);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {
      "src/use-gate.ts":
        "export function useGate(gate,enabled,unused=Object.defineProperty(gate,'current',{get:()=>Math.random()>0.5})){gate.current=enabled;}",
    },
    hasCertifiedEntry: false,
  },
  {
    name: "supplemental 4 type-only-use-ref",
    code: "import {useCallback,useState} from 'react';import type {useRef} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "supplemental 5 erased-declare-use-ref",
    code: "import {useCallback,useState} from 'react';declare const useRef:(initial:boolean)=>{current:boolean};\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "supplemental 6 provider-catch-computed-write",
    code: "import {useCallback,useState} from 'react';import * as React from 'react';try{throw {}}catch({[(React.useRef=()=>({get current(){return Math.random()>0.5}}))]:ignored}){}\nexport const Widget=({enabled})=>{const gate=React.useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "supplemental 7 recursive-unknown-entry-reopens-reset",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);gate.current=false;scroll();}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: true,
  },
  {
    name: "supplemental 8 unknown-entry-before-guarded-entry",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{scroll();if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: true,
  },
  {
    name: "supplemental 9 same-helper-two-updaters",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const unguarded=()=>setValue(previous=>{scroll();return previous+1;});const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={()=>{update();unguarded();}}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: true,
  },
  {
    name: "supplemental 10 nested-and-right-call-shortcircuited",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if((!gate.current && analytics.track('condition')) && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: true,
  },
  {
    name: "supplemental 11 consumer-delete-inherited-current",
    code: "import {useCallback,useRef,useState} from 'react';import {useGate} from './use-gate';\nexport const Widget=({enabled})=>{const gate=useRef(false);useGate(gate,enabled);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {
      "src/use-gate.ts":
        "export function useGate(gate,enabled){delete gate.current;Object.setPrototypeOf(gate,{get current(){return Math.random()>0.5}});}",
    },
    hasCertifiedEntry: false,
  },
  {
    name: "supplemental 12 ordinary-consumer-cache-edit-baseline",
    code: "import {useCallback,useRef,useState} from 'react';import {useGate} from './use-gate';\nexport const Widget=({enabled})=>{const gate=useRef(false);useGate(gate,enabled);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {
      "src/use-gate.ts":
        "import {useEffect} from 'react';export function useGate(gate,enabled){useEffect(()=>{gate.current=Boolean(enabled);},[enabled]);}",
    },
    hasCertifiedEntry: true,
  },
  {
    name: "erased-type-alias-does-not-shadow-runtime-cell-parameter",
    code: "import {useCallback,useRef,useState} from 'react';import {useGate} from './use-gate';\nexport const Widget=({enabled})=>{const gate=useRef(false);useGate(gate,enabled);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {
      "src/use-gate.ts": "export function useGate(gate,enabled){type gate=unknown;expose(gate);}",
    },
    hasCertifiedEntry: false,
  },
  {
    name: "runtime-ts-import-equals-capability",
    code: "import {useCallback,useRef,useState} from 'react';import reflection = Reflect;reflection.get(()=>{},'constructor')('globalThis.React = {}')();\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "global-react-value-escape-provider-alias",
    code: "import {useCallback,useRef,useState} from 'react';const provider = React;provider.useRef = () => ({get current(){return Math.random()>0.5}});\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "runtime TS export assignment",
    code: "import {useCallback,useRef,useState} from 'react';export = Reflect;\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "globalThis React object escape",
    code: "import {useCallback,useRef,useState} from 'react';const provider=globalThis.React;provider.useRef=()=>({get current(){return Math.random()>0.5}});\nexport const Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "erased interface does not shadow selected parameter",
    code: "import {useCallback,useRef,useState} from 'react';import {useGate} from './use-gate';\nexport const Widget=({enabled})=>{const gate=useRef(false);useGate(gate,enabled);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {
      "src/use-gate.ts": "export function useGate(gate,enabled){interface gate{}expose(gate);}",
    },
    hasCertifiedEntry: false,
  },
  {
    name: "dynamic import of selected ref is an unsupported runtime consumer",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);void import(gate);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: false,
  },
  {
    name: "erased-gate-interface",
    code: "import {useCallback,useRef,useState} from 'react';\nexport const Widget=({enabled})=>{const gate=useRef(false);interface gate {}const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};",
    providers: {},
    hasCertifiedEntry: true,
  },
  {
    name: "native-valid export assignment without reflective capability",
    code: "import {useCallback,useRef,useState} from 'react';\nconst Widget=({enabled})=>{const gate=useRef(false);const [value,setValue]=useState(0);const [visible,setVisible]=useState(false);const reset=()=>{analytics.track('reset');};const scroll=useCallback(()=>{try{if(!gate.current && enabled){reset();}else{setVisible(true);}}catch(error){report(error);}},[enabled]); const update=()=>setValue(previous=>{if(enabled && gate.current){scroll();} return previous+1;});return <button onClick={update}>{value}</button>;};\nexport = Widget;\n",
    providers: {},
    hasCertifiedEntry: false,
  },
];

const directories: string[] = [];
const resetProofCaches = (): void => {
  resetFilesystemCaches();
  __clearParseSourceFileCacheForTests();
};
const createFixture = (fixture: EntryFixture): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "updater-ref-entry-"));
  directories.push(directory);
  for (const [relativePath, code] of Object.entries({
    "src/widget.tsx": fixture.code,
    ...fixture.providers,
  })) {
    const filename = path.join(directory, relativePath);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, code);
  }
  resetProofCaches();
  return path.join(directory, "src/widget.tsx");
};
const probeRule = {
  ...noSideEffectInStateUpdaterFunction,
  create: (context: Parameters<typeof noSideEffectInStateUpdaterFunction.create>[0]) => {
    const resolveEntry = entryResolver.createStateUpdaterEntryExclusionResolver(context);
    return {
      CallExpression: (call: Parameters<typeof resolveEntry>[0]) => {
        if (
          !isNodeOfType(call, "CallExpression") ||
          !isNodeOfType(call.callee, "Identifier") ||
          call.callee.name !== "scroll"
        )
          return;
        const initializer = context.scopes.symbolFor(call.callee)?.initializer;
        const callee = isNodeOfType(initializer, "CallExpression")
          ? initializer.arguments[0]
          : initializer;
        if (!isFunctionLike(callee) || resolveEntry(call, callee).size === 0) return;
        context.report({ node: call, message: "Closed immediate ref entry" });
      },
    };
  },
};
const reportedOffsets = (code: string, filename: string): number[] => {
  const offsets: number[] = [];
  const rule = {
    ...noSideEffectInStateUpdaterFunction,
    create: (context: Parameters<typeof noSideEffectInStateUpdaterFunction.create>[0]) =>
      noSideEffectInStateUpdaterFunction.create({
        ...context,
        report: (descriptor) => {
          offsets.push(getNodeStartIndex(descriptor.node));
          context.report(descriptor);
        },
      }),
  };
  expect(runRule(rule, code, { filename, forceJsx: true }).parseErrors).toEqual([]);
  return offsets;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  resetProofCaches();
});

describe("immediate ordinary ref entry", () => {
  for (const fixture of entryFixtures) {
    it(fixture.name, () => {
      const filename = createFixture(fixture);
      const result = runRule(probeRule, fixture.code, { filename, forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual(
        fixture.hasCertifiedEntry
          ? [{ message: "Closed immediate ref entry", nodeType: "CallExpression" }]
          : [],
      );
    });
  }

  it("declines a replaced named callee self binding", () => {
    const fixture = {
      name: "named callee self assignment",
      code: "import {useRef,useState} from 'react';export const Widget=()=>{const gate=useRef(false);const [value,setValue]=useState(0);const reset=()=>fetch('/reset');const scroll=function visit(){if(!gate.current){reset();}else{visit=()=>reset();visit();}};const update=()=>setValue(previous=>{if(gate.current){scroll();}return previous+1;});return <button onClick={update}>{value}</button>;};",
      providers: {},
      hasCertifiedEntry: false,
    };
    expect(
      runRule(probeRule, fixture.code, { filename: createFixture(fixture), forceJsx: true }),
    ).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it("preserves alternate setter and catch effects while excluding the contradictory call", () => {
    const fixture = entryFixtures[0];
    const offsets = reportedOffsets(fixture.code, createFixture(fixture));
    expect(offsets).not.toContain(fixture.code.indexOf("analytics.track('reset')"));
    expect(offsets).toContain(fixture.code.indexOf("setVisible(true)"));
    expect(offsets).toContain(fixture.code.indexOf("report(error)"));
  });

  for (const fixtureIndex of [13, 31, 32, 33]) {
    it(`restores the reset effect for an unknown entry: ${fixtureIndex}`, () => {
      const fixture = entryFixtures[fixtureIndex];
      const offsets = reportedOffsets(fixture.code, createFixture(fixture));
      expect(offsets).toContain(fixture.code.indexOf("analytics.track('reset')"));
    });
  }

  it("preserves later and finally effects", () => {
    for (const fixtureIndex of [22, 23]) {
      const fixture = entryFixtures[fixtureIndex];
      const offsets = reportedOffsets(fixture.code, createFixture(fixture));
      expect(offsets).not.toContain(fixture.code.indexOf("analytics.track('reset')"));
      const later = fixtureIndex === 22 ? "analytics.track('after')" : "analytics.track('finally')";
      expect(offsets).toContain(fixture.code.indexOf(later));
    }
  });

  it("retains OLD reachable effects when new entry analysis fails", () => {
    vi.spyOn(entryResolver, "createStateUpdaterEntryExclusionResolver").mockReturnValue(() => {
      throw new Error("Uncertain entry proof");
    });
    const fixture = entryFixtures[0];
    expect(reportedOffsets(fixture.code, createFixture(fixture))).toContain(
      fixture.code.indexOf("analytics.track('reset')"),
    );
  });

  it("rechecks imported data-cell proof at edit, delete and appearance reset boundaries", () => {
    const fixture = entryFixtures[3];
    const filename = createFixture(fixture);
    const provider = path.join(path.dirname(filename), "use-gate.ts");
    const observe = () => {
      resetProofCaches();
      return captureCrossFileProbes(() =>
        runRule(probeRule, fixture.code, { filename, forceJsx: true }),
      );
    };
    const initial = observe();
    expect(initial.value.diagnostics).toEqual([
      { message: "Closed immediate ref entry", nodeType: "CallExpression" },
    ]);
    expect(initial.trace.contentPaths.has(provider)).toBe(true);
    writeFileSync(
      provider,
      "export function useGate(gate,enabled){Object.defineProperty(arguments[0],'current',{get:()=>enabled});}",
    );
    expect(observe().value.diagnostics).toEqual([]);
    rmSync(provider);
    const missing = observe();
    expect(missing.value.diagnostics).toEqual([]);
    expect(missing.trace.existencePaths.has(provider)).toBe(true);
    writeFileSync(provider, fixture.providers["src/use-gate.ts"]);
    expect(observe().value.diagnostics).toEqual([
      { message: "Closed immediate ref entry", nodeType: "CallExpression" },
    ]);
  });
});
