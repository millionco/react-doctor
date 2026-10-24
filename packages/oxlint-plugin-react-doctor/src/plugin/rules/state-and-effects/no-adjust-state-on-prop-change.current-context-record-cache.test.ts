import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  CURRENT_CONTEXT_RECORD_SMALL_WORK_COUNT,
  CURRENT_CONTEXT_RECORD_LARGE_WORK_COUNT,
  CURRENT_CONTEXT_RECORD_MAX_WORK_GROWTH_RATIO,
  CURRENT_CONTEXT_RECORD_SINGLE_PAIR_COUNT,
} from "../../../test-utils/constants.js";
import type { Rule } from "../../utils/rule.js";
import { isCurrentContextRecordRetirement } from "./utils/is-current-context-record-retirement.js";

interface CurrentContextReferenceMeasurement {
  currentContext: number;
  matches: number;
  record: number;
  setter: number;
}

interface CurrentContextWorkload {
  geometry: string;
  counters: readonly (keyof CurrentContextReferenceMeasurement)[];
}

const workloads: CurrentContextWorkload[] = [
  { geometry: "distinct-state-pairs", counters: ["currentContext"] },
  { geometry: "one-state-many-payloads", counters: ["matches"] },
  { geometry: "refused-masks-effects-writers", counters: ["record", "setter"] },
];

describe("current context record proof work", () => {
  it.each(workloads)("bounds $geometry reference visits", ({ geometry, counters }) => {
    const measure = (size: number): CurrentContextReferenceMeasurement => {
      const visits = { currentContext: 0, matches: 0, record: 0, setter: 0 };
      const observed = new WeakSet<object>();
      const probe: Rule = {
        id: "current-context-record-cache-work-probe",
        severity: "warn",
        create: (context) => {
          const symbolFor = context.scopes.symbolFor;
          vi.spyOn(context.scopes, "symbolFor").mockImplementation((identifier) => {
            const symbol = symbolFor(identifier);
            const counter =
              symbol?.name === "currentContext"
                ? "currentContext"
                : symbol?.name === "matches"
                  ? "matches"
                  : symbol?.name === "record0"
                    ? "record"
                    : symbol?.name === "setRecord0"
                      ? "setter"
                      : null;
            if (symbol && counter) {
              for (const reference of symbol.references) {
                if (observed.has(reference)) continue;
                observed.add(reference);
                const originalIdentifier = reference.identifier;
                Object.defineProperty(reference, "identifier", {
                  get: () => {
                    visits[counter] += 1;
                    return originalIdentifier;
                  },
                });
              }
            }
            return symbol;
          });
          return {
            CallExpression: (node) => {
              if (isCurrentContextRecordRetirement(node, context))
                context.report({ node, message: "Accepted current context certificate" });
            },
          };
        },
      };
      const hasDistinctPairs = geometry === "distinct-state-pairs";
      const isRefused = geometry === "refused-masks-effects-writers";
      const pairCount = hasDistinctPairs ? size : CURRENT_CONTEXT_RECORD_SINGLE_PAIR_COUNT;
      const effectCount =
        geometry === "one-state-many-payloads" ? CURRENT_CONTEXT_RECORD_SINGLE_PAIR_COUNT : size;
      const declarations = Array.from(
        { length: pairCount },
        (_, index) => `const [record${index},setRecord${index}]=useState(null);`,
      ).join("");
      const effects = Array.from({ length: effectCount }, (_, index) => {
        const selected = hasDistinctPairs ? index : 0;
        return `useEffect(()=>{setRecord${selected}(previous=>previous&&previous.token!==currentContext?null:previous);},[currentContext]);`;
      }).join("");
      const writers = isRefused
        ? `const write=()=>{${Array.from({ length: size }, () => 'setRecord0({token:currentContext,payload0:"retry"});').join("")}};`
        : "";
      const masks = hasDistinctPairs
        ? Array.from(
            { length: pairCount },
            (_, index) =>
              `const matches${index}=record${index}?.token===currentContext;const payload${index}=matches${index}?record${index}?.payload0:undefined;`,
          ).join("")
        : `const matches=record0?.token===currentContext;${Array.from({ length: size }, (_, index) => `const payload${index}=matches?record0?.payload${index}:undefined;`).join("")}`;
      const payload = hasDistinctPairs
        ? Array.from(
            { length: pairCount },
            (_, index) =>
              `<button onClick={()=>setRecord${index}({token:currentContext,payload0:"retry"})}>{payload${index}}</button>`,
          ).join("")
        : `<button onClick={()=>setRecord0({token:currentContext,payload0:"retry"})}>${Array.from({ length: size }, (_, index) => `{payload${index}}`).join("")}</button>`;
      const source = `import {useState,useEffect} from "react";export const Panel=({activeToken})=>{const currentContext=activeToken;${declarations}${writers}${effects}${masks}return <>${payload}</>;};`;
      try {
        const result = runRule(probe, source, {
          filename: "/synthetic/current-context-record-cache.tsx",
        });
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(isRefused ? 0 : pairCount);
        return visits;
      } finally {
        vi.restoreAllMocks();
      }
    };
    const small = measure(CURRENT_CONTEXT_RECORD_SMALL_WORK_COUNT);
    const large = measure(CURRENT_CONTEXT_RECORD_LARGE_WORK_COUNT);
    for (const counter of counters) {
      const smallVisits = small[counter];
      const largeVisits = large[counter];
      expect(smallVisits).toBeGreaterThan(CURRENT_CONTEXT_RECORD_SMALL_WORK_COUNT);
      expect(largeVisits).toBeGreaterThan(smallVisits);
      expect(largeVisits).toBeLessThanOrEqual(
        smallVisits * CURRENT_CONTEXT_RECORD_MAX_WORK_GROWTH_RATIO,
      );
    }
  });
});
