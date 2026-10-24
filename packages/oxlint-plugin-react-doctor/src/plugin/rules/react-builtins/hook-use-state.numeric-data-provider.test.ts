import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { hasRefNotificationReactCall } from "../state-and-effects/utils/has-ref-notification-react-call.js";
import { hookUseState } from "./hook-use-state.js";

interface NumericDataProviderCase {
  readonly name: string;
  readonly code: string;
  readonly expectedCount: number;
}

const cases: NumericDataProviderCase[] = [
  {
    name: "ordinary numeric data",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "local numeric function",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const getIndex=(target)=>Number(target);const index=getIndex(input);const values=[3,7];const amount=values[index]+1;return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "closed numeric parameter callers",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const assign=(position)=>{const values=[3,7];values[position]=8;return values[position]+1;};const amount=assign(Number(input));return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "fresh array indexOf data alias",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);values[index]=8;const previous=values[index];values.reverse();const amount=values.indexOf(previous);return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "subtraction numeric key",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const amount=values[values.length-1]+1;return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "unknown function extraction",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const getKey=()=>input;const execute=(()=>{})[getKey()];execute("return null");return <span>{storedKey+amount}</span>};',
    expectedCount: 1,
  },
  {
    name: "numeric function extraction",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const handlers=[()=>null];const selected=handlers[Number(input)];selected();return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "numeric direct callee",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const handlers=[()=>null];handlers[Number(input)]();return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "unused extracted capability",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const handlers=[()=>null];const selected=handlers[Number(input)];return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "const constructor key",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const key="constructor";const execute=(()=>{})[key];execute("return null");return <span>{storedKey+amount}</span>};',
    expectedCount: 1,
  },
  {
    name: "numeric object write",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const record={};record[Number(input)]=8;return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "typed open parameter",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const read=(position:number)=>values[position]+1;publish(read);const amount=0;return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "escaped parameter function",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const assign=(position)=>{const values=[3,7];values[position]=8;};publish(assign);const amount=0;return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "shadow Number string key",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const Number=()=>"constructor";const execute=(()=>{})[Number()];execute("return null");const amount=0;return <span>{storedKey+amount}</span>};',
    expectedCount: 1,
  },
  {
    name: "array escaped before indexOf",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const previous=values[index];install(values);const amount=values.indexOf(previous);return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "hoisted array escape",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const previous=values[index];const amount=values.indexOf(previous);function expose(){install(values)}return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "indexOf in repeat loop",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const previous=values[index];for(const item of input){values.indexOf(previous)}const amount=0;return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "dynamic React loader",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const start=async()=>{const provider=await import("react");provider.default.useState=customHook;return Panel(input)};return <span>{storedKey+amount}</span>};',
    expectedCount: 1,
  },
  {
    name: "native imported loader",
    code: 'import {useState} from "react";import {createRequire} from "node:module";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const loader=createRequire(import.meta.url);loader("react").useState=customHook;return <span>{storedKey+amount}</span>};',
    expectedCount: 1,
  },
  {
    name: "process loader",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;process.mainModule.require("react").useState=customHook;return <span>{storedKey+amount}</span>};',
    expectedCount: 1,
  },
  {
    name: "require loader",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;require("react").useState=customHook;return <span>{storedKey+amount}</span>};',
    expectedCount: 1,
  },
  {
    name: "provider namespace replacement",
    code: 'import {useState} from "react";import * as Provider from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;Provider.useState=customHook;return <span>{storedKey+amount}</span>};',
    expectedCount: 1,
  },
  {
    name: "direct window listeners",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const listener=()=>consume(amount);window.addEventListener("custom",listener);window.removeEventListener("custom",listener);return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "window capture boolean",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const listener=()=>consume(amount);window.addEventListener("custom",listener,true);window.removeEventListener("custom",listener,true);return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "computed window method",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const listener=()=>null;window["addEventListener"]("custom",listener);return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "optional window method",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const listener=()=>null;window.addEventListener?.("custom",listener);return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "dynamic window event",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const listener=()=>null;window.addEventListener(input,listener);return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "window options object",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const listener=()=>null;window.addEventListener("custom",listener,{capture:true});return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "window receiver escape",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;install(window);return <span>{storedKey+amount}</span>};',
    expectedCount: 1,
  },
  {
    name: "window method replacement",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const listener=()=>null;window.addEventListener=install;window.addEventListener("custom",listener);return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "erased namespace and JSX import coexist",
    code: 'import {Fragment,type ReactNode,useState} from "react";import * as React from "react";export const Panel:React.FC<{input:number}>=({input})=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const label:ReactNode=storedKey+amount;return <Fragment>{label}</Fragment>};',
    expectedCount: 0,
  },
  {
    name: "visible global Number replacement",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;Number=customNumber;return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "resolved Array prototype replacement",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const prototypeKey="prototype";Array[prototypeKey].indexOf=customIndexOf;return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "inline exported parameter owner",
    code: 'import {useState} from "react";export const transport=(position)=>{const values=[3,7];values[position]=8;return values[position]+1};export const Panel=(input)=>{const [storedKey]=useState(7);const amount=transport(Number(input));return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "exported function parameter owner",
    code: 'import {useState} from "react";export function transport(position){const values=[3,7];values[position]=8;return values[position]+1}export const Panel=(input)=>{const [storedKey]=useState(7);const amount=transport(Number(input));return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "default export parameter owner",
    code: 'import {useState} from "react";const transport=(position)=>{const values=[3,7];values[position]=8;return values[position]+1};export default transport;export const Panel=(input)=>{const [storedKey]=useState(7);const amount=transport(Number(input));return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "specifier export parameter owner",
    code: 'import {useState} from "react";const transport=(position)=>{const values=[3,7];values[position]=8;return values[position]+1};export {transport as readValue};export const Panel=(input)=>{const [storedKey]=useState(7);const amount=transport(Number(input));return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "passed callback parameter owner",
    code: 'import {useState} from "react";const transport=(position)=>{const values=[3,7];values[position]=8;return values[position]+1};publish(transport);export const Panel=(input)=>{const [storedKey]=useState(7);const amount=transport(Number(input));return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "JSX parameter owner",
    code: 'import {useState} from "react";const transport=(position)=>{const values=[3,7];values[position]=8;return values[position]+1};const exposed=<Widget read={transport}/>;export const Panel=(input)=>{const [storedKey]=useState(7);const amount=transport(Number(input));return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "member assignment parameter owner",
    code: 'import {useState} from "react";const transport=(position)=>{const values=[3,7];values[position]=8;return values[position]+1};target.read=transport;export const Panel=(input)=>{const [storedKey]=useState(7);const amount=transport(Number(input));return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "returned parameter owner",
    code: 'import {useState} from "react";const transport=(position)=>{const values=[3,7];values[position]=8;return values[position]+1};const escape=()=>transport;export const Panel=(input)=>{const [storedKey]=useState(7);const amount=transport(Number(input));return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "before initialization call",
    code: 'import {useState} from "react";const first=transport(Number(input));const transport=(position)=>{const values=[3,7];values[position]=8;return values[position]+1};export const Panel=(input)=>{const [storedKey]=useState(7);const amount=transport(Number(input));return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "closed local initialized before calls",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const transport=(position)=>{const values=[3,7];values[position]=8;return values[position]+1};const amount=transport(Number(input));return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "hoisted numeric function captures later const",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=getIndex();const captured=Number(input);function getIndex(){return captured}const amount=values[index]+1;return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "numeric function captures earlier const",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const captured=Number(input);const getIndex=()=>captured;const index=getIndex();const amount=values[index]+1;return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "exact independent exported two-parameter capability boundary",
    code: 'import { useState } from "react";\n\nexport const transport = (readKey, writeKey) => {\n  const slots = [];\n  slots[writeKey] = capability => capability("return import(\'react\')")();\n  const selected = (() => {})[readKey];\n  return slots.indexOf(selected);\n};\n\nexport const Panel = input => {\n  const [storedKey] = useState(7);\n  const amount = transport(Number(input), Number(input));\n  return <span>{storedKey + amount}</span>;\n};\n',
    expectedCount: 1,
  },
  {
    name: "exact independent global Number write boundary",
    code: 'import { useState } from "react";\n\nglobal.Number = value => value;\n\nexport const Panel = () => {\n  const slots = [];\n  slots[Number("indexOf")] = capability => capability("return import(\'react\')")();\n  const selected = (() => {})[Number("constructor")];\n  const amount = slots.indexOf(selected);\n  const [storedKey] = useState(7);\n  return <span>{storedKey + amount}</span>;\n};\n',
    expectedCount: 1,
  },
  {
    name: "global Number property replacement",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;global.Number=customNumber;return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
  {
    name: "aliased global Number replacement",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const host=global;host.Number=customNumber;return <span>{storedKey+amount}</span>};',
    expectedCount: 1,
  },
  {
    name: "global object escape",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;install(global);return <span>{storedKey+amount}</span>};',
    expectedCount: 1,
  },
  {
    name: "unrelated shadowed global value",
    code: 'import {useState} from "react";export const Panel=(input)=>{const [storedKey]=useState(7);const values=[3,7];const index=Number(input);const amount=values[index]+1;const global={Number:()=>null};global.Number();return <span>{storedKey+amount}</span>};',
    expectedCount: 0,
  },
];

describe("hook-use-state finite numeric data provider", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(hookUseState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
  it.each([false, true])("keys optional window policy when first request is %s", (firstPolicy) => {
    const certificates: boolean[] = [];
    const code =
      'import {useState} from "react";const Panel=()=>{const [storedKey]=useState(7);const listener=()=>consume(storedKey);window.addEventListener("custom",listener);return <span>{storedKey}</span>};';
    const result = runRule(
      {
        ...hookUseState,
        create: (context) => ({
          CallExpression: (node: EsTreeNode) => {
            if (
              node.type !== "CallExpression" ||
              node.callee.type !== "Identifier" ||
              node.callee.name !== "useState"
            )
              return;
            for (const allowNativeWindowEventListeners of [firstPolicy, !firstPolicy, firstPolicy])
              certificates.push(
                hasRefNotificationReactCall(node, "useState", context, {
                  allowNativeWindowEventListeners,
                }),
              );
          },
        }),
      },
      code,
    );
    expect(result.parseErrors).toEqual([]);
    expect(certificates).toEqual([firstPolicy, !firstPolicy, firstPolicy]);
  });
});
