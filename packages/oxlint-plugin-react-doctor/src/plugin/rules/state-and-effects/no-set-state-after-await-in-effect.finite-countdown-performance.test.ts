import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";
import {
  FINITE_COUNTDOWN_WORK_SMALL_COUNT,
  FINITE_COUNTDOWN_WORK_LARGE_COUNT,
  FINITE_COUNTDOWN_WORK_MAXIMUM_GROWTH_RATIO,
} from "./utils/constants.js";

const traversalWork = vi.hoisted(() => ({ subtreeVisits: 0, isCheckingCountdown: false }));

vi.mock("../../utils/walk-ast.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../utils/walk-ast.js")>();
  return {
    ...originalModule,
    walkAst: ((node, visitor) =>
      originalModule.walkAst(node, (candidate) => {
        if (traversalWork.isCheckingCountdown) traversalWork.subtreeVisits += 1;
        return visitor(candidate);
      })) satisfies typeof originalModule.walkAst,
    forEachChildNode: ((node, visitor) =>
      originalModule.forEachChildNode(node, (child) => {
        if (traversalWork.isCheckingCountdown) traversalWork.subtreeVisits += 1;
        visitor(child);
      })) satisfies typeof originalModule.forEachChildNode,
  };
});

vi.mock("./utils/find-finite-countdown-loop.js", async (importOriginal) => {
  const originalModule =
    await importOriginal<typeof import("./utils/find-finite-countdown-loop.js")>();
  return {
    ...originalModule,
    findFiniteCountdownLoop: ((input) => {
      const previousCheckingCountdown = traversalWork.isCheckingCountdown;
      traversalWork.isCheckingCountdown = true;
      try {
        return originalModule.findFiniteCountdownLoop(input);
      } finally {
        traversalWork.isCheckingCountdown = previousCheckingCountdown;
      }
    }) satisfies typeof originalModule.findFiniteCountdownLoop,
  };
});

describe("no-set-state-after-await-in-effect finite countdown performance", () => {
  it.each(["shared effect", "independent effects"])(
    "bounds countdown validation work for %s",
    (geometry) => {
      const [smallVisits = 0, largeVisits = 0] = [
        FINITE_COUNTDOWN_WORK_SMALL_COUNT,
        FINITE_COUNTDOWN_WORK_LARGE_COUNT,
      ].map((count) => {
        const runs = Array.from(
          { length: count },
          (_, index) =>
            `const run${index}=async()=>{
               let remaining${index}=1;
               while(remaining${index}>0){setValue(1);await load();remaining${index}-=1;}
             };void run${index}();`,
        );
        const effects =
          geometry === "shared effect"
            ? `useEffect(()=>{${runs.join("")}},[load]);`
            : runs.map((run) => `useEffect(()=>{${run}},[load]);`).join("");
        traversalWork.subtreeVisits = 0;
        const result = runRule(
          noSetStateAfterAwaitInEffect,
          `import {useEffect,useState} from "react";
           export const Panel=({load})=>{
             const [value,setValue]=useState(0);
             ${effects}
             return value;
           };`,
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
        return traversalWork.subtreeVisits;
      });
      expect(smallVisits).toBeGreaterThan(FINITE_COUNTDOWN_WORK_SMALL_COUNT);
      expect(largeVisits).toBeGreaterThan(smallVisits);
      expect(largeVisits).toBeLessThan(smallVisits * FINITE_COUNTDOWN_WORK_MAXIMUM_GROWTH_RATIO);
    },
  );

  it("keeps dynamic-scope refusals separate across effects", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `import {useEffect,useState} from "react";
       export const Panel=({load})=>{
         const [value,setValue]=useState(0);
         useEffect(()=>{
           const run=async()=>{
             let remaining=1;
             while(remaining>0){setValue(1);await load();remaining-=1;}
           };
           void run();
         },[load]);
         useEffect(()=>{
           const run=async()=>{
             let remaining=1;
             while(remaining>0){setValue(1);await load();remaining-=1;}
           };
           void run();
           eval("load()");
         },[load]);
         return value;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
