import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hookUseState } from "./hook-use-state.js";

describe("hook-use-state closed literal freeze", () => {
  it.each([
    {
      name: "closed empty record",
      code: 'import {useState} from "react"; const snapshot=Object.freeze({}); const [retainedValue]=useState(snapshot);',
      expected: 0,
    },
    {
      name: "closed empty array",
      code: 'import {useState} from "react"; const snapshot=Object.freeze([]); const [retainedValue]=useState(snapshot);',
      expected: 0,
    },
    {
      name: "closed primitive record",
      code: "import {useState} from \"react\"; const snapshot=Object.freeze({mode:'ready',count:7,enabled:true,empty:null}); const [retainedValue]=useState(snapshot);",
      expected: 0,
    },
    {
      name: "closed primitive array",
      code: "import {useState} from \"react\"; const snapshot=Object.freeze(['ready',7,true,null]); const [retainedValue]=useState(snapshot);",
      expected: 0,
    },
    {
      name: "explicitly frozen nested containers",
      code: "import {useState} from \"react\"; const snapshot=Object.freeze({group:Object.freeze({mode:'ready'}),items:Object.freeze([Object.freeze({count:7})])}); const [retainedValue]=useState(snapshot);",
      expected: 0,
    },
    {
      name: "multiple literal references",
      code: 'import {useState} from "react"; const snapshot=Object.freeze({first:Object.freeze([]),second:Object.freeze([])}); const [retainedValue]=useState(snapshot);',
      expected: 0,
    },
    {
      name: "canonical CJS plus closed freeze",
      code: 'const React=require("react"); const snapshot=Object.freeze({count:7}); const [retainedValue]=React.useState(snapshot);',
      expected: 0,
    },
    {
      name: "unrelated window data remains allowed",
      code: 'import {useState} from "react"; const label=window.location; const snapshot=Object.freeze({count:7}); const [retainedValue]=useState(snapshot);',
      expected: 0,
    },
    {
      name: "method replacement",
      code: 'import React,{useState} from "react"; Object.freeze=customFreeze; Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "Object binding replacement",
      code: 'import React,{useState} from "react"; Object=customProvider; Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "method alias",
      code: 'import React,{useState} from "react"; const freezeValue=Object.freeze; freezeValue({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "provider alias",
      code: 'import React,{useState} from "react"; const provider=Object; provider.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "opaque provider escape",
      code: 'import React,{useState} from "react"; consume(Object); Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "opaque method escape",
      code: 'import React,{useState} from "react"; consume(Object.freeze); Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "metadata reference remains unsupported",
      code: 'import React,{useState} from "react"; Object.freeze.description; Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "method pattern replacement",
      code: 'import React,{useState} from "react"; ({freeze:Object.freeze}=source); Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "method array pattern replacement",
      code: 'import React,{useState} from "react"; [Object.freeze]=source; Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "method for-of replacement",
      code: 'import React,{useState} from "react"; for(Object.freeze of values){} Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "method for-in replacement",
      code: 'import React,{useState} from "react"; for(Object.freeze in values){} Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "method delete",
      code: 'import React,{useState} from "react"; delete Object.freeze; Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "method update",
      code: 'import React,{useState} from "react"; Object.freeze++; Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "opaque argument",
      code: 'import React,{useState} from "react"; Object.freeze(readInput()); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "identifier argument",
      code: 'import React,{useState} from "react"; const input={count:7}; Object.freeze(input); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "getter member",
      code: 'import React,{useState} from "react"; Object.freeze({get count(){React.useState=customHook;return 7;}}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "setter member",
      code: 'import React,{useState} from "react"; Object.freeze({set count(value){React.useState=customHook;}}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "method member",
      code: 'import React,{useState} from "react"; Object.freeze({read(){return 7;}}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "function value",
      code: 'import React,{useState} from "react"; Object.freeze({read:()=>7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "callable array leaf",
      code: 'import React,{useState} from "react"; Object.freeze([()=>7]); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "spread record",
      code: 'import React,{useState} from "react"; Object.freeze({...input}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "spread array",
      code: 'import React,{useState} from "react"; Object.freeze([...input]); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "shorthand field",
      code: 'import React,{useState} from "react"; const count=7; Object.freeze({count}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "identifier value",
      code: 'import React,{useState} from "react"; const count=7; Object.freeze({count:count}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "computed key",
      code: 'import React,{useState} from "react"; Object.freeze({[readKey()]:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "literal computed key",
      code: 'import React,{useState} from "react"; Object.freeze({["count"]:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "proto key",
      code: 'import React,{useState} from "react"; Object.freeze({__proto__:null}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "quoted proto key",
      code: 'import React,{useState} from "react"; Object.freeze({"__proto__":null}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "constructor key",
      code: 'import React,{useState} from "react"; Object.freeze({constructor:null}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "prototype key",
      code: 'import React,{useState} from "react"; Object.freeze({prototype:null}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "hole",
      code: 'import React,{useState} from "react"; Object.freeze([,7]); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "nested unfrozen record",
      code: 'import React,{useState} from "react"; Object.freeze({item:{count:7}}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "nested unfrozen array",
      code: 'import React,{useState} from "react"; Object.freeze({items:[]}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "extra argument",
      code: 'import React,{useState} from "react"; Object.freeze({count:7},input); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "spread argument",
      code: 'import React,{useState} from "react"; Object.freeze(...input); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "missing argument",
      code: 'import React,{useState} from "react"; Object.freeze(); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "computed method",
      code: 'import React,{useState} from "react"; Object["freeze"]({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "optional member",
      code: 'import React,{useState} from "react"; Object?.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "optional call",
      code: 'import React,{useState} from "react"; Object.freeze?.({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "new invocation",
      code: 'import React,{useState} from "react"; new Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "bind invocation",
      code: 'import React,{useState} from "react"; Object.freeze.bind(null)({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "seal unsupported",
      code: 'import React,{useState} from "react"; Object.seal({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "preventExtensions unsupported",
      code: 'import React,{useState} from "react"; Object.preventExtensions({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "regexp leaf",
      code: 'import React,{useState} from "react"; Object.freeze({pattern:/ready/}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "bigint leaf",
      code: 'import React,{useState} from "react"; Object.freeze({count:7n}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "template leaf",
      code: 'import React,{useState} from "react"; Object.freeze({mode:`ready`}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "negative numeric leaf",
      code: 'import React,{useState} from "react"; Object.freeze({count:-7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "default provider projection",
      code: 'import React,{useState} from "react"; globalThis.Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "window provider projection",
      code: 'import React,{useState} from "react"; window.Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "Reflect exposure preserved",
      code: 'import React,{useState} from "react"; Reflect.get(()=>{},"constructor"); Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "Function exposure preserved",
      code: 'import React,{useState} from "react"; Function("return 7"); Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "eval exposure preserved",
      code: 'import React,{useState} from "react"; eval("7"); Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "unknown computed exposure preserved",
      code: 'import React,{useState} from "react"; const key=readKey(); values[key]; Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "React provider mutation preserved",
      code: 'import React,{useState} from "react"; React.useState=customHook; Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "React provider escape preserved",
      code: 'import React,{useState} from "react"; consume(React); Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "React binding pattern replacement preserved",
      code: 'import React,{useState} from "react"; ({hook:useState=customHook}=source); Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
    {
      name: "loader cache exposure preserved",
      code: 'import React,{useState} from "react"; require.cache; Object.freeze({count:7}); const [retainedValue]=useState(7);',
      expected: 1,
    },
  ])("$name", ({ code, expected }) => {
    const result = runRule(hookUseState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
