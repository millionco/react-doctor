import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";
import {
  ASYNC_WHILE_WORK_SMALL_DEPTH_COUNT,
  ASYNC_WHILE_WORK_LARGE_DEPTH_COUNT,
  ASYNC_WHILE_WORK_MAXIMUM_GROWTH_RATIO,
} from "./utils/constants.js";

interface WhileWorkCase {
  readonly name: string;
  readonly buildBody: (depth: number) => string;
}

const traversalWork = vi.hoisted(() => ({ visits: 0 }));

vi.mock("../../utils/walk-ast.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../utils/walk-ast.js")>();
  return {
    ...originalModule,
    walkAst: ((node, visitor) =>
      originalModule.walkAst(node, (candidate) => {
        traversalWork.visits += 1;
        return visitor(candidate);
      })) satisfies typeof originalModule.walkAst,
    forEachChildNode: ((node, visitor) =>
      originalModule.forEachChildNode(node, (child) => {
        traversalWork.visits += 1;
        visitor(child);
      })) satisfies typeof originalModule.forEachChildNode,
  };
});

const GUARDED_WRITE_BODY = "const nextValue=await load();if(cancelled)return;setValue(nextValue);";

const measureWhileTraversalWork = (body: string): number => {
  const source = `import {useEffect,useState} from "react";
    export const Panel=({keepGoing,load})=>{
      const [value,setValue]=useState(null);
      useEffect(()=>{
        let cancelled=false;
        const run=async()=>{${body}};
        void run();
        return()=>{cancelled=true};
      },[keepGoing,load]);
      return value;
    };`;
  traversalWork.visits = 0;
  const result = runRule(noSetStateAfterAwaitInEffect, source);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
  return traversalWork.visits;
};

describe("no-set-state-after-await-in-effect while performance", () => {
  it.each<WhileWorkCase>([
    {
      name: "nested blocks",
      buildBody: (depth) =>
        "while(keepGoing){".repeat(depth) + GUARDED_WRITE_BODY + "}".repeat(depth),
    },
    {
      name: "nested single statements",
      buildBody: (depth) => "while(keepGoing)".repeat(depth) + "{" + GUARDED_WRITE_BODY + "}",
    },
    {
      name: "independent loops",
      buildBody: (depth) => ("while(keepGoing){" + GUARDED_WRITE_BODY + "}").repeat(depth),
    },
  ])("bounds traversal growth for $name", ({ buildBody }) => {
    const smallVisits = measureWhileTraversalWork(buildBody(ASYNC_WHILE_WORK_SMALL_DEPTH_COUNT));
    const largeVisits = measureWhileTraversalWork(buildBody(ASYNC_WHILE_WORK_LARGE_DEPTH_COUNT));
    expect(smallVisits).toBeGreaterThan(ASYNC_WHILE_WORK_SMALL_DEPTH_COUNT);
    expect(largeVisits).toBeGreaterThan(smallVisits);
    expect(largeVisits).toBeLessThan(smallVisits * ASYNC_WHILE_WORK_MAXIMUM_GROWTH_RATIO);
  });

  it("keeps scalar write facts separate across effects", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `import {useEffect,useState} from "react";
       export const Panel=({keepGoing,load,other})=>{
         const [value,setValue]=useState(null);
         let leftCancelled=false;
         let rightCancelled=false;
         useEffect(()=>{
           const run=async()=>{
             while(keepGoing){await load();if(leftCancelled)return;setValue(value);}
           };
           void run();
           return()=>{leftCancelled=true};
         },[keepGoing,load]);
         useEffect(()=>{
           const run=async()=>{
             while(keepGoing){
               rightCancelled=false;
               await load();
               if(rightCancelled)return;
               setValue(value);
               await other();
             }
           };
           void run();
           return()=>{rightCancelled=true};
         },[keepGoing,load,other]);
         return value;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
