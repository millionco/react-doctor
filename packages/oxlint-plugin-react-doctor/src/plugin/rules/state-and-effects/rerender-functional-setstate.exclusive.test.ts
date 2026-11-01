import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderFunctionalSetstate } from "./rerender-functional-setstate.js";
const cases = [
  {
    name: "exclusive constant siblings",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "both branches read real state",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(count + 1); else setCount(count + 2); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 2,
  },
  {
    name: "two updates on the same path",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else {setCount(count + 1);setCount(count + 2);} }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 2,
  },
  {
    name: "constant before the focal call",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { setCount(0);setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "unknown sibling value",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(otherValue); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "nonprimitive sibling value",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(/expression/); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "negative literal syntax deferred",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(-1); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "null constant sibling",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(null); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "extra focal work",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else {notify();setCount(count + 1);} }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "call in focal value",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + getStep()); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "call in ancestor test",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (readMode(event)) setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "loop on focal path",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else {for (const item of values) setCount(count + 1);} }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "switch on focal path",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else {switch(event.key){default:setCount(count + 1);}} }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "try on focal path",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else {try {setCount(count + 1);} finally {}} }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "labeled focal path",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else {label:setCount(count + 1);} }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "looped sibling deferred",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") {for(const item of values)setCount(0);} else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "switch sibling deferred",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") {switch(event.key){default:setCount(0);}} else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "nested sibling callback deferred",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") {const reset=()=>setCount(0);} else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "escaped handler",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; consume(handleKey); return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "handler alias",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; const alias=handleKey; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "handler direct invocation",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; handleKey(event); return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "handler reassignment",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; handleKey=other; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "mutable handler binding",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); let handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "default handler parameter",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event=defaultEvent) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "rest handler parameter",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (...event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "async handler deferred",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = async (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "custom consumer",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <Control onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "unknown intrinsic",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <control onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "overridden event attribute",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} onKeyDown={other} value={count} />; };',
    expected: 1,
  },
  {
    name: "unknown later spread",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} {...other} value={count} />; };',
    expected: 1,
  },
  {
    name: "known unrelated later spread",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} {...{title:"Counter"}} value={count} />; };',
    expected: 0,
  },
  {
    name: "earlier spread is overridden",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input {...other} onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "setter alias escape",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const alias=setCount; const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "setter argument escape",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); expose(setCount); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "setter direct reassignment",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); setCount=other; const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "shadowed sibling setter",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") {const setCount=other;setCount(0);} else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "update expression remains legacy",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count++); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "actual shaped disjoint branch work",
    code: 'import React from "react"; export const Entry = () => {const [mode,setMode]=React.useState("input");const [text,setText]=React.useState("");const handleEntry=(event)=>{if(mode==="browse"){switch(event.key){case "x":setMode("input");break;}}else if(mode==="input"){if(event.key==="Done"){complete(text);setText("");setMode("browse");}else if(event.key==="Reset"){setText("");setMode("browse");}else{setText(text+event.key);}}};return <div onKeyDown={handleEntry}>{text}</div>;};',
    expected: 0,
  },
  {
    name: "opaque coercible value remains warned",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + step); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "literal object coercion remains warned",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + {valueOf(){reenter();return 1;}}); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "getter operand remains warned",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + steps.next); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "unknown event property remains unsupported",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + event.detail); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "computed event key remains unsupported",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + event["key"]); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "object state initializer remains warned",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState({valueOf(){reenter();return 1;}}); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "lazy state initializer remains unsupported",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(()=>0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "opaque state initializer remains unsupported",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(seed); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "coercive comparison remains unsupported",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key == "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "relational comparison remains unsupported",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key < "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "logical comparison remains unsupported",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home" && enabled) setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "nested getter condition remains unsupported",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.target.kind === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "computed event test remains unsupported",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event["key"] === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "foreign getter condition remains warned",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (flags.current === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "event key mutation remains warned",
    code: 'import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") {event.key=coercible;setCount(0);} else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "visible React state provider replacement",
    code: 'import React from "react"; const nativeUseState=React.useState;React.useState=(seed)=>nativeUseState({valueOf(){notify();return seed;}}); export const Counter = () => { const [count, setCount] = React.useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "React namespace escape retains legacy",
    code: 'import React from "react"; expose(React);export const Counter = () => { const [count, setCount] = React.useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "type only state import unsupported",
    code: 'import type { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "unbound global React unsupported",
    code: ' export const Counter = () => { const [count, setCount] = React.useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "canonical namespace import supported",
    code: 'import * as React from "react"; export const Counter = () => { const [count, setCount] = React.useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "React type references preserve runtime proof",
    code: 'import React from "react"; export const Counter: React.FC = () => { const [count, setCount] = React.useState(0); const handleKey = (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "canonical commonjs exposure unsupported",
    code: 'import { useState } from "react"; const otherReact=require("react");otherReact.useState=unknownHook;export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "provider pattern write retains legacy",
    code: 'import React from "react"; ({hook:React.useState}=other);export const Counter = () => { const [count, setCount] = React.useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "provider loop write retains legacy",
    code: 'import React from "react"; for(React.useState of hooks){}export const Counter = () => { const [count, setCount] = React.useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "named state import escape retains legacy",
    code: 'import { useState } from "react"; expose(useState);export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "global React carrier exposure unsupported",
    code: 'import { useState } from "react"; window.React.useState=unknownHook;export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "genuine eval can replace lexical React state provider",
    code: 'import React from "react"; eval("const actual = React.useState; React.useState = (initial) => actual({valueOf(){notify();return initial;}})");export const Counter = () => { const [count, setCount] = React.useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "global Function exposure remains unsupported",
    code: 'import { useState } from "react"; Function("return 0");export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "global eval projection remains unsupported",
    code: 'import { useState } from "react"; globalThis.eval("anything");export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "global Function projection remains unsupported",
    code: 'import { useState } from "react"; window.Function("return 0");export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "type only global eval reference is harmless",
    code: 'import { useState } from "react"; type Evaluator = typeof eval;export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "local Function binding is distinct from native",
    code: 'import { useState } from "react"; const Function=(_source)=>null;Function("ignored");export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "local eval named method is distinct from native",
    code: 'import { useState } from "react"; const tooling={eval:(_source)=>null};tooling.eval("ignored");export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "static constructor execution carrier unsupported",
    code: 'import { useState } from "react"; const compile=(()=>{}).constructor;compile("return 0");export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "destructured constructor carrier unsupported",
    code: 'import { useState } from "react"; const {constructor:compile}=(()=>{});compile("return 0");export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "global require alias unsupported",
    code: 'import { useState } from "react"; const load=require;load("react").useState=()=>null;export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "global module loader exposure unsupported",
    code: 'import { useState } from "react"; const load=module.require;load("react").useState=()=>null;export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "shadowed require is not global loader",
    code: 'import { useState } from "react"; const require=(_name)=>null;require("local");export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "shadowed module is not global loader",
    code: 'import { useState } from "react"; const module={read:()=>null};module.read();export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "type-only require exposure ignored",
    code: 'import { useState } from "react"; type Loader=typeof require;export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "native module loader import unsupported",
    code: 'import { useState } from "react"; import {createRequire} from "node:module";const load=createRequire(import.meta.url);load("react").useState=()=>null;export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "native legacy module loader import unsupported",
    code: 'import { useState } from "react"; import {createRequire} from "module";const load=createRequire(import.meta.url);load("react").useState=()=>null;export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "type-only native module import ignored",
    code: 'import { useState } from "react"; import type {Module} from "node:module";type Loader=Module;export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "literal dynamic builtin loader unsupported",
    code: 'import { useState } from "react"; import("node:module").then(({createRequire})=>{createRequire(import.meta.url)("react").useState=()=>null;});export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
];
const options = {
  filename: "src/components/counter.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: {
    "react-doctor": {
      capabilities: ["react", "react:19"],
      portedRuleMode: "curated",
    },
  },
};
describe("exclusive constant setter siblings", () => {
  for (const { name, code, expected } of cases) {
    it(name, () => {
      const result = runRule(rerenderFunctionalSetstate, code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    });
  }
});
