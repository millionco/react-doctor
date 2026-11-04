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
  it.each([
    "const runtime=require('react');let reads=0;runtime.useRef=()=>({get current(){reads+=1;return reads===1;}});",
    "const load=require;const runtime=load('react');runtime.useRef=()=>({get current(){return Math.random()>0.5}});",
    "const runtime=await import('react');runtime.default.useRef=()=>({get current(){return Math.random()>0.5}});",
    "import {createRequire as loadModule} from 'node:module';const runtime=loadModule(import.meta.url)('react');runtime.useRef=()=>({get current(){return Math.random()>0.5}});",
    "import loader from 'module';const runtime=loader.createRequire(import.meta.url)('react');runtime.useRef=()=>({get current(){return Math.random()>0.5}});",
    "const runtime=module['req'+'uire']('react');runtime.useRef=()=>({get current(){return Math.random()>0.5}});",
    "let environment=globalThis;const loader=environment['req'+'uire'];const runtime=loader('react');runtime['use'+'Ref']=()=>({get current(){return Math.random()>0.5}});",
    "const loader=globalThis['req'+'uire'];const runtime=loader('react');runtime.useRef=()=>({get current(){return Math.random()>0.5}});",
    "const key='require';const runtime=globalThis[key]('react');runtime.useRef=()=>({get current(){return Math.random()>0.5}});",
    "const runtime=process.getBuiltinModule('module').createRequire(import.meta.url)('react');runtime.useRef=()=>({get current(){return Math.random()>0.5}});",
    "const runtime=process.mainModule.require('react');runtime.useRef=()=>({get current(){return Math.random()>0.5}});",
    "import runtime from 'provider';runtime.useRef=()=>({get current(){return Math.random()>0.5}});",
    "import runtime from 'provider';const key='useRef';runtime[key]=()=>({get current(){return Math.random()>0.5}});",
    "const loader=process['getBuiltin'+'Module']('module')['create'+'Require']('/tmp/provider.cjs');const runtime=loader('react');runtime['use'+'Ref']=()=>({get current(){return Math.random()>0.5}});",
    "declare const process:any;const loader=process['getBuiltin'+'Module']('module')['create'+'Require']('/tmp/provider.cjs');const runtime=loader('react');runtime['use'+'Ref']=()=>({get current(){return Math.random()>0.5}});",
    "import runtimeProcess from 'node:process';const loader=runtimeProcess['getBuiltin'+'Module']('module')['create'+'Require']('/tmp/provider.cjs');const runtime=loader('react');runtime['use'+'Ref']=()=>({get current(){return Math.random()>0.5}});",
    "const runtimeProcess=globalThis.process;const loader=runtimeProcess['getBuiltin'+'Module']('module')['create'+'Require']('/tmp/provider.cjs');const runtime=loader('react');runtime['use'+'Ref']=()=>({get current(){return Math.random()>0.5}});",
    "declare const globalThis:any;const runtime=globalThis['Re'+'act'];runtime['use'+'Ref']=()=>({get current(){return Math.random()>0.5}});",
    "declare const globalThis:any;const environment=globalThis;const runtime=environment['Re'+'act'];runtime['use'+'Ref']=()=>({get current(){return Math.random()>0.5}});",
    "declare const window:any;const runtime=window['Re'+'act'];runtime['use'+'Ref']=()=>({get current(){return Math.random()>0.5}});",
    "declare const self:any;const runtime=self['Re'+'act'];runtime['use'+'Ref']=()=>({get current(){return Math.random()>0.5}});",
    "declare const global:any;const runtime=global['Re'+'act'];runtime['use'+'Ref']=()=>({get current(){return Math.random()>0.5}});",
    "const environment=window.top;const runtime=environment['Re'+'act'];runtime['use'+'Ref']=()=>({get current(){return Math.random()>0.5}});",
    "const environment=parent;const runtime=environment['Re'+'act'];runtime['use'+'Ref']=()=>({get current(){return Math.random()>0.5}});",
    "arguments[1]('node:vm').runInThisContext('let reads=0;globalThis.sdk.useRef=()=>({get current(){reads+=1;return reads===1;}});');",
  ])("declines visible loader or provider uncertainty: %s", (providerPrelude) => {
    const code = `import {useRef,useState} from 'react';${providerPrelude}export const Widget=()=>{const gate=useRef(true);const [value,setValue]=useState(0);const reset=()=>fetch('/reset');const scroll=()=>{if(!gate.current){reset();}};const update=()=>setValue(previous=>{if(gate.current){scroll();}return previous+1;});return <button onClick={update}>{value}</button>;};`;
    const fixture = {
      name: "visible loader or provider uncertainty",
      code,
      providers: {},
      hasCertifiedEntry: false,
    };
    const filename = createFixture(fixture);
    const certificate = runRule(probeRule, code, { filename, forceJsx: true });
    const result = runRule(noSideEffectInStateUpdaterFunction, code, { filename, forceJsx: true });
    expect(certificate.parseErrors).toEqual([]);
    expect(certificate.diagnostics).toEqual([]);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

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

  it("preserves local geometry and runtime global-name shadows beneath erased declarations", () => {
    const code =
      "import {useRef,useState} from 'react';const globalThis={label:'local'};interface globalThis{}const label=globalThis.label;const rectangle={top:1,bottom:2,parent:{height:3}};const top=rectangle.top;const parent=rectangle.parent;const process={height:4};const height=rectangle.bottom-top+parent.height+process.height;export const Widget=()=>{const gate=useRef(true);const [value,setValue]=useState(0);const reset=()=>fetch('/reset');const scroll=()=>{if(!gate.current){reset();}};const update=()=>setValue(previous=>{if(gate.current){scroll();}return previous+1;});return <button onClick={update}>{value}</button>;};";
    const filename = createFixture({
      name: "runtime global-name shadow",
      code,
      providers: {},
      hasCertifiedEntry: true,
    });
    const certificate = runRule(probeRule, code, { filename, forceJsx: true });
    const result = runRule(noSideEffectInStateUpdaterFunction, code, { filename, forceJsx: true });
    expect(certificate.parseErrors).toEqual([]);
    expect(certificate.diagnostics).toHaveLength(1);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "private mutable dictionary",
      body: "let dictionary={};dictionary[entryKey]=entryValue;",
      closed: true,
    },
    {
      name: "readonly dictionary alias",
      body: "const dictionary={};const alias=dictionary;alias[entryKey]=entryValue;Object.keys(alias);",
      closed: true,
    },
    {
      name: "private dictionary ref alias and fresh reset",
      body: "const dictionary=useRef({});const alias=dictionary;alias.current[entryKey]=entryValue;dictionary.current={};",
      closed: true,
    },
    {
      name: "readonly payload snapshot with fresh current resets",
      body: "const dictionary=useRef({});const snapshot=dictionary.current;dictionary.current={};snapshot[entryKey]=entryValue;",
      closed: true,
    },
    {
      name: "foreign dictionary setter only changes private data value",
      body: "const prototype={set slot_(next){gate.current=Boolean(next);}};let dictionary={};dictionary[entryKey]=prototype;dictionary[foreign]=entryValue;",
      closed: true,
    },
    {
      name: "raw document in uncalled private arrow",
      body: "const readDocument=()=>document;",
      closed: true,
    },
    {
      name: "closed document geometry and event projections",
      body: "const getList=()=>document.querySelector('main');const read=()=>{const element=getList();if(element){const{scrollTop,scrollHeight,clientHeight}=element;}};const measure=()=>{const element=getList();if(element){const rectangle=element.getBoundingClientRect();const top=rectangle.top;const bottom=rectangle.bottom;}};const listen=()=>{let element=getList();if(element){element.addEventListener('scroll',read);element.removeEventListener('scroll',read);}};read();measure();listen();",
      closed: true,
    },
    {
      name: "reassigned dictionary base",
      body: "let dictionary={};dictionary=foreign;dictionary[entryKey]=entryValue;",
      closed: false,
    },
    {
      name: "replaced dictionary ref payload",
      body: "const dictionary=useRef({});dictionary.current=foreign;dictionary.current[entryKey]=entryValue;",
      closed: false,
    },
    {
      name: "replaced payload through const ref alias",
      body: "const dictionary=useRef({});const alias=dictionary;alias.current=foreign;dictionary.current[entryKey]=entryValue;",
      closed: false,
    },
    {
      name: "ref descriptor replacement",
      body: "const dictionary=useRef({});Object.defineProperty(dictionary,'current',{value:foreign});dictionary.current[entryKey]=entryValue;",
      closed: false,
    },
    {
      name: "escaped dictionary ref object",
      body: "const dictionary=useRef({});expose(dictionary);dictionary.current[entryKey]=entryValue;",
      closed: false,
    },
    {
      name: "mutable ref binding",
      body: "let reference=useRef({});const dictionary=reference;reference=foreign;dictionary.current[entryKey]=entryValue;",
      closed: false,
    },
    {
      name: "payload snapshot with unproved later replacement",
      body: "const dictionary=useRef({});const snapshot=dictionary.current;dictionary.current=foreign;snapshot[entryKey]=entryValue;",
      closed: false,
    },
    {
      name: "unresolved external computed mutation",
      body: "foreign[entryKey]=entryValue;",
      closed: false,
    },
    {
      name: "static callback factory replacement",
      body: "foreign.useCallback=(callback)=>()=>{callback();callback();};",
      closed: false,
    },
    {
      name: "computed callback factory replacement",
      body: "foreign['use'+'Callback']=(callback)=>()=>{callback();callback();};",
      closed: false,
    },
    {
      name: "native Object assignment",
      body: "Object.assign(foreign,{useCallback:(callback)=>()=>{callback();callback();}});",
      closed: false,
    },
    {
      name: "computed native mutation method",
      body: "Object['ass'+'ign'](foreign,{useRef:()=>foreign});",
      closed: false,
    },
    {
      name: "escaped native Object method",
      body: "const merge=Object.assign;merge(foreign,{useRef:()=>foreign});",
      closed: false,
    },
    {
      name: "document window projection",
      body: "const browser=document.defaultView;",
      closed: false,
    },
    {
      name: "computed document window projection",
      body: "const browser=document['default'+'View'];",
      closed: false,
    },
    {
      name: "queried node window projection",
      body: "const element=document.querySelector('main');if(element){const browser=element.ownerDocument.defaultView;}",
      closed: false,
    },
    {
      name: "queried node raw escape",
      body: "const element=document.querySelector('main');expose(element);",
      closed: false,
    },
    {
      name: "queried node spread escape",
      body: "const element=document.querySelector('main');const spread={...element};",
      closed: false,
    },
    {
      name: "queried node unsafe destructuring",
      body: "const element=document.querySelector('main');const {ownerDocument}=element;",
      closed: false,
    },
    {
      name: "queried method replacement",
      body: "const element=document.querySelector('main');element.getBoundingClientRect=()=>foreign;",
      closed: false,
    },
    {
      name: "queried node executable HTML insertion",
      body: "const element=document.querySelector('main');element.insertAdjacentHTML('beforeend',entryValue);",
      closed: false,
    },
    {
      name: "called raw document helper",
      body: "const readDocument=()=>document;const browser=readDocument();",
      closed: false,
    },
    {
      name: "raw document helper JSX reference",
      body: "const readDocument=()=>document;const consumer=<section read={readDocument}/>;",
      closed: false,
    },
    {
      name: "raw document getter",
      body: "const reader={get document(){return document;}};",
      closed: false,
    },
    { name: "raw document IIFE", body: "(()=>document)();", closed: false },
    {
      name: "raw document memo callback",
      body: "const result=useMemo(()=>document,[]);",
      closed: false,
    },
    {
      name: "uncalled document helper still scans capability writes",
      body: "const readDocument=()=>{foreign.useCallback=(callback)=>()=>{callback();callback();};return document;};",
      closed: false,
    },
    {
      name: "legacy argument frame reflection",
      body: "const frame=foreign.arguments;",
      closed: false,
    },
    { name: "legacy caller reflection", body: "const caller=foreign.caller;", closed: false },
    {
      name: "object destructuring fallback is not allocation",
      body: "const {dictionary={}}=foreign;dictionary.useRef=()=>foreign;",
      closed: false,
    },
    {
      name: "let destructuring fallback is not allocation",
      body: "let {dictionary={}}=foreign;dictionary.useRef=()=>foreign;",
      closed: false,
    },
    {
      name: "array destructuring fallback is not allocation",
      body: "const [dictionary={}]=foreign;dictionary.useRef=()=>foreign;",
      closed: false,
    },
    {
      name: "nested pattern fallback is not allocation",
      body: "const {outer:{dictionary={}}}=foreign;dictionary.useRef=()=>foreign;",
      closed: false,
    },
    {
      name: "pattern fallback const alias is not allocation",
      body: "const {dictionary={}}=foreign;const alias=dictionary;alias['use'+'Ref']=()=>foreign;",
      closed: false,
    },
    {
      name: "provided getter wins over fallback",
      body: "const provided={get dictionary(){return foreign;}};const {dictionary={}}=provided;dictionary.useRef=()=>foreign;",
      closed: false,
    },
    {
      name: "parameter default is not allocation",
      body: "const replace=(dictionary={})=>{dictionary.useRef=()=>foreign;};replace(foreign);",
      closed: false,
    },
    {
      name: "pattern ref initializer is not native payload allocation",
      body: "const {dictionary=useRef({})}=foreign;dictionary.current[entryKey]=entryValue;",
      closed: false,
    },
    {
      name: "later let assignment is outside direct-origin proof",
      body: "let dictionary;dictionary={};dictionary.useRef=entryValue;",
      closed: false,
    },
    {
      name: "direct readonly let remains owned",
      body: "let dictionary={};dictionary.useRef=entryValue;",
      closed: true,
    },
    {
      name: "raw document default shadow does not prove dead helper",
      body: "const readDocument=()=>document;const consumer=(initial=readDocument())=>{var readDocument;return initial;};consumer();",
      closed: false,
    },
    {
      name: "document alias default shadow does not prove closed uses",
      body: "const getList=()=>document.querySelector('main');const element=getList();const consumer=(initial=element)=>{var element;expose(initial);};consumer();",
      closed: false,
    },
    {
      name: "query function default shadow does not prove closed calls",
      body: "const getList=()=>document.querySelector('main');const consumer=(initial=getList())=>{var getList;return initial;};consumer();",
      closed: false,
    },
    {
      name: "native Object default shadow is a parameter-scope uncertainty",
      body: "const consumer=(initial=Object.assign(foreign,{useRef:()=>foreign}))=>{var Object;return initial;};consumer();",
      closed: false,
    },
  ])("proves private cell interval with $name", ({ body, closed }) => {
    const code = `import {useRef,useState,useCallback,useMemo} from 'react';export const Widget=({entryKey,entryValue,foreign})=>{const gate=useRef(true);const [value,setValue]=useState(0);${body}const reset=()=>fetch('/reset');const scroll=useCallback(()=>{if(!gate.current){reset();}},[]);const update=()=>setValue(previous=>{if(gate.current){scroll();}return previous+1;});return <button onClick={update}>{value}</button>;};`;
    const filename = createFixture({
      name: "private cell interval",
      code,
      providers: {},
      hasCertifiedEntry: closed,
    });
    const certificate = runRule(probeRule, code, { filename, forceJsx: true });
    const result = runRule(noSideEffectInStateUpdaterFunction, code, { filename, forceJsx: true });
    expect(certificate.parseErrors).toEqual([]);
    expect(certificate.diagnostics).toHaveLength(closed ? 1 : 0);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(closed ? 0 : 1);
  });

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
