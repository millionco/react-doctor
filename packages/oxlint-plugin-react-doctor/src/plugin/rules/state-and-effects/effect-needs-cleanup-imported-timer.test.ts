import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface ImportedTimerLifetimeCase {
  readonly name: string;
  readonly expected: number;
  readonly source?: string;
  readonly producer?: string;
  readonly files?: Readonly<Record<string, string>>;
}

const IMPORTED_TIMER_SOURCE =
  'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};';
const IMPORTED_TIMER_CLASS_SOURCE =
  "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.ticket);}\n begin(){this.ticket=setTimeout(this.work,this.period);}\n}";
const timerLifetimeCases: ReadonlyArray<ImportedTimerLifetimeCase> = [
  {
    name: "reports a private imported timeout class stored in own state",
    expected: 1,
  },
  {
    name: "reports finite native Date bookkeeping with transparent handle casts",
    expected: 1,
    producer:
      "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private started:Date|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.ticket);this.period-=new Date().getTime()-(<Date>this.started).getTime();}\n begin(){this.started=new Date();clearTimeout(<ReturnType<typeof setTimeout>>this.ticket);this.ticket=setTimeout(this.work,this.period) as unknown as ReturnType<typeof setTimeout>;}\n}",
  },
  {
    name: "ignores unrelated exported data helpers in the class module",
    expected: 1,
    producer:
      "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.ticket);}\n begin(){this.ticket=setTimeout(this.work,this.period);}\n}\nexport const copy=(value)=>value;",
  },
  {
    name: "infers class method and field roles by source identity",
    expected: 1,
    source:
      'import {useEffect,useState} from "react";\nimport {Alarm} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setAlarm]=useState<Alarm|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Alarm(delay,()=>notify());\n   created.ignite();\n   setAlarm(created);\n  }else if(clock && !delay){clock.quench();setAlarm(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.quench():undefined} onMouseLeave={clock?()=>clock.ignite():undefined}/>;\n};',
    producer:
      "export class Alarm {\n private token: ReturnType<typeof setTimeout>|undefined;\n private finish:()=>void;\n duration:number;\n constructor(delay:number,callback:()=>void){this.duration=delay;this.finish=callback;}\n quench(){clearTimeout(this.token);}\n ignite(){this.token=setTimeout(this.finish,this.duration);}\n}",
  },
  {
    name: "keeps an unrelated notification cleanup independent",
    expected: 1,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n useEffect(()=>()=>{if(notify)notify();},[]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines selected state read in another effect cleanup",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n useEffect(()=>()=>clock?.stop(),[clock]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines selected state guarded in another cleanup",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n useEffect(()=>()=>{if(clock)clock.stop();},[clock]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines returned cleanup in the selected effect",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n return ()=>clock?.stop();\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines a synchronous stop in the creation block",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n   created.stop();\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "does not credit a distinct instance cancellation",
    expected: 1,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const other=new Clock(50,()=>{});\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n other.stop();\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines constructor side effects",
    expected: 0,
    producer:
      "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){notify();this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.ticket);}\n begin(){this.ticket=setTimeout(this.work,this.period);}\n}",
  },
  {
    name: "declines callback null before native allocation",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,null);\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines a known object delay source",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({notify})=>{\n const delay={valueOf(){throw new Error("unavailable")}};\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines async scheduling",
    expected: 0,
    producer:
      "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.ticket);}\n async begin(){this.ticket=setTimeout(this.work,this.period);}\n}",
  },
  {
    name: "declines a schedule cancelled before returning",
    expected: 0,
    producer:
      "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.ticket);}\n begin(){this.ticket=setTimeout(this.work,this.period);clearTimeout(this.ticket);}\n}",
  },
  {
    name: "declines an overwritten native timeout provider",
    expected: 0,
    files: {
      "providers.ts": "globalThis.setTimeout=()=>0;",
    },
  },
  {
    name: "declines a Date prototype method replacement",
    expected: 0,
    producer:
      "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private started:Date|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.ticket);this.period-=new Date().getTime()-(<Date>this.started).getTime();}\n begin(){this.started=new Date();clearTimeout(<ReturnType<typeof setTimeout>>this.ticket);this.ticket=setTimeout(this.work,this.period) as unknown as ReturnType<typeof setTimeout>;}\n}",
    files: {
      "providers.ts": "Date.prototype.getTime=()=>0;",
    },
  },
  {
    name: "declines an imported class prototype replacement",
    expected: 0,
    files: {
      "providers.ts": 'import {Clock} from "./clock";Clock.prototype.begin=()=>{};',
    },
  },
  {
    name: "declines an extracted selected instance method",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n const launch=clock?.begin;\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines an opaque selected state update",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n setClock(acquire());\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines a reflected protected handle replacement",
    expected: 0,
    files: {
      "providers.ts": 'Object.defineProperty(Object.prototype,"ticket",{set(value){}});',
    },
  },
  {
    name: "declines a selected class reexport",
    expected: 0,
    files: {
      "index.ts": 'export {Clock} from "./clock";',
    },
  },
  {
    name: "declines cancellation of a different handle slot",
    expected: 0,
    producer:
      "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private alternate:ReturnType<typeof setTimeout>|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.alternate);}\n begin(){this.ticket=setTimeout(this.work,this.period);}\n}",
  },
  {
    name: "accepts a finite unrelated window data shim",
    expected: 1,
    files: {
      "setup.ts":
        'Object.defineProperty(window,"resizeTo",{value:function(width,height){Object.assign(this,{innerWidth:width,innerHeight:height});}});',
    },
  },
  {
    name: "accepts an unrelated exported literal enum",
    expected: 1,
    files: {
      "constants.ts": 'export enum Phase{Ready="ready",Idle="idle"}',
    },
  },
  {
    name: "declines executable runtime enum initializers",
    expected: 0,
    files: {
      "constants.ts": "export enum Phase{Ready=(globalThis.setTimeout=()=>0)}",
    },
  },
  {
    name: "declines a visible selected module mock",
    expected: 0,
    files: {
      "mock.ts": 'jest.mock("./clock",()=>({Clock:class{begin(){}stop(){}}}));',
    },
  },
  {
    name: "declines a mixed React state provider replacement",
    expected: 0,
    files: {
      "provider.ts": 'import React from "react";React.useState=()=>[null,()=>{}];',
    },
  },
  {
    name: "declines an additional runtime constructor export alias",
    expected: 0,
    producer:
      "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.ticket);}\n begin(){this.ticket=setTimeout(this.work,this.period);}\n}\nexport {Clock as Alternate};",
    files: {
      "other.ts": 'import {Alternate} from "./clock";Alternate.prototype.begin=()=>{};',
    },
  },
  {
    name: "retains an imported local constructor alias",
    expected: 1,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock as Alarm} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Alarm|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Alarm(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "keeps a type-only constructor alias erased",
    expected: 1,
    producer:
      "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.ticket);}\n begin(){this.ticket=setTimeout(this.work,this.period);}\n}\nexport type {Clock as ClockView};",
  },
  {
    name: "declines a known coercive parameter default",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay={valueOf(){throw new Error("blocked")}},notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "preserves observed parenthesized call receivers case 0",
    expected: 1,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   ;(created).begin();\n   setClock(created);\n  }else if(clock && !delay){;(clock).stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>(clock).stop():undefined} onMouseLeave={clock?()=>(clock).begin():undefined}/>;\n};',
  },
  {
    name: "preserves observed as-any call receivers case 93",
    expected: 1,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=(props)=>{\n const {settings,notify}=props;\n const {delay}=settings;\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   ;(created as any).begin();\n   setClock(created);\n  }else if(clock && !delay){;(clock as any).stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>(clock as any).stop():undefined} onMouseLeave={clock?()=>(clock as any).begin():undefined}/>;\n};',
  },
  {
    name: "preserves observed non-null-asserted call receivers case 50",
    expected: 1,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const clock=new Clock(delay,()=>notify());\n   ;(clock!).begin();\n   setClock(clock);\n  }else if(clock && !delay){;(clock!).stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>(clock!).stop():undefined} onMouseLeave={clock?()=>(clock!).begin():undefined}/>;\n};',
  },
  {
    name: "preserves observed concise arrow bodies converted to block returns case 15",
    expected: 1,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>{ return (notify()); });\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n useEffect(()=>{ return (()=>{if(notify)notify();}); },[]);\n return <div onMouseEnter={clock?()=>{ return (clock.stop()); }:undefined} onMouseLeave={clock?()=>{ return (clock.begin()); }:undefined}/>;\n};',
  },
  {
    name: "declines real extra work in the allocation block",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   synchronize();\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines literal void work rather than dropping it as empty syntax",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   void 0;\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines an effectful event block before a returned method call",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>{synchronize();return clock.stop();}:undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines returned method extraction",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   created.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>{return clock.begin;}:undefined}/>;\n};',
  },
  {
    name: "declines optional acquisition through a wrapped receiver",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   (created as any)?.begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines computed acquisition through a wrapped receiver",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   (created as any)["begin"]();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "declines a different wrapped receiver with the same method name",
    expected: 0,
    source:
      'import {useEffect,useState} from "react";\nimport {Clock} from "./clock";\nexport const Status=({delay,notify})=>{\n const [clock,setClock]=useState<Clock|null>(null);\n useEffect(()=>{\n  if(!clock && delay && delay>0){\n   const created=new Clock(delay,()=>notify());\n   (clock as any).begin();\n   setClock(created);\n  }else if(clock && !delay){clock.stop();setClock(null);}\n },[delay]);\n return <div onMouseEnter={clock?()=>clock.stop():undefined} onMouseLeave={clock?()=>clock.begin():undefined}/>;\n};',
  },
  {
    name: "accepts a standard base URL without React runtime aliases",
    expected: 1,
    files: {
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "moduleResolution": "node", "baseUrl": "./"}}',
    },
  },
  {
    name: "accepts literal external CommonJS configuration data exports",
    expected: 1,
    files: {
      "configuration.js":
        'const settings=require("ordinary-lint-data");module.exports={settings};exports.additional={enabled:true};const present=typeof module==="object"&&typeof exports==="object";',
    },
  },
  {
    name: "accepts bounded module export data fields",
    expected: 1,
    files: {
      "configuration.js": "module.exports={};module.exports.rules={enabled:true};",
    },
  },
  {
    name: "declines a resolved react alias",
    expected: 0,
    files: {
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "moduleResolution": "node", "baseUrl": "./", "paths": {"react": ["./fake-react.ts"]}}}',
      "fake-react.ts":
        "export const useEffect=()=>{};export const useState=()=>[];export const jsx=()=>null;export const jsxs=()=>null;",
    },
  },
  {
    name: "declines a resolved react/jsx-runtime alias",
    expected: 0,
    files: {
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "moduleResolution": "node", "baseUrl": "./", "paths": {"react/jsx-runtime": ["./fake-react.ts"]}}}',
      "fake-react.ts":
        "export const useEffect=()=>{};export const useState=()=>[];export const jsx=()=>null;export const jsxs=()=>null;",
    },
  },
  {
    name: "declines a resolved react/jsx-dev-runtime alias",
    expected: 0,
    files: {
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "moduleResolution": "node", "baseUrl": "./", "paths": {"react/jsx-dev-runtime": ["./fake-react.ts"]}}}',
      "fake-react.ts":
        "export const useEffect=()=>{};export const useState=()=>[];export const jsx=()=>null;export const jsxs=()=>null;",
    },
  },
  {
    name: "declines a relative CommonJS loader",
    expected: 0,
    files: {
      "configuration.js": 'const settings=require("./clock");module.exports=settings;',
    },
  },
  {
    name: "declines a dynamic CommonJS loader",
    expected: 0,
    files: {
      "configuration.js": "const settings=require(selectedSource);module.exports=settings;",
    },
  },
  {
    name: "declines a computed require capability",
    expected: 0,
    files: {
      "configuration.js": 'require["resolve"]("ordinary-lint-data");',
    },
  },
  {
    name: "declines a module loader member",
    expected: 0,
    files: {
      "configuration.js": 'module.require("ordinary-lint-data");',
    },
  },
  {
    name: "declines raw module transport",
    expected: 0,
    files: {
      "configuration.js": "observe(module);",
    },
  },
  {
    name: "declines raw exports transport",
    expected: 0,
    files: {
      "configuration.js": "observe(exports);",
    },
  },
  {
    name: "declines an export constructor capability",
    expected: 0,
    files: {
      "configuration.js": "const construct=module.exports.constructor;",
    },
  },
  {
    name: "declines a TypeScript alias used by CommonJS loading",
    expected: 0,
    files: {
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "moduleResolution": "node", "baseUrl": "./", "paths": {"tooling-data": ["./clock.ts"]}}}',
      "configuration.ts": 'const settings=require("tooling-data");module.exports=settings;',
    },
  },
  {
    name: "declines CommonJS vm capability",
    expected: 0,
    files: {
      "configuration.js": 'const loader=require("vm");module.exports=loader;',
    },
  },
  {
    name: "declines ESM vm capability",
    expected: 0,
    files: {
      "configuration.ts": 'import loader from "vm";export const configuration=loader;',
    },
  },
  {
    name: "declines CommonJS node:vm capability",
    expected: 0,
    files: {
      "configuration.js": 'const loader=require("node:vm");module.exports=loader;',
    },
  },
  {
    name: "declines ESM node:vm capability",
    expected: 0,
    files: {
      "configuration.ts": 'import loader from "node:vm";export const configuration=loader;',
    },
  },
  {
    name: "declines CommonJS module capability",
    expected: 0,
    files: {
      "configuration.js": 'const loader=require("module");module.exports=loader;',
    },
  },
  {
    name: "declines ESM module capability",
    expected: 0,
    files: {
      "configuration.ts": 'import loader from "module";export const configuration=loader;',
    },
  },
  {
    name: "declines CommonJS node:module capability",
    expected: 0,
    files: {
      "configuration.js": 'const loader=require("node:module");module.exports=loader;',
    },
  },
  {
    name: "declines ESM node:module capability",
    expected: 0,
    files: {
      "configuration.ts": 'import loader from "node:module";export const configuration=loader;',
    },
  },
  {
    name: "declines dynamic VM capability import",
    expected: 0,
    files: {
      "configuration.ts": 'void import("node:vm");',
    },
  },
  {
    name: "declines an erased declaration hiding module capability",
    expected: 0,
    files: {
      "configuration.ts": 'declare const module:any;module.require("node:vm");',
    },
  },
  {
    name: "declines selected constructor escape through CommonJS exports",
    expected: 0,
    producer:
      "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.ticket);}\n begin(){this.ticket=setTimeout(this.work,this.period);}\n}\nmodule.exports=Clock;",
  },
  {
    name: "declines a proven webpack react replacement",
    expected: 0,
    files: {
      "package.json":
        '{"dependencies": {"react": "19.2.3"}, "devDependencies": {"webpack": "^3.10.0", "webpack-merge": "^4.1.1"}, "scripts": {"build": "webpack --config ./webpack.config.js --progress"}}',
      "webpack.config.js":
        'const path=require("path");const config={resolve:{extensions:[".js",".jsx"],alias:{"react$":path.resolve(__dirname,"./fake-react.ts")}}};module.exports=config;',
      "fake-react.ts":
        "export const useEffect=()=>{};export const useState=()=>[];export const jsx=()=>null;",
    },
  },
  {
    name: "declines a proven webpack react/jsx-runtime replacement",
    expected: 0,
    files: {
      "package.json":
        '{"dependencies": {"react": "19.2.3"}, "devDependencies": {"webpack": "^3.10.0", "webpack-merge": "^4.1.1"}, "scripts": {"build": "webpack --config ./webpack.config.js --progress"}}',
      "webpack.config.js":
        'const path=require("path");const config={resolve:{extensions:[".js",".jsx"],alias:{"react/jsx-runtime$":path.resolve(__dirname,"./fake-react.ts")}}};module.exports=config;',
      "fake-react.ts":
        "export const useEffect=()=>{};export const useState=()=>[];export const jsx=()=>null;",
    },
  },
  {
    name: "declines a proven webpack react/jsx-dev-runtime replacement",
    expected: 0,
    files: {
      "package.json":
        '{"dependencies": {"react": "19.2.3"}, "devDependencies": {"webpack": "^3.10.0", "webpack-merge": "^4.1.1"}, "scripts": {"build": "webpack --config ./webpack.config.js --progress"}}',
      "webpack.config.js":
        'const path=require("path");const config={resolve:{extensions:[".js",".jsx"],alias:{"react/jsx-dev-runtime$":path.resolve(__dirname,"./fake-react.ts")}}};module.exports=config;',
      "fake-react.ts":
        "export const useEffect=()=>{};export const useState=()=>[];export const jsx=()=>null;",
    },
  },

  {
    name: "declines CommonJS React provider acquisition react",
    expected: 0,
    files: {
      "provider.js":
        'const RuntimeReact=require("react");RuntimeReact.useEffect=()=>{};RuntimeReact.useState=()=>[null,()=>{}];',
    },
  },
  {
    name: "declines CommonJS React provider acquisition react/jsx-runtime",
    expected: 0,
    files: {
      "provider.js":
        'const RuntimeReact=require("react/jsx-runtime");RuntimeReact.useEffect=()=>{};RuntimeReact.useState=()=>[null,()=>{}];',
    },
  },
  {
    name: "declines CommonJS React provider acquisition react/jsx-dev-runtime",
    expected: 0,
    files: {
      "provider.js":
        'const RuntimeReact=require("react/jsx-dev-runtime");RuntimeReact.useEffect=()=>{};RuntimeReact.useState=()=>[null,()=>{}];',
    },
  },
  {
    name: "declines CommonJS React provider acquisition react/cjs/react.development.js",
    expected: 0,
    files: {
      "provider.js":
        'const RuntimeReact=require("react/cjs/react.development.js");RuntimeReact.useEffect=()=>{};RuntimeReact.useState=()=>[null,()=>{}];',
    },
  },
  {
    name: "declines a selected class module.exports replacement",
    expected: 0,
    producer:
      "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.ticket);}\n begin(){this.ticket=setTimeout(this.work,this.period);}\n}\nmodule.exports={Clock:class{begin(){}stop(){}}};",
  },
  {
    name: "declines a selected exports constructor replacement",
    expected: 0,
    producer:
      "export class Clock {\n private ticket: ReturnType<typeof setTimeout>|undefined;\n private work:()=>void;\n period:number;\n constructor(delay:number,callback:()=>void){this.period=delay;this.work=callback;}\n stop(){clearTimeout(this.ticket);}\n begin(){this.ticket=setTimeout(this.work,this.period);}\n}\nexports.Clock=class{begin(){}stop(){}};",
  },

  {
    name: "declines tracked hook replacement through requireActual React",
    expected: 0,
    files: {
      "provider.ts": "const runtime=jest.requireActual('react');runtime.useEffect=()=>{};",
    },
  },
  {
    name: "declines tracked hook replacement through importActual React",
    expected: 0,
    files: {
      "provider.ts": "const runtime=await vi.importActual('react');runtime.useEffect=()=>{};",
    },
  },
  {
    name: "declines JSX runtime factory replacement",
    expected: 0,
    files: {
      "provider.ts": "jest.mock('react/jsx-runtime',()=>({jsx:()=>null,jsxs:()=>null}));",
    },
  },
  {
    name: "declines development JSX runtime factory replacement",
    expected: 0,
    files: {
      "provider.ts": "vi.mock('react/jsx-dev-runtime',()=>({jsxDEV:()=>null}));",
    },
  },
  {
    name: "declines selected class replacement through requireActual",
    expected: 0,
    files: {
      "provider.ts": "jest.requireActual('./clock').Clock.prototype.begin=()=>{};",
    },
  },
  {
    name: "declines selected class replacement through importActual",
    expected: 0,
    files: {
      "provider.ts":
        "const runtime=await vi.importActual('./clock');runtime.Clock.prototype.begin=()=>{};",
    },
  },
  {
    name: "preserves readonly actual React spread with only reducer override",
    expected: 1,
    files: {
      "provider.ts":
        "jest.mock('react',()=>{const runtime=jest.requireActual('react');return {...runtime,useReducer:jest.fn((reducer,initial)=>[initial,()=>{}])};});",
    },
  },
  {
    name: "declines tracked override in fresh React mock record",
    expected: 0,
    files: {
      "provider.ts":
        "jest.mock('react',()=>{const runtime=jest.requireActual('react');return {...runtime,useEffect:()=>{}};});",
    },
  },
  {
    name: "declines namespace write before otherwise harmless reducer override",
    expected: 0,
    files: {
      "provider.ts":
        "jest.mock('react',()=>{const runtime=jest.requireActual('react');runtime.useEffect=()=>{};return {...runtime,useReducer:jest.fn()};});",
    },
  },
  {
    name: "declines actual React namespace transport",
    expected: 0,
    files: {
      "provider.ts": "const runtime=jest.requireActual('react');external(runtime);",
    },
  },
  {
    name: "declines custom getter masquerading as actual React",
    expected: 0,
    files: {
      "provider.ts":
        "const custom={requireActual:()=>({})};jest.mock('react',()=>{const runtime=custom.requireActual('react');return {...runtime,useReducer:jest.fn()};});",
    },
  },
  {
    name: "declines shadowed test namespace in actual React mock",
    expected: 0,
    files: {
      "provider.ts":
        "const jest=custom; jest.mock('react',()=>{const runtime=jest.requireActual('react');return {...runtime,useReducer:()=>[]};});",
    },
  },
  {
    name: "declines reserved default override in fresh React mock",
    expected: 0,
    files: {
      "provider.ts":
        "jest.mock('react',()=>{const runtime=jest.requireActual('react');return {...runtime,default:{useEffect:()=>{}}};});",
    },
  },
  {
    name: "declines executable namespace spread getter",
    expected: 0,
    files: {
      "provider.ts":
        "jest.mock('react',()=>{const runtime=jest.requireActual('react');return {...runtime,get useReducer(){return custom}};});",
    },
  },
  {
    name: "preserves unrelated own actual-module getter",
    expected: 1,
    files: {
      "provider.ts": "jest.requireActual('./other');",
      "other.ts": "export const value=1;",
    },
  },

  {
    name: "declines extracted actual React getter alias",
    expected: 0,
    files: {
      "provider.ts":
        "const load=jest.requireActual;const runtime=load('react');runtime.useEffect=()=>{};",
    },
  },
  {
    name: "declines computed actual getter call transport",
    expected: 0,
    files: {
      "provider.ts":
        "const runtime=await vi['importActual'].call(vi,'react');runtime.useEffect=()=>{};",
    },
  },
  {
    name: "declines canonical runtime mock call transport",
    expected: 0,
    files: {
      "provider.ts": "jest.mock.call(jest,'react/jsx-runtime',()=>({jsx:()=>null,jsxs:()=>null}));",
    },
  },
  {
    name: "declines a constant computed actual React getter",
    expected: 0,
    files: {
      "provider.ts":
        "const method='requireActual';const runtime=jest[method]('react');runtime.useEffect=()=>{};",
    },
  },
  {
    name: "declines a constant computed runtime provider mock",
    expected: 0,
    files: {
      "provider.ts":
        "const method='mock';jest[method]('react/jsx-runtime',()=>({jsx:()=>null,jsxs:()=>null}));",
    },
  },
];
const temporaryRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-owned-clock-"));
afterAll(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

describe("effect-needs-cleanup imported timer instance lifetime", () => {
  for (const testCase of timerLifetimeCases) {
    it(testCase.name, () => {
      const directory = fs.mkdtempSync(path.join(temporaryRoot, "project-"));
      const source = testCase.source ?? IMPORTED_TIMER_SOURCE;
      const files = {
        "package.json": JSON.stringify({ dependencies: { react: "19.2.3" } }),
        "tsconfig.json": JSON.stringify({
          compilerOptions: { jsx: "react-jsx", moduleResolution: "node" },
        }),
        "entry.tsx": source,
        "clock.ts": testCase.producer ?? IMPORTED_TIMER_CLASS_SOURCE,
        ...testCase.files,
      };
      for (const [relativePath, body] of Object.entries(files))
        fs.writeFileSync(path.join(directory, relativePath), body);
      const result = runRule(effectNeedsCleanup, source, {
        filename: path.join(directory, "entry.tsx"),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  }
  it("invalidates a warm imported class after a method replacement", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "warm-"));
    const filename = path.join(directory, "entry.tsx");
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { react: "19.2.3" } }),
    );
    fs.writeFileSync(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { jsx: "react-jsx", moduleResolution: "node" } }),
    );
    fs.writeFileSync(filename, IMPORTED_TIMER_SOURCE);
    const producerPath = path.join(directory, "clock.ts");
    fs.writeFileSync(producerPath, IMPORTED_TIMER_CLASS_SOURCE);
    const before = runRule(effectNeedsCleanup, IMPORTED_TIMER_SOURCE, { filename });
    expect(before.parseErrors).toEqual([]);
    expect(before.diagnostics).toHaveLength(1);
    fs.appendFileSync(producerPath, "\nClock.prototype.begin=()=>{};");
    const after = runRule(effectNeedsCleanup, IMPORTED_TIMER_SOURCE, { filename });
    expect(after.parseErrors).toEqual([]);
    expect(after.diagnostics).toHaveLength(0);
  });
  it("keeps imported constructions outside the per-file dependency cache", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "dependencies-"));
    const filename = path.join(directory, "entry.tsx");
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { react: "19.2.3" } }),
    );
    fs.writeFileSync(filename, IMPORTED_TIMER_SOURCE);
    fs.writeFileSync(path.join(directory, "clock.ts"), IMPORTED_TIMER_CLASS_SOURCE);
    expect(
      collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: IMPORTED_TIMER_SOURCE,
        ruleIds: ["effect-needs-cleanup"],
      }),
    ).toBeNull();
  });
});
