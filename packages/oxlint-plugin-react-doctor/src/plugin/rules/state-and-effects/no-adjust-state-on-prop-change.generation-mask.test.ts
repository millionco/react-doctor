import { describe, expect, it } from "vite-plus/test";
import type { Rule } from "../../utils/rule.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { isGenerationMaskedBooleanReset } from "./utils/is-generation-masked-boolean-reset.js";

const certificateProbe: Rule = {
  id: "generation-masked-boolean-reset-probe",
  severity: "warn",
  create: (context) => ({
    CallExpression: (node) => {
      if (isGenerationMaskedBooleanReset(node, context))
        context.report({ node, message: "generation-masked Boolean reset" });
    },
  }),
};

const baseSource =
  "import {useCallback,useEffect,useRef,useState} from 'react';\ninterface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\nexport const Panel=({recordId,onLoad,hasRows,status}:Props)=>{\n const[busy,setBusy]=useState(false);const epoch=useRef(0);const tag=useRef(-1);\n const previousRecord=useRef(recordId);const previousLoad=useRef(onLoad);const previousRows=useRef(hasRows);const previousStatus=useRef(status);\n {let invalid=false;\n  if(previousRecord.current!==recordId){invalid=true;previousRecord.current=recordId;}\n  if(previousLoad.current!==onLoad){invalid=true;previousLoad.current=onLoad;}\n  if(previousRows.current!==hasRows){invalid=true;previousRows.current=hasRows;}\n  if(previousStatus.current!==status){invalid=true;previousStatus.current=status;}\n  if(invalid){epoch.current+=1;}\n }\n const visible=busy&&tag.current===epoch.current;\n useEffect(()=>{setBusy(false);},[recordId,onLoad,hasRows,status]);\n const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n};\n";

const cases = [
  {
    name: "JSX spread before epoch capture can read a getter",
    certificate: false,
    source: baseSource.replace(
      "const captured=epoch.current;",
      "const view=<div {...opaqueProps}/>;const captured=epoch.current;",
    ),
  },
  {
    name: "opaque getter before epoch capture",
    certificate: false,
    source: baseSource.replace(
      "const captured=epoch.current;",
      "const value=opaque.value;const captured=epoch.current;",
    ),
  },
  {
    name: "object-valued ref coercion before epoch capture",
    certificate: false,
    source: baseSource
      .replace("const epoch=useRef(0);", "const counter=useRef(opaque);const epoch=useRef(0);")
      .replace("const captured=epoch.current;", "++counter.current;const captured=epoch.current;"),
  },
  {
    name: "numeric counter has an extra assignment",
    certificate: false,
    source: baseSource
      .replace(
        "const epoch=useRef(0);",
        "const counter=useRef(0);counter.current=opaque;const epoch=useRef(0);",
      )
      .replace("const captured=epoch.current;", "++counter.current;const captured=epoch.current;"),
  },
  {
    name: "numeric counter remains a passive prelude",
    certificate: true,
    source: baseSource
      .replace("const epoch=useRef(0);", "const counter=useRef(0);const epoch=useRef(0);")
      .replace(
        "const captured=epoch.current;",
        "const attempt=++counter.current;const captured=epoch.current;",
      ),
  },
  {
    name: "opaque arithmetic coercion before epoch capture",
    certificate: false,
    source: baseSource.replace(
      "const captured=epoch.current;",
      "const coerced=opaque+'';const captured=epoch.current;",
    ),
  },
  {
    name: "tagged invocation before epoch capture",
    certificate: false,
    source: baseSource.replace(
      "const captured=epoch.current;",
      "notify`value`;const captured=epoch.current;",
    ),
  },
  {
    name: "foreign call in an earlier epoch declarator",
    certificate: false,
    source: baseSource.replace(
      "const captured=epoch.current;",
      "const earlier=onLoad(),captured=epoch.current;",
    ),
  },
  {
    name: "default imported type name collision",
    certificate: false,
    source: "import Props from './external';\n" + baseSource,
  },
  {
    name: "namespace imported type name collision",
    certificate: false,
    source: "import * as Props from './external';\n" + baseSource,
  },
  {
    name: "class type name collision",
    certificate: false,
    source: "class Props {}\n" + baseSource,
  },
  {
    name: "enum type name collision",
    certificate: false,
    source: "enum Props { Value }\n" + baseSource,
  },
  {
    name: "outer generic shadows the declared parameter interface",
    certificate: false,
    source:
      baseSource.replace("export const Panel=", "const factory=<Props,>()=>{const Panel=") +
      "return Panel;};\n",
  },
  {
    name: "native abort construction before epoch capture",
    certificate: true,
    source: baseSource.replace(
      "const captured=epoch.current;",
      "const controller=new AbortController();const captured=epoch.current;",
    ),
  },
  {
    name: "replaced bare abort constructor before capture",
    certificate: false,
    source:
      "AbortController=Replacement;\n" +
      baseSource.replace(
        "const captured=epoch.current;",
        "const controller=new AbortController();const captured=epoch.current;",
      ),
  },
  {
    name: "replaced global abort constructor before capture",
    certificate: false,
    source:
      "globalThis.AbortController=Replacement;\n" +
      baseSource.replace(
        "const captured=epoch.current;",
        "const controller=new AbortController();const captured=epoch.current;",
      ),
  },
  {
    name: "reflected global abort constructor before capture",
    certificate: false,
    source:
      "globalThis.__defineGetter__('AbortController',replaceController);\n" +
      baseSource.replace(
        "const captured=epoch.current;",
        "const controller=new AbortController();const captured=epoch.current;",
      ),
  },
  {
    name: "abort constructor argument can reenter before capture",
    certificate: false,
    source: baseSource.replace(
      "const captured=epoch.current;",
      "const controller=new AbortController(onLoad());const captured=epoch.current;",
    ),
  },
  {
    name: "dependency alias remains outside the finite proof",
    certificate: false,
    source: baseSource.replace(
      " const visible=busy&&tag.current===epoch.current;\n",
      " const alias=recordId;const visible=busy&&tag.current===epoch.current;\n",
    ),
  },
  { name: "complete-four-domain-captured-epoch", certificate: true, source: baseSource },
  {
    name: "one-extra-raw-read",
    certificate: false,
    source: baseSource.replace(
      " return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
      " consume(busy);return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
    ),
  },
  {
    name: "conditional-mask-bypass",
    certificate: false,
    source: baseSource.replace(
      " const visible=busy&&tag.current===epoch.current;\n",
      " const visible=status?busy:busy&&tag.current===epoch.current;\n",
    ),
  },
  {
    name: "missing-status-invalidation",
    certificate: false,
    source: baseSource.replace(
      "  if(previousStatus.current!==status){invalid=true;previousStatus.current=status;}\n",
      "",
    ),
  },
  {
    name: "restamp-during-render",
    certificate: false,
    source: baseSource.replace(
      " const visible=busy&&tag.current===epoch.current;\n",
      " tag.current=epoch.current;const visible=busy&&tag.current===epoch.current;\n",
    ),
  },
  {
    name: "epoch-reset-before-mask",
    certificate: false,
    source: baseSource.replace(
      " const visible=busy&&tag.current===epoch.current;\n",
      " epoch.current=0;const visible=busy&&tag.current===epoch.current;\n",
    ),
  },
  {
    name: "precision-seeded-counter",
    certificate: false,
    source: baseSource.replace(
      " const[busy,setBusy]=useState(false);const epoch=useRef(0);const tag=useRef(-1);\n",
      " const[busy,setBusy]=useState(false);const epoch=useRef(9007199254740992);const tag=useRef(-1);\n",
    ),
  },
  {
    name: "numeric-dependency-signed-zero",
    certificate: false,
    source: baseSource.replace(
      "interface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\n",
      "interface Props {recordId:number;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\n",
    ),
  },
  {
    name: "any-dependency",
    certificate: false,
    source: baseSource.replace(
      "interface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\n",
      "interface Props {recordId:any;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\n",
    ),
  },
  {
    name: "unknown-dependency",
    certificate: false,
    source: baseSource.replace(
      "interface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\n",
      "interface Props {recordId:unknown;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\n",
    ),
  },
  {
    name: "cast-prop-domain",
    certificate: false,
    source: baseSource.replace(
      "  if(previousRecord.current!==recordId){invalid=true;previousRecord.current=recordId;}\n",
      "  if(previousRecord.current!==(recordId as string)){invalid=true;previousRecord.current=recordId;}\n",
    ),
  },
  {
    name: "live-epoch-after-foreign-call",
    certificate: false,
    source: baseSource.replace(
      " const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n",
      " const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=epoch.current;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n",
    ),
  },
  {
    name: "deferred-true-restamps-current",
    certificate: false,
    source: baseSource.replace(
      " const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n",
      " const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>{setBusy(true);tag.current=epoch.current;},()=>setBusy(false));}},[onLoad]);\n",
    ),
  },
  {
    name: "false-only-deferred-writers",
    certificate: true,
    source: baseSource.replace(
      " const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n",
      " const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>{setBusy(false);},()=>{setBusy(false);});}},[onLoad]);\n",
    ),
  },
  {
    name: "tag-escape",
    certificate: false,
    source: baseSource.replace(
      " const visible=busy&&tag.current===epoch.current;\n",
      " expose(tag);const visible=busy&&tag.current===epoch.current;\n",
    ),
  },
  {
    name: "fake-ref-provider",
    certificate: false,
    source: baseSource.replace(
      "import {useCallback,useEffect,useRef,useState} from 'react';\n",
      "import {useCallback,useEffect,useState} from 'react';\nconst useRef=value=>({current:value});\n",
    ),
  },
  {
    name: "eval-hidden-tag-write",
    certificate: false,
    source: baseSource.replace(
      " const visible=busy&&tag.current===epoch.current;\n",
      " (eval as any)('tag.current=epoch.current');const visible=busy&&tag.current===epoch.current;\n",
    ),
  },
  {
    name: "extra-pending-conjunct",
    certificate: true,
    source: baseSource.replace(
      " const[busy,setBusy]=useState(false);const epoch=useRef(0);const tag=useRef(-1);\n const previousRecord=useRef(recordId);const previousLoad=useRef(onLoad);const previousRows=useRef(hasRows);const previousStatus=useRef(status);\n {let invalid=false;\n  if(previousRecord.current!==recordId){invalid=true;previousRecord.current=recordId;}\n  if(previousLoad.current!==onLoad){invalid=true;previousLoad.current=onLoad;}\n  if(previousRows.current!==hasRows){invalid=true;previousRows.current=hasRows;}\n  if(previousStatus.current!==status){invalid=true;previousStatus.current=status;}\n  if(invalid){epoch.current+=1;}\n }\n const visible=busy&&tag.current===epoch.current;\n",
      " const[busy,setBusy]=useState(false);const epoch=useRef(0);const tag=useRef(-1);const active=useRef(true);\n const previousRecord=useRef(recordId);const previousLoad=useRef(onLoad);const previousRows=useRef(hasRows);const previousStatus=useRef(status);\n {let invalid=false;\n  if(previousRecord.current!==recordId){invalid=true;previousRecord.current=recordId;}\n  if(previousLoad.current!==onLoad){invalid=true;previousLoad.current=onLoad;}\n  if(previousRows.current!==hasRows){invalid=true;previousRows.current=hasRows;}\n  if(previousStatus.current!==status){invalid=true;previousStatus.current=status;}\n  if(invalid){epoch.current+=1;}\n }\n const visible=busy&&tag.current===epoch.current&&active.current;\n",
    ),
  },
  {
    name: "sibling-state-unmasked",
    certificate: true,
    source: baseSource.replace(
      " const visible=busy&&tag.current===epoch.current;\n useEffect(()=>{setBusy(false);},[recordId,onLoad,hasRows,status]);\n const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
      " const[failed,setFailed]=useState(false);const visible=busy&&tag.current===epoch.current;\n useEffect(()=>{setBusy(false);setFailed(false);},[recordId,onLoad,hasRows,status]);\n const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n return <button onClick={begin}>{visible?'busy':failed?'failed':'idle'}</button>;\n",
    ),
  },
  {
    name: "own inline property annotation",
    certificate: true,
    source: baseSource.replace(
      "export const Panel=({recordId,onLoad,hasRows,status}:Props)=>{\n",
      "export const Panel=({recordId,onLoad,hasRows,status}:{recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';})=>{\n",
    ),
  },
  {
    name: "native key activation",
    certificate: true,
    source: baseSource.replace(
      " return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
      " return <button onKeyDown={begin}>{visible?'busy':'idle'}</button>;\n",
    ),
  },
  {
    name: "visible numeric data does not alter provider",
    certificate: true,
    source: baseSource.replace(
      " const visible=busy&&tag.current===epoch.current;\n",
      " const table={first:1};const index=recordId+'';const datum=table[index];const box={values:table};const geometry=box.values[index];const visible=busy&&tag.current===epoch.current;\n",
    ),
  },
  {
    name: "custom event callback owner",
    certificate: false,
    source: baseSource.replace(
      " return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
      " return <Managed onClick={begin}>{visible?'busy':'idle'}</Managed>;\n",
    ),
  },
  {
    name: "ancestor custom owner",
    certificate: false,
    source: baseSource.replace(
      " return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
      " return <Managed><button onClick={begin}>{visible?'busy':'idle'}</button></Managed>;\n",
    ),
  },
  {
    name: "ancestor ref ownership",
    certificate: false,
    source: baseSource.replace(
      " return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
      " return <div ref={capture}><button onClick={begin}>{visible?'busy':'idle'}</button></div>;\n",
    ),
  },
  {
    name: "render dispatch is not event ownership",
    certificate: false,
    source: baseSource.replace(
      " return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
      " begin();return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
    ),
  },
  {
    name: "event callback escape",
    certificate: false,
    source: baseSource.replace(
      " return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
      " consume(begin);return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
    ),
  },
  {
    name: "computed React provider replacement",
    certificate: false,
    source: baseSource.replace(
      "import {useCallback,useEffect,useRef,useState} from 'react';\n",
      "import React,{useCallback,useEffect,useRef,useState} from 'react';const key='useState';React[key]=customState;\n",
    ),
  },
  {
    name: "aliased React provider replacement",
    certificate: false,
    source: baseSource.replace(
      "import {useCallback,useEffect,useRef,useState} from 'react';\n",
      "import React,{useCallback,useEffect,useRef,useState} from 'react';const provider=React;provider.useState=customState;\n",
    ),
  },
  {
    name: "erased Object capability",
    certificate: false,
    source: baseSource.replace(
      "import {useCallback,useEffect,useRef,useState} from 'react';\ninterface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\nexport const Panel=({recordId,onLoad,hasRows,status}:Props)=>{\n const[busy,setBusy]=useState(false);const epoch=useRef(0);const tag=useRef(-1);\n const previousRecord=useRef(recordId);const previousLoad=useRef(onLoad);const previousRows=useRef(hasRows);const previousStatus=useRef(status);\n {let invalid=false;\n  if(previousRecord.current!==recordId){invalid=true;previousRecord.current=recordId;}\n  if(previousLoad.current!==onLoad){invalid=true;previousLoad.current=onLoad;}\n  if(previousRows.current!==hasRows){invalid=true;previousRows.current=hasRows;}\n  if(previousStatus.current!==status){invalid=true;previousStatus.current=status;}\n  if(invalid){epoch.current+=1;}\n }\n const visible=busy&&tag.current===epoch.current;\n useEffect(()=>{setBusy(false);},[recordId,onLoad,hasRows,status]);\n const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n};\n",
      "import {useCallback,useEffect,useRef,useState} from 'react';\ninterface Object{};Object.defineProperty(target,field,descriptor);\ninterface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\nexport const Panel=({recordId,onLoad,hasRows,status}:Props)=>{\n const[busy,setBusy]=useState(false);const epoch=useRef(0);const tag=useRef(-1);\n const previousRecord=useRef(recordId);const previousLoad=useRef(onLoad);const previousRows=useRef(hasRows);const previousStatus=useRef(status);\n {let invalid=false;\n  if(previousRecord.current!==recordId){invalid=true;previousRecord.current=recordId;}\n  if(previousLoad.current!==onLoad){invalid=true;previousLoad.current=onLoad;}\n  if(previousRows.current!==hasRows){invalid=true;previousRows.current=hasRows;}\n  if(previousStatus.current!==status){invalid=true;previousStatus.current=status;}\n  if(invalid){epoch.current+=1;}\n }\n const visible=busy&&tag.current===epoch.current;\n useEffect(()=>{setBusy(false);},[recordId,onLoad,hasRows,status]);\n const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n};\n",
    ),
  },
  {
    name: "erased Function capability",
    certificate: false,
    source: baseSource.replace(
      "import {useCallback,useEffect,useRef,useState} from 'react';\ninterface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\nexport const Panel=({recordId,onLoad,hasRows,status}:Props)=>{\n const[busy,setBusy]=useState(false);const epoch=useRef(0);const tag=useRef(-1);\n const previousRecord=useRef(recordId);const previousLoad=useRef(onLoad);const previousRows=useRef(hasRows);const previousStatus=useRef(status);\n {let invalid=false;\n  if(previousRecord.current!==recordId){invalid=true;previousRecord.current=recordId;}\n  if(previousLoad.current!==onLoad){invalid=true;previousLoad.current=onLoad;}\n  if(previousRows.current!==hasRows){invalid=true;previousRows.current=hasRows;}\n  if(previousStatus.current!==status){invalid=true;previousStatus.current=status;}\n  if(invalid){epoch.current+=1;}\n }\n const visible=busy&&tag.current===epoch.current;\n useEffect(()=>{setBusy(false);},[recordId,onLoad,hasRows,status]);\n const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n};\n",
      "import {useCallback,useEffect,useRef,useState} from 'react';\ninterface Function{};Function('return null')();\ninterface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\nexport const Panel=({recordId,onLoad,hasRows,status}:Props)=>{\n const[busy,setBusy]=useState(false);const epoch=useRef(0);const tag=useRef(-1);\n const previousRecord=useRef(recordId);const previousLoad=useRef(onLoad);const previousRows=useRef(hasRows);const previousStatus=useRef(status);\n {let invalid=false;\n  if(previousRecord.current!==recordId){invalid=true;previousRecord.current=recordId;}\n  if(previousLoad.current!==onLoad){invalid=true;previousLoad.current=onLoad;}\n  if(previousRows.current!==hasRows){invalid=true;previousRows.current=hasRows;}\n  if(previousStatus.current!==status){invalid=true;previousStatus.current=status;}\n  if(invalid){epoch.current+=1;}\n }\n const visible=busy&&tag.current===epoch.current;\n useEffect(()=>{setBusy(false);},[recordId,onLoad,hasRows,status]);\n const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n};\n",
    ),
  },
  {
    name: "type-only state import",
    certificate: false,
    source: baseSource.replace(
      "import {useCallback,useEffect,useRef,useState} from 'react';\n",
      "import {useCallback,useEffect,useRef,type useState} from 'react';\n",
    ),
  },
  {
    name: "functional true writer",
    certificate: false,
    source: baseSource.replace(
      " const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n",
      " const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(previous=>true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n",
    ),
  },
  {
    name: "foreign operation before epoch capture",
    certificate: false,
    source: baseSource.replace(
      " const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n",
      " const begin=useCallback(()=>{if(!onLoad)return;onLoad();const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n",
    ),
  },
  {
    name: "merged own interface",
    certificate: false,
    source: baseSource.replace(
      "import {useCallback,useEffect,useRef,useState} from 'react';\ninterface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\nexport const Panel=({recordId,onLoad,hasRows,status}:Props)=>{\n const[busy,setBusy]=useState(false);const epoch=useRef(0);const tag=useRef(-1);\n const previousRecord=useRef(recordId);const previousLoad=useRef(onLoad);const previousRows=useRef(hasRows);const previousStatus=useRef(status);\n {let invalid=false;\n  if(previousRecord.current!==recordId){invalid=true;previousRecord.current=recordId;}\n  if(previousLoad.current!==onLoad){invalid=true;previousLoad.current=onLoad;}\n  if(previousRows.current!==hasRows){invalid=true;previousRows.current=hasRows;}\n  if(previousStatus.current!==status){invalid=true;previousStatus.current=status;}\n  if(invalid){epoch.current+=1;}\n }\n const visible=busy&&tag.current===epoch.current;\n useEffect(()=>{setBusy(false);},[recordId,onLoad,hasRows,status]);\n const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n};\n",
      "import {useCallback,useEffect,useRef,useState} from 'react';\ninterface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\ninterface Props{other?:string;}\nexport const Panel=({recordId,onLoad,hasRows,status}:Props)=>{\n const[busy,setBusy]=useState(false);const epoch=useRef(0);const tag=useRef(-1);\n const previousRecord=useRef(recordId);const previousLoad=useRef(onLoad);const previousRows=useRef(hasRows);const previousStatus=useRef(status);\n {let invalid=false;\n  if(previousRecord.current!==recordId){invalid=true;previousRecord.current=recordId;}\n  if(previousLoad.current!==onLoad){invalid=true;previousLoad.current=onLoad;}\n  if(previousRows.current!==hasRows){invalid=true;previousRows.current=hasRows;}\n  if(previousStatus.current!==status){invalid=true;previousStatus.current=status;}\n  if(invalid){epoch.current+=1;}\n }\n const visible=busy&&tag.current===epoch.current;\n useEffect(()=>{setBusy(false);},[recordId,onLoad,hasRows,status]);\n const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n};\n",
    ),
  },
  {
    name: "imported property interface",
    certificate: false,
    source: baseSource.replace(
      "interface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\n",
      "import type{Props}from'./types';\n",
    ),
  },
  {
    name: "unknown typed primitive alias",
    certificate: false,
    source: baseSource.replace(
      "interface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\n",
      "type RecordId=string;interface Props {recordId:RecordId;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\n",
    ),
  },
  {
    name: "generation decrement",
    certificate: false,
    source: baseSource.replace(
      "  if(invalid){epoch.current+=1;}\n",
      "  if(invalid){epoch.current-=1;}\n",
    ),
  },
  {
    name: "generation double step",
    certificate: false,
    source: baseSource.replace(
      "  if(invalid){epoch.current+=1;}\n",
      "  if(invalid){epoch.current+=2;}\n",
    ),
  },
  {
    name: "raw state in effect dependencies",
    certificate: false,
    source: baseSource.replace(
      " useEffect(()=>{setBusy(false);},[recordId,onLoad,hasRows,status]);\n",
      " useEffect(()=>{setBusy(false);},[recordId,onLoad,hasRows,status,busy]);\n",
    ),
  },
  {
    name: "previous marker reset",
    certificate: false,
    source: baseSource.replace(
      " const visible=busy&&tag.current===epoch.current;\n",
      " previousRecord.current=recordId;const visible=busy&&tag.current===epoch.current;\n",
    ),
  },
  {
    name: "bump after mask",
    certificate: false,
    source: baseSource.replace(
      " const visible=busy&&tag.current===epoch.current;\n",
      " const visible=busy&&tag.current===epoch.current;epoch.current+=1;\n",
    ),
  },
  {
    name: "provider pragma",
    certificate: false,
    source: baseSource.replace(
      "import {useCallback,useEffect,useRef,useState} from 'react';\ninterface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\nexport const Panel=({recordId,onLoad,hasRows,status}:Props)=>{\n const[busy,setBusy]=useState(false);const epoch=useRef(0);const tag=useRef(-1);\n const previousRecord=useRef(recordId);const previousLoad=useRef(onLoad);const previousRows=useRef(hasRows);const previousStatus=useRef(status);\n {let invalid=false;\n  if(previousRecord.current!==recordId){invalid=true;previousRecord.current=recordId;}\n  if(previousLoad.current!==onLoad){invalid=true;previousLoad.current=onLoad;}\n  if(previousRows.current!==hasRows){invalid=true;previousRows.current=hasRows;}\n  if(previousStatus.current!==status){invalid=true;previousStatus.current=status;}\n  if(invalid){epoch.current+=1;}\n }\n const visible=busy&&tag.current===epoch.current;\n useEffect(()=>{setBusy(false);},[recordId,onLoad,hasRows,status]);\n const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n};\n",
      "/** @jsxImportSource alternate */\nimport {useCallback,useEffect,useRef,useState} from 'react';\ninterface Props {recordId:string;onLoad?:()=>void|Promise<void>;hasRows:boolean;status?:'running'|'failed';}\nexport const Panel=({recordId,onLoad,hasRows,status}:Props)=>{\n const[busy,setBusy]=useState(false);const epoch=useRef(0);const tag=useRef(-1);\n const previousRecord=useRef(recordId);const previousLoad=useRef(onLoad);const previousRows=useRef(hasRows);const previousStatus=useRef(status);\n {let invalid=false;\n  if(previousRecord.current!==recordId){invalid=true;previousRecord.current=recordId;}\n  if(previousLoad.current!==onLoad){invalid=true;previousLoad.current=onLoad;}\n  if(previousRows.current!==hasRows){invalid=true;previousRows.current=hasRows;}\n  if(previousStatus.current!==status){invalid=true;previousStatus.current=status;}\n  if(invalid){epoch.current+=1;}\n }\n const visible=busy&&tag.current===epoch.current;\n useEffect(()=>{setBusy(false);},[recordId,onLoad,hasRows,status]);\n const begin=useCallback(()=>{if(!onLoad)return;const captured=epoch.current;const result=onLoad();if(result&&typeof result.then==='function'){setBusy(true);tag.current=captured;result.then(()=>setBusy(false),()=>setBusy(false));}},[onLoad]);\n return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n};\n",
    ),
  },
  {
    name: "readonly local render helper in native JSX",
    certificate: true,
    source: baseSource.replace(
      " return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
      " const renderAction=()=>{if(hasRows)return null;return <button onClick={begin}>{visible?'busy':'idle'}</button>;};return <section>{renderAction()}</section>;\n",
    ),
  },
  {
    name: "render helper passed to opaque code",
    certificate: false,
    source: baseSource.replace(
      " return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
      " const renderAction=()=>{if(hasRows)return null;return <button onClick={begin}>{visible?'busy':'idle'}</button>;};consume(renderAction);return <section>{renderAction()}</section>;\n",
    ),
  },
  {
    name: "stored helper JSX transport",
    certificate: false,
    source: baseSource.replace(
      " return <button onClick={begin}>{visible?'busy':'idle'}</button>;\n",
      " const renderAction=()=>{if(hasRows)return null;return <button onClick={begin}>{visible?'busy':'idle'}</button>;};const saved=<section>{renderAction()}</section>;return saved;;\n",
    ),
  },
];

describe("generation-masked Boolean resets", () => {
  it.each(cases)("$name", (fixture) => {
    const result = runRule(certificateProbe, fixture.source, {
      filename: "/synthetic/generation-mask.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length > 0).toBe(fixture.certificate);
  });

  it("exempts the selected old-value mask without prescribing reset removal", () => {
    const result = runRule(noAdjustStateOnPropChange, baseSource, {
      filename: "/synthetic/generation-mask.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("retains an unmasked sibling reset independently", () => {
    const fixture = cases.find((candidate) => candidate.name === "sibling-state-unmasked");
    if (!fixture) throw new Error("Missing sibling-state fixture");
    const result = runRule(noAdjustStateOnPropChange, fixture.source, {
      filename: "/synthetic/generation-mask.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("retains a raw read even when a generation-like mask also exists", () => {
    const fixture = cases.find((candidate) => candidate.name === "one-extra-raw-read");
    if (!fixture) throw new Error("Missing raw-state fixture");
    const result = runRule(noAdjustStateOnPropChange, fixture.source, {
      filename: "/synthetic/generation-mask.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
