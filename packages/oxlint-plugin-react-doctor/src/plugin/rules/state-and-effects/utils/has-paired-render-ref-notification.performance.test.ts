import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "../rerender-state-only-in-handlers.js";
import {
  REF_NOTIFICATION_WORK_COMPONENT_COUNT,
  REF_NOTIFICATION_SCOPE_LOOKUPS_PER_COMPONENT_COUNT,
} from "./constants.js";

const source = (count: number, usesPassiveObject: boolean): string => `
import {useCallback,useLayoutEffect,useRef,useState} from "react";
${usesPassiveObject ? "interface Object {}" : ""}
${Array.from(
  { length: count },
  (_, index) => `export const Panel${index}=()=>{
 ${usesPassiveObject ? "Object.keys({});" : ""}
 const [phase,setPhase]=useState("idle");
 const latest=useRef("idle");
 useLayoutEffect(()=>{if(latest.current!==phase)setPhase(latest.current);},[phase]);
 const activate=useCallback(()=>{latest.current="busy";setPhase("busy");},[]);
 return <button onClick={activate}>{latest.current}</button>;
};`,
).join("\n")}`;

describe("paired ref notification shared analysis work", () => {
  it.each([false, true])(
    "bounds shared scope lookups with passive Object %s",
    (usesPassiveObject) => {
      let lookups = 0;
      const result = runRule(
        {
          ...rerenderStateOnlyInHandlers,
          create: (context) => {
            const scopes = context.scopes;
            return rerenderStateOnlyInHandlers.create({
              ...context,
              scopes: {
                ...scopes,
                symbolFor: (node) => {
                  lookups++;
                  return scopes.symbolFor(node);
                },
                scopeFor: (node) => {
                  lookups++;
                  return scopes.scopeFor(node);
                },
              },
            });
          },
        },
        source(REF_NOTIFICATION_WORK_COMPONENT_COUNT, usesPassiveObject),
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(lookups).toBeLessThanOrEqual(
        REF_NOTIFICATION_WORK_COMPONENT_COUNT * REF_NOTIFICATION_SCOPE_LOOKUPS_PER_COMPONENT_COUNT,
      );
    },
  );
});
