import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedBrowserGlobalInRenderOrHookInit } from "./no-unguarded-browser-global-in-render-or-hook-init.js";

interface MountGateTestCase {
  name: string;
  code: string;
  expectedCount: number;
}

export const mountGateTestCases: ReadonlyArray<MountGateTestCase> = [
  {
    name: "literal-false-native-memo",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 0,
  },
  {
    name: "native-memo-compound-guard",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(!mounted||!value)return null;return document.title;},[mounted,value]);};',
    expectedCount: 0,
  },
  {
    name: "guard-only-one-branch",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(!mounted){if(value)return null;}return document.title;},[mounted,value]);};',
    expectedCount: 1,
  },
  {
    name: "read-before-mount-exit",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{const result=document.title;if(!mounted)return null;return result;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "guard-reversed",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "initial-true",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(true);useEffect(()=>setMounted(true),[]);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "opaque-initializer",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(readFlag());useEffect(()=>setMounted(true),[]);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "render-phase-setter",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);if(!mounted)setMounted(true);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "memo-phase-setter",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{setMounted(true);if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "setter-escape",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);install(setMounted);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "setter-return",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);const result=useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);return [result,setMounted];};',
    expectedCount: 1,
  },
  {
    name: "state-binding-replacement",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{let [mounted,setMounted]=useState(false);mounted=true;return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "state-default-target",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{let [mounted,setMounted]=useState(false);({mounted=true}={});return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "native-state-metadata",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);useState.description="label";return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 0,
  },
  {
    name: "state-computed-key-read",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);const {[useState]:ignored}={};return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "state-default-rhs-read",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);const {hook=useState}={};return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 0,
  },
  {
    name: "shadowed-use-state",
    code: 'import {useMemo} from "react";\nconst BrowserPanel=({value})=>{const useState=()=>[true,()=>{}];const [mounted,setMounted]=useState(false);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "state-api-binding-replaced",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{useState=customState;const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "memo-provider-replaced",
    code: 'import {useState,useEffect,useMemo} from "react";\nimport React from "react";\nconst BrowserPanel=({value})=>{React.useMemo=customMemo;const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "effect-provider-replaced",
    code: 'import {useState,useEffect,useMemo} from "react";\nimport React from "react";\nconst BrowserPanel=({value})=>{React.useEffect=customEffect;const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "memo-callback-parameter",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo((mounted=true)=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "memo-callback-async",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(async()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "unrelated-falsy-owner-state",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(!value)return null;return document.title;},[mounted,value]);};',
    expectedCount: 1,
  },
  {
    name: "named-memo-helper",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);const read=()=>{if(!mounted)return null;return document.title;};return useMemo(read,[mounted]);};',
    expectedCount: 0,
  },
  {
    name: "foreign-callback-same-name",
    code: 'import {useState,useEffect,useMemo} from "react";\nconst BrowserPanel=({value})=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return unknownMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 0,
  },
  {
    name: "native memo metadata",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);useMemo.description="label";return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 0,
  },
  {
    name: "native effect metadata",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);useEffect.description="label";return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 0,
  },
  {
    name: "state sibling provider mutation",
    code: 'import React from "react";import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);React.useState=customState;return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "effect assignment pattern",
    code: 'import React from "react";import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);({effect:React.useEffect}={effect:customEffect});return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "memo loop replacement",
    code: 'import React from "react";import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);for(React.useMemo of [customMemo]){}return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "native namespace escape",
    code: 'import React from "react";import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);install(React);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "native memo callable escape",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);install(useMemo);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "native state callable escape",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);install(useState);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "native effect callable escape",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);install(useEffect);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "state slot assignment through loop",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);for(mounted of [true]){}return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "setter replacement",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);setMounted=unknownSetter;return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "setter member invocation",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);setMounted.call(null,true);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "setter passed as argument",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);run(setMounted);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "conditional callback exit",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(!mounted){if(unknownFlag)return null;}return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "memo callback default argument",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo((mounted=true)=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "guard initial false alternate exits",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(mounted){}else{return null;}return document.title;},[mounted]);};',
    expectedCount: 0,
  },
  {
    name: "lazy false outside first scope",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(()=>false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "memo browser before early exit",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{const title=document.title;if(!mounted)return null;return title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "other state sibling is unknown native truth",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);const [other]=useState(true);return useMemo(()=>{if(mounted||other){}else{return null;}return document.title;},[mounted,other]);};',
    expectedCount: 1,
  },
  {
    name: "callback contains return only in other function",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{const exit=()=>{if(!mounted)return null;};return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "zero setter references",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 0,
  },
  {
    name: "setter nested effect helper unsupported",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{ const [mounted,setMounted]=useState(false);useEffect(()=>{const update=()=>setMounted(true);update();},[]);return useMemo(()=>{if(!mounted)return null;return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "finally break cancels callback return",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(!mounted){do{try{return null;}finally{break;}}while(false);}return document.title;},[mounted]);};',
    expectedCount: 1,
  },
  {
    name: "loop break precedes unreachable return",
    code: 'import {useState,useEffect,useMemo} from "react"; const BrowserPanel=()=>{const [mounted,setMounted]=useState(false);useEffect(()=>{setMounted(true);},[]);return useMemo(()=>{if(!mounted){do{break;return null;}while(false);}return document.title;},[mounted]);};',
    expectedCount: 1,
  },
];

describe("no-unguarded-browser-global-in-render-or-hook-init mount-gated memo", () => {
  it.each(mountGateTestCases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noUnguardedBrowserGlobalInRenderOrHookInit, code, {
      filename: "app/browser-panel.tsx",
      includeLocations: true,
      forceJsx: true,
      settings: { "react-doctor": { portedRuleMode: "curated" } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
