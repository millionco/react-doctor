import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

const cases = [
  {
    name: "plain-invoked-async-control",
    code: 'import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); useEffect(() => { const update = async () => { await Promise.resolve(value); writeText(value); }; update(); }, [value]); return <output>{text}</output>; };\n',
    expected: 1,
  },
  {
    name: "native-transition-async-action",
    code: 'import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 1,
  },
  {
    name: "aliased-named-transition-import",
    code: 'import { useEffect, useState, useTransition as useUiTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, begin] = useUiTransition(); useEffect(() => { begin(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 1,
  },
  {
    name: "namespace-transition-provider",
    code: 'import * as React from "react";\nexport const Example = ({value}) => { const [text, writeText] = React.useState(""); const [pending, begin] = React.useTransition(); React.useEffect(() => { begin(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 1,
  },
  {
    name: "foreign-lookalike-transition",
    code: 'import { useEffect, useState } from "react";\nimport { useTransition } from "foreign-ui";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, begin] = useTransition(); useEffect(() => { begin(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "type-only-transition-provider",
    code: 'import { useEffect, useState } from "react";\nimport type { useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, begin] = useTransition(); useEffect(() => { begin(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "reassigned-transition-tuple-member",
    code: 'import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value, other}) => { const [text, writeText] = useState(""); let [pending, begin] = useTransition(); begin = other; useEffect(() => { begin(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "transition-ref-alias",
    code: 'import { useEffect, useRef, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, begin] = useTransition(); const transitionRef = useRef(begin); useEffect(() => { transitionRef.current(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "ordinary-event-action-outside-effect",
    code: 'import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, begin] = useTransition(); const onClick = () => { begin(async () => { await Promise.resolve(value); writeText(value); }); }; useEffect(() => {}, [value]); return <button onClick={onClick}>{pending ? "waiting" : text}</button>; };\n',
    expected: 0,
  },
  {
    name: "transition-action-cleanup-guard",
    code: 'import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, begin] = useTransition(); useEffect(() => { let cancelled = false; begin(async () => { await Promise.resolve(value); if (cancelled) return; writeText(value); }); return () => { cancelled = true; }; }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "transition-action-empty-deps",
    code: 'import { useEffect, useState, useTransition } from "react";\nexport const Example = () => { const [text, writeText] = useState(""); const [pending, begin] = useTransition(); useEffect(() => { begin(async () => { await Promise.resolve("ready"); writeText("ready"); }); }, []); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "source-visible-provider-exposure",
    code: 'import { useEffect, useState, useTransition } from "react";\nexpose(useTransition);\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, begin] = useTransition(); useEffect(() => { begin(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "native-default-import",
    code: 'import React from "react";\nexport const Example=({value})=>{const [text,writeText]=React.useState("");const [pending,begin]=React.useTransition();React.useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "effect-named-alias",
    code: 'import {useEffect as effect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();effect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "inline-async-function",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async function(){await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "transparent-callee-and-action",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{((begin as typeof begin))(((async()=>{await Promise.resolve(value);writeText(value);}) as ()=>Promise<void>));},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "safe-noop-prologue",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{;0;void 0;begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "cancellation-guard",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{let cancelled=false;begin(async()=>{await Promise.resolve(value);if(cancelled)return;writeText(value);});return()=>{cancelled=true;};},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "unknown-conditional-native-call",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{if(value)begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "dead-conditional-native-call",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{if(false)begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "dead-helper-transport",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{const update=()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});};if(false)update();},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "invoked-helper-transport-deferred",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{const update=()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});};update();},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "uninvoked-helper",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{const update=()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});};},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "after-early-return",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{return;begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "after-loop",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{while(value){}begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "after-unknown-call",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{prepare();begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "concise-effect-deferred",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>begin(async()=>{await Promise.resolve(value);writeText(value);}),[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "returned-action-call-deferred",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{return begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "conditional-effect-registration",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();if(false)useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "named-action-callback",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{const update=async()=>{await Promise.resolve(value);writeText(value);};begin(update);},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "named-function-expression-action",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async function update(){await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "parameter-action",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async (event)=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "default-parameter-action",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async (event=0)=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "rest-parameter-action",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async (...events)=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "destructured-parameter-action",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async ({event})=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "async-generator-action",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async function*(){await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "synchronous-promise-action",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(()=>{Promise.resolve(value).then(writeText);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "async-action-without-await",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "optional-call",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin?.(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "call-method",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin.call(null,async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "spread-action",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(...[async()=>{await Promise.resolve(value);writeText(value);}]);},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "additional-argument",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);},undefined);},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "tuple-alias-escape",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);const alias=begin;return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "tuple-argument-escape",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);expose(begin);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "tuple-member-write",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);begin.metadata=true;return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "tuple-pattern-write",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);({begin}=props);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "tuple-for-write",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);for(begin of callbacks){}return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "wrong-tuple-position",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [begin,pending]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "defaulted-tuple-position",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin=()=>{}]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "rest-tuple-position",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,...begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "extra-tuple-position",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin,extra]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "tuple-hole-deferred",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{text}</output>;};',
    expected: 0,
  },
  {
    name: "hook-arguments-deferred",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition(value);useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "local-provider-shadow",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value,useTransition})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "effect-provider-shadow",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value,useEffect})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "state-provider-shadow",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value,useState})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "named-react-provider-write",
    code: 'import {useEffect,useState,useTransition} from "react";\nuseTransition=other;\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "react-namespace-provider-write",
    code: 'import * as React from "react";\nReact.useTransition=other;\nexport const Example=({value})=>{const [text,writeText]=React.useState("");const [pending,begin]=React.useTransition();React.useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "react-provider-argument-escape",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(useTransition);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "react-namespace-argument-escape",
    code: 'import * as React from "react";\nexpose(React);\nexport const Example=({value})=>{const [text,writeText]=React.useState("");const [pending,begin]=React.useTransition();React.useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "array-iterator-replacement",
    code: 'import {useEffect,useState,useTransition} from "react";\nArray.prototype[Symbol.iterator]=function*(){yield false;yield()=>{};};\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "array-alias-exposure",
    code: 'import {useEffect,useState,useTransition} from "react";\nconst NativeArray=Array;expose(NativeArray);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "symbol-alias-exposure",
    code: 'import {useEffect,useState,useTransition} from "react";\nconst NativeSymbol=Symbol;expose(NativeSymbol);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "global-array-exposure",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(globalThis.Array);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "global-symbol-exposure",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(window.Symbol);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "global-object-escape",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(globalThis);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "global-object-alias",
    code: 'import {useEffect,useState,useTransition} from "react";\nconst host=globalThis;\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "dynamic-global-projection",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(globalThis[key]);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "optional-global-projection",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(globalThis?.console);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "shadow-array-symbol",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value,Array,Symbol})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);void Array;void Symbol;return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "shadow-global-object",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value,globalThis})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);expose(globalThis);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "type-only-provider-names",
    code: 'import {useEffect,useState,useTransition} from "react";\nimport type {Array,Symbol} from "./types";\ntype Shapes=[Array,Symbol];\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "ordinary-static-global-read",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);window.console.log("visible");return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "object-provider-exposure",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(Object);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "reflect-provider-exposure",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(Reflect);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "dynamic-eval",
    code: 'import {useEffect,useState,useTransition} from "react";\neval("work");\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "function-constructor",
    code: 'import {useEffect,useState,useTransition} from "react";\nconst compile=Function;\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "constructor-projection",
    code: 'import {useEffect,useState,useTransition} from "react";\nconst compile=(()=>{}).constructor;\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "prototype-projection",
    code: 'import {useEffect,useState,useTransition} from "react";\nconst prototype=({}).__proto__;\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "dynamic-import",
    code: 'import {useEffect,useState,useTransition} from "react";\nvoid import("./other");\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "shadow-object-reflect",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value,Object,Reflect})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);void Object;void Reflect;return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "legacy-direct-positive-with-provider-exposure",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(Object);export const Example=({value})=>{const[text,writeText]=useState("");useEffect(()=>{const run=async()=>{await Promise.resolve(value);writeText(value);};run();},[value]);return <output>{text}</output>;};',
    expected: 1,
  },
  {
    name: "legacy-direct-positive-with-array-exposure",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(Array);export const Example=({value})=>{const[text,writeText]=useState("");useEffect(()=>{const run=async()=>{await Promise.resolve(value);writeText(value);};run();},[value]);return <output>{text}</output>;};',
    expected: 1,
  },
  {
    name: "type-only-effect-declaration",
    code: 'import {useState,useTransition} from "react"; import type {useEffect} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "type-only-effect-specifier",
    code: 'import {useState,useTransition,type useEffect} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "type-only-effect-namespace",
    code: 'import {useState,useTransition} from "react"; import type * as Effects from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();Effects.useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "type-only-effect-default",
    code: 'import {useState,useTransition} from "react"; import type Effects from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();Effects.useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "foreign-effect-provider",
    code: 'import {useState,useTransition} from "react"; import {useEffect} from "foreign-effects";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "canonical-effect-alias",
    code: 'import {useEffect as onEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();onEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "canonical-layout-effect",
    code: 'import {useLayoutEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useLayoutEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "canonical-effect-namespace",
    code: 'import {useState,useTransition} from "react"; import * as Effects from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();Effects.useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "canonical-effect-default",
    code: 'import {useState,useTransition} from "react"; import Effects from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();Effects.useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "nested-frame-array-replacement",
    code: 'import {useEffect,useState,useTransition} from "react";\nwindow.frames.Array.prototype[window.frames.Symbol.iterator]=function*(){yield false;yield ()=>{};};\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "nested-global-window-array-replacement",
    code: 'import {useEffect,useState,useTransition} from "react";\nglobalThis.window.Array.prototype[globalThis.window.Symbol.iterator]=function*(){yield false;yield ()=>{};};\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "nested-self-array-replacement",
    code: 'import {useEffect,useState,useTransition} from "react";\nself.self.Array.prototype[self.self.Symbol.iterator]=function*(){yield false;yield ()=>{};};\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "nested-frame-const-alias",
    code: 'import {useEffect,useState,useTransition} from "react";\nconst host=window;host.frames.Array.prototype[host.frames.Symbol.iterator]=function*(){yield false;yield ()=>{};};\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "nested-frame-transparent-wrapper",
    code: 'import {useEffect,useState,useTransition} from "react";\n(window as Window).frames.Array.prototype[(window as Window).frames.Symbol.iterator]=function*(){yield false;yield ()=>{};};\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "parent-carrier",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(window.parent);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "top-carrier",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(window.top);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "opener-carrier",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(window.opener);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "global-self-carrier",
    code: 'import {useEffect,useState,useTransition} from "react";\nexpose(globalThis.global);\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "shadow-window-frame-counterpart",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value,window})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();window.frames.Array.prototype[window.frames.Symbol.iterator]=replacement;useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "type-only-frame-carrier",
    code: 'import {useEffect,useState,useTransition} from "react";\ntype FrameArray=typeof window.frames.Array; type WindowArray=typeof globalThis.window.Array;\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "ordinary-console-read-preserved",
    code: 'import {useEffect,useState,useTransition} from "react";\nwindow.console.log("ordinary");\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "generator-effect-frame",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(function*(){begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "async-effect-frame",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(async()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "destructured-effect-parameter",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(({value})=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "default-effect-parameter",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect((input=throwBeforeAction())=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "rest-effect-parameter",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect((...inputs)=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "plain-effect-parameter",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect((input)=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "ordinary-function-effect-frame",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();useEffect(function(){begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
  {
    name: "effect-registration-after-owner-return",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();return <output>{text}</output>;useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "effect-registration-after-owner-throw",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();throw new Error("not mounted");useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 0,
  },
  {
    name: "reachable-effect-registration-with-literal-owner-local",
    code: 'import {useEffect,useState,useTransition} from "react";\nexport const Example=({value})=>{const [text,writeText]=useState("");const [pending,begin]=useTransition();const marker="ready";useEffect(()=>{begin(async()=>{await Promise.resolve(value);writeText(value);});},[value]);return <output>{pending ? "waiting" : text}</output>;};',
    expected: 1,
  },
];

describe("native transition effect Actions", () => {
  it.each(cases)("$name", ({ code, expected }) => {
    const result = runRule(noSetStateAfterAwaitInEffect, code, {
      filename: "fixture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": { capabilities: ["react", "react:19"], portedRuleMode: "curated" },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
