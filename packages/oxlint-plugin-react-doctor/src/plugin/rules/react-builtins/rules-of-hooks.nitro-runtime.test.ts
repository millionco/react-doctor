import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const runTsx = (code: string) => runRule(rulesOfHooks, code, { filename: "fixture.tsx" });

describe("Nitro awaited runtime singleton getter", () => {
  it.each([
    'const {useNitroApp}=await import("nitropack/runtime"); consume(useNitroApp());',
    'if(ready){const {useNitroApp:useWorkerApp}=await import("nitropack/runtime"); consume(useWorkerApp());}',
    'const {useNitroApp,defineNitroPlugin}=await import("nitropack/runtime"); consume(useNitroApp());',
    'export {}; const {useNitroApp}=(await (import("nitropack/runtime"))) as {useNitroApp:()=>object}; consume(useNitroApp());',
  ])("recognizes the exact immutable getter binding: %s", (code) => {
    const result = runTsx(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'const {useNitroApp}=await import("other-runtime"); consume(useNitroApp());',
    'const {useRuntimeConfig:useNitroApp}=await import("nitropack/runtime"); consume(useNitroApp());',
    'const {useState:useNitroApp}=await import("react"); consume(useNitroApp(0));',
    'let {useNitroApp}=await import("nitropack/runtime"); consume(useNitroApp());',
    'const {useNitroApp=fallback}=await import("nitropack/runtime"); consume(useNitroApp());',
    'const {useNitroApp,...others}=await import("nitropack/runtime"); consume(useNitroApp());',
    'const {["useNitroApp"]:useWorkerApp}=await import("nitropack/runtime"); consume(useWorkerApp());',
    'const {useNitroApp}=import("nitropack/runtime"); consume(useNitroApp());',
    'const await=identity; const {useNitroApp}=await(import("nitropack/runtime")); consume(useNitroApp());',
    'const source="nitropack/runtime"; const {useNitroApp}=await import(source); consume(useNitroApp());',
    'const {useNitroApp}=await import("nitropack/runtime"); const useWorkerApp=useNitroApp; consume(useWorkerApp());',
    'const {useNitroApp}=await import("nitropack/runtime"); useNitroApp=replacement; consume(useNitroApp());',
    'const {useNitroApp}=await import("nitropack/runtime"); ({callback:useNitroApp}=replacement); consume(useNitroApp());',
    'import {useState} from "react"; const {useNitroApp}=await import("nitropack/runtime"); {const useNitroApp=()=>useState(0); consume(useNitroApp());}',
    'import {useState} from "react"; const {useNitroApp}=await import("nitropack/runtime"); if(ready)consume(useNitroApp()); export const Panel=()=>{if(ready)useState(0);return null};',
    'const {useNitroApp}=await import("nitropack/runtime",{with:{type:"json"}}); consume(useNitroApp());',
    'const {useNitroApp}=await import.source("nitropack/runtime"); consume(useNitroApp());',
  ])("keeps genuine Hook or unproven-binding checks: %s", (code) => {
    const result = runTsx(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
