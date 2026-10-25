import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

const run = (source: string) => runRule(noRefCurrentInRender, source);

describe("stored callable ref initialization", () => {
  it.each([
    [
      "a local callable alias",
      `import { useRef } from "react";
       type Action = () => number;
       const useCachedAction = () => {
         const actionRef = useRef<Action>();
         if (!actionRef.current) actionRef.current = () => 7;
         return actionRef.current;
       };`,
    ],
    [
      "a callable generic constraint and null sentinel",
      `import { useRef } from "react";
       type Operation = (...values: number[]) => number;
       const useCachedAction = <Action extends Operation,>() => {
         const actionRef = useRef<Action | null>(null);
         if (!actionRef.current) actionRef.current = (...values: number[]) => values.length;
         return actionRef.current;
       };`,
    ],
    [
      "a direct function with its own this and parameters",
      `import { useRef } from "react";
       type Action = (this: { offset: number }, ...values: number[]) => number;
       const useCachedAction = () => {
         const actionRef = useRef<Action>();
         if (!actionRef.current) {
           actionRef.current = function (this: { offset: number }, ...values: number[]) {
             return this.offset + values.length;
           };
         }
         return actionRef.current;
       };`,
    ],
    [
      "a wrapper around the direct literal",
      `import { useRef } from "react";
       type Action = () => number;
       const useCachedAction = () => {
         const actionRef = useRef<Action>();
         if (!actionRef.current) actionRef.current = ((() => 7) satisfies Action);
         return actionRef.current;
       };`,
    ],
    [
      "an unknown erased annotation with a concrete callable value",
      `import { useRef } from "react";
       const useCachedAction = () => {
         const actionRef = useRef<unknown>();
         if (!actionRef.current) actionRef.current = () => 7;
         return actionRef.current;
       };`,
    ],
    [
      "a callback reading a distinct stable ref when invoked",
      `import { useRef } from "react";
       type Action = () => number;
       const useCachedAction = () => {
         const sourceRef = useRef(7);
         const actionRef = useRef<Action>();
         if (!actionRef.current) actionRef.current = () => sourceRef.current;
         return actionRef.current;
       };`,
    ],
    [
      "an aliased native hook import",
      `import { useRef as makeRef } from "react";
       type Action = () => number;
       const useCachedAction = () => {
         const actionRef = makeRef<Action>();
         if (!actionRef.current) actionRef.current = () => 7;
         return actionRef.current;
       };`,
    ],
  ])("accepts %s", (_name, source) => {
    const result = run(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "a render input captured by the stored callback",
      `import { useRef } from "react";
       type Action = () => number;
       const useCachedAction = (value: number) => {
         const actionRef = useRef<Action>();
         if (!actionRef.current) actionRef.current = () => value;
         return actionRef.current;
       };`,
    ],
    [
      "an escaped ref object",
      `import { useRef } from "react";
       type Action = () => number;
       const useCachedAction = () => {
         const actionRef = useRef<Action>();
         if (!actionRef.current) actionRef.current = () => 7;
         inspect(actionRef);
         return actionRef.current;
       };`,
    ],
    [
      "a later reset from an event callback",
      `import { useRef } from "react";
       type Action = () => number;
       const Panel = () => {
         const actionRef = useRef<Action>();
         if (!actionRef.current) actionRef.current = () => 7;
         return <button onClick={() => { actionRef.current = undefined; }}>Reset</button>;
       };`,
    ],
    [
      "a prior write before the guarded initialization",
      `import { useRef } from "react";
       type Action = () => number;
       const useCachedAction = () => {
         const actionRef = useRef<Action>();
         actionRef.current = undefined;
         if (!actionRef.current) actionRef.current = () => 7;
         return actionRef.current;
       };`,
    ],
    [
      "a repeated guarded assignment",
      `import { useRef } from "react";
       type Action = () => number;
       const useCachedAction = () => {
         const actionRef = useRef<Action>();
         if (!actionRef.current) {
           for (const entry of [1, 2]) actionRef.current = () => entry;
         }
         return actionRef.current;
       };`,
    ],
    [
      "a nonempty initial sentinel",
      `import { useRef } from "react";
       const useCachedAction = () => {
         const actionRef = useRef<unknown>(false);
         if (!actionRef.current) actionRef.current = () => 7;
         return actionRef.current;
       };`,
    ],
    [
      "a function factory invocation",
      `import { useRef } from "react";
       type Action = () => number;
       const useCachedAction = () => {
         const actionRef = useRef<Action>();
         if (!actionRef.current) actionRef.current = makeAction();
         return actionRef.current;
       };`,
    ],
    [
      "a constructor behind an opaque domain",
      `import { useRef } from "react";
       type Storage = Map<string, number> | undefined;
       const useCachedAction = () => {
         const storageRef = useRef<Storage>();
         if (!storageRef.current) storageRef.current = new Map();
         return storageRef.current;
       };`,
    ],
    [
      "an unresolved current value",
      `import { useRef } from "react";
       const useCachedAction = () => {
         const actionRef = useRef<unknown>();
         if (!actionRef.current) actionRef.current = getValue();
         return actionRef.current;
       };`,
    ],
    [
      "a const alias instead of the direct literal",
      `import { useRef } from "react";
       type Action = () => number;
       const useCachedAction = () => {
         const actionRef = useRef<Action>();
         const operation = () => 7;
         if (!actionRef.current) actionRef.current = operation;
         return actionRef.current;
       };`,
    ],
    [
      "an object instead of a function literal",
      `import { useRef } from "react";
       const useCachedAction = () => {
         const actionRef = useRef<unknown>();
         if (!actionRef.current) actionRef.current = {};
         return actionRef.current;
       };`,
    ],
  ])("retains the warning for %s", (_name, source) => {
    const result = run(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("keeps an unrelated render-time ref write", () => {
    const result = run(`import { useRef } from "react";
      type Action = () => number;
      const useCachedAction = (value: number) => {
        const sourceRef = useRef(value);
        sourceRef.current = value;
        const actionRef = useRef<Action>();
        if (!actionRef.current) actionRef.current = () => sourceRef.current;
        return actionRef.current;
      };`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    [
      "render receiver",
      "function useCached(this: {value:number}) { const actionRef=useRef<unknown>(); if(!actionRef.current) actionRef.current=()=>this.value; return actionRef.current; }",
    ],
    [
      "nested arrow receiver",
      "function useCached(this: {value:number}) { const actionRef=useRef<unknown>(); if(!actionRef.current) actionRef.current=()=>()=>this.value; return actionRef.current; }",
    ],
    [
      "outer implicit arguments",
      "function useCached() { const actionRef=useRef<unknown>(); if(!actionRef.current) actionRef.current=()=>arguments[0]; return actionRef.current; }",
    ],
    [
      "outer new target",
      "function useCached() { const actionRef=useRef<unknown>(); if(!actionRef.current) actionRef.current=()=>new.target; return actionRef.current; }",
    ],
    [
      "outer super receiver",
      "const owner={__proto__:{value:1},make(){const useCached=()=>{const actionRef=useRef<unknown>();if(!actionRef.current)actionRef.current=()=>super.value;return actionRef.current;};return useCached;}};",
    ],
  ])("retains new literal admission for captured %s", (_name, body) => {
    const result = run(`import {useRef} from 'react'; ${body}`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
  it.each([
    ["own function arguments", "function(){return arguments[0];}"],
    [
      "nested arrows with own function receiver",
      "function(this:{value:number}){return ()=>this.value;}",
    ],
    ["nested arrows with own function arguments", "function(){return ()=>arguments[0];}"],
    ["own function new target", "function(){return ()=>new.target;}"],
    [
      "ordinary parameter with arguments property",
      "({arguments: value}: {arguments:number})=>value",
    ],
  ])("keeps %s independent of the render receiver", (_name, expression) => {
    const result = run(
      `import {useRef} from 'react'; const useCached=()=>{const actionRef=useRef<unknown>();if(!actionRef.current)actionRef.current=${expression};return actionRef.current;};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
