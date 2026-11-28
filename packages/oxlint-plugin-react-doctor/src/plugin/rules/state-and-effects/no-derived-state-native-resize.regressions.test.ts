import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";

describe("derived state with an independent native resize writer", () => {
  it.each([
    { name: "standard", warnings: 0 },
    {
      name: "block",
      body: 'const listener=()=>{setCount(previous=>previous+1);}; window.addEventListener("resize",listener); return ()=>{window.removeEventListener("resize",listener);};',
      warnings: 0,
    },
    {
      name: "function",
      body: 'function listener(){setCount(previous=>previous+1);} window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 0,
    },
    {
      name: "decrement",
      body: 'const listener=()=>setCount(previous=>previous-1); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 0,
    },
    {
      name: "notInvoked",
      body: "const listener=()=>setCount(previous=>previous+1); ",
      warnings: 1,
    },
    {
      name: "doesNotChange",
      body: 'const listener=()=>setCount(previous=>previous); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "addsZero",
      body: 'const listener=()=>setCount(previous=>previous+0); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "fixedSource",
      body: 'const listener=()=>setCount(source); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "wrongEvent",
      body: 'const listener=()=>setCount(previous=>previous+1); window.addEventListener("resize", listener); return ()=>window.removeEventListener("orientationchange",listener);',
      warnings: 1,
    },
    {
      name: "wrongCallback",
      body: 'const listener=()=>setCount(previous=>previous+1); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",()=>{});',
      warnings: 1,
    },
    {
      name: "shadowedWindow",
      body: 'const window=getEventReceiver(); const listener=()=>setCount(previous=>previous+1); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "modifiedRegistration",
      prelude: "window.addEventListener = maybeRegister;",
      warnings: 1,
    },
    {
      name: "prototypeMutation",
      prelude: "EventTarget.prototype.addEventListener = maybeRegister;",
      warnings: 1,
    },
    {
      name: "setupWithBranch",
      body: 'const listener=()=>setCount(previous=>previous+1); if(enabled) window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "immediateRemoval",
      body: 'const listener=()=>setCount(previous=>previous+1); window.addEventListener("resize", listener); window.removeEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "afterEarlyExit",
      body: 'return; const listener=()=>setCount(previous=>previous+1); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "handlerConditional",
      body: 'const listener=()=>{if(enabled) setCount(previous=>previous+1);}; window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "handlerNested",
      body: 'const listener=()=>{return ()=>setCount(previous=>previous+1);}; window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "mutableHandler",
      body: 'let listener=()=>setCount(previous=>previous+1); listener = () => {}; window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "escapeBeforeAdd",
      body: 'const listener=()=>setCount(previous=>previous+1); retain(listener); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "setterShadow",
      body: 'const setCount=differentSetter; const listener=()=>setCount(previous=>previous+1); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "initAlias",
      body: 'const dispatch=setCount; const listener=()=>dispatch(previous=>previous+1); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    { name: "effectFaked", hook: "fakeEffect", warnings: 1 },
    {
      name: "optionsOnce",
      body: 'const listener=()=>setCount(previous=>previous+1); window.addEventListener("resize", listener,{ once:true }); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "nativeWidth",
      body: 'const listener=()=>setCount(window.innerWidth); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 0,
    },
    {
      name: "literalCapture",
      body: 'const listener=()=>setCount(previous=>previous+1); window.addEventListener("resize", listener, true); return ()=>window.removeEventListener("resize",listener,true);',
      warnings: 0,
    },
    {
      name: "mismatchedCapture",
      body: 'const listener=()=>setCount(previous=>previous+1); window.addEventListener("resize", listener, true); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "destructuredSource",
      after: "({ source } = { source: 1n as unknown as number });",
      warnings: 1,
    },
    {
      name: "failedSetup",
      prelude: "function prepare() { throw new Error('setup skipped'); }",
      body: 'prepare(); const listener=()=>setCount(previous=>previous+1); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    {
      name: "failedInitializer",
      prelude: "function prepare() { throw new Error('setup skipped'); }",
      body: 'const listener=()=>setCount(previous=>previous+1), second = prepare(); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    { name: "bigint", seed: "useState(0n)", warnings: 1 },
    {
      name: "bigintSource",
      seed: "useState<number | bigint>(0)",
      sourceType: "bigint",
      warnings: 1,
    },
    {
      name: "methodAlias",
      body: 'const browser=window; browser.addEventListener=maybeRegister; const listener=()=>setCount(previous=>previous+1); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
    { name: "shadowedSetterBinding", after: "setCount=otherSetter;", keyword: "let", warnings: 1 },
    {
      name: "blockMirroredState",
      body: 'const listener=()=>setCount(previous=>source); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      warnings: 1,
    },
  ])("checks the state writer in $name", (sample) => {
    const {
      prelude = "",
      body = 'const listener=()=>setCount(previous=>previous+1); window.addEventListener("resize", listener); return ()=>window.removeEventListener("resize",listener);',
      after = "",
      keyword = "const",
      seed = "useState(0)",
      sourceType = "number",
      hook = "useEffect",
      warnings,
    } = sample;
    const source = `
      import { useEffect, useState } from "react";
      ${prelude}
      export function Panel({source,enabled}: {source:${sourceType};enabled:boolean}) {
        ${keyword} [count,setCount] = ${seed};
        useEffect(()=>{setCount(source);},[source]);
        ${hook}(()=>{${body}},[enabled,source]);
        ${after}
        return <span>{count}</span>;
      }
    `;
    for (const rule of [noDerivedState, noDerivedStateEffect]) {
      const result = runRule(rule, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(warnings);
    }
  });
});
