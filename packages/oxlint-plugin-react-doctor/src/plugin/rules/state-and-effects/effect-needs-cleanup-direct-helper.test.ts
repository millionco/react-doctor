import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface DirectHelperListenerCase {
  readonly name: string;
  readonly source: string;
  readonly expected: number;
}

const directHelperListenerCases: ReadonlyArray<DirectHelperListenerCase> = [
  {
    name: "reports an immediate module function listener",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 1,
  },
  {
    name: "reports an immediate readonly module arrow",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nconst attach = () => { window.addEventListener("resize", listener); };\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 1,
  },
  {
    name: "reports an immediate readonly module function expression",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nconst attach = function () { window.addEventListener("resize", listener); };\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 1,
  },
  {
    name: "reports a document listener after a bare early return",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { if (document.readyState === "complete") return; document.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 1,
  },
  {
    name: "reports a literal true helper argument",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach(enabled) { if (!enabled) return; window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(true); }, []); return null; };',
    expected: 1,
  },
  {
    name: "accepts a literal false helper argument",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach(enabled) { if (!enabled) return; window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(false); }, []); return null; };',
    expected: 0,
  },
  {
    name: "keeps explicit effect cleanup on the existing path",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); return () => window.removeEventListener("resize", listener); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines every effect with a conditional returned cleanup",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); if (document.hidden) return () => window.removeEventListener("resize", listener); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a returned helper disposer",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); return () => window.removeEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines an expression-valued effect callback",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => attach(), []); return null; };',
    expected: 0,
  },
  {
    name: "declines an async helper",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nasync function attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a generator helper",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction* attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines executable default parameters",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach(enabled = acquire()) { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines destructured parameters",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach({ enabled }) { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach({enabled: true}); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines rest parameters",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach(...entries) { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a replaced helper binding",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nattach = replacement;\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines an imported helper",
    source:
      'import { useEffect } from "react"; import { attach } from "./resource"; export const Panel=()=>{useEffect(()=>{attach();},[]);return null;};',
    expected: 0,
  },
  {
    name: "declines a member invocation",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nconst holder = { attach };\nexport const Panel = () => { useEffect(() => { holder.attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines call and apply invocations",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach.call(null); attach.apply(null); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a deferred callback invocation",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { queueMicrotask(() => attach()); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines recursive acquisition",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); attach(); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a second helper hop",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nfunction outer() { attach(); }\nexport const Panel = () => { useEffect(() => { outer(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "accepts synchronous helper release",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); window.removeEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "accepts synchronous effect release",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); window.removeEventListener("resize", listener); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines uncertain directly called release helpers",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nfunction detach() { window.removeEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); detach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "accepts existing once listener semantics",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener, { once: true }); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "accepts existing external signal semantics",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener, { signal: externalSignal }); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a shadowed global receiver",
    source:
      'import { useEffect } from "react";\nconst window = customTarget;\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines an unproved receiver",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { target.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "keeps helper timers outside the fallback",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { setInterval(listener, 1000); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "does not duplicate an existing retained arrow finding",
    source:
      'import {useEffect} from "react"; const listener=()=>{}; export const Panel=()=>{const attach=()=>{window.addEventListener("resize",listener);};useEffect(()=>{attach();},[]);return null;};',
    expected: 1,
  },
  {
    name: "preserves direct effect listener behavior",
    source:
      'import {useEffect} from "react";const listener=()=>{};export const Panel=()=>{useEffect(()=>{window.addEventListener("resize",listener);},[]);return null;};',
    expected: 1,
  },
  {
    name: "accepts a bare return from the effect",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); return; }, []); return null; };',
    expected: 1,
  },
  {
    name: "declines factory-produced helpers",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nconst make = () => () => { window.addEventListener("resize", listener); }; const attach = make();\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines optional helper invocation",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach?.(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines explicit resource transfer from helper",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); return listener; }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines mutual recursion before registration",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction bridge() { attach(); }\nfunction attach() { bridge(); window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a separate own prefix helper",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction measure() { return 1; }\nfunction attach() { measure(); window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a parameterized registration with caller release",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach(callback) { window.addEventListener("resize", callback); }\nexport const Panel = () => { useEffect(() => { attach(listener); window.removeEventListener("resize", listener); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines an explicit unknown effect return value",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); return acquire(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a listener parameter receiving null",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach(callback) { window.addEventListener("resize", callback); }\nexport const Panel = () => { useEffect(() => { attach(null); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a const alias of a listener parameter receiving null",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach(callback) { const forwarded = callback; window.addEventListener("resize", forwarded); }\nexport const Panel = () => { useEffect(() => { attach(null); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a listener parameter receiving undefined",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach(callback) { window.addEventListener("resize", callback); }\nexport const Panel = () => { useEffect(() => { attach(undefined); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a const alias of a listener parameter receiving undefined",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach(callback) { const forwarded = callback; window.addEventListener("resize", forwarded); }\nexport const Panel = () => { useEffect(() => { attach(undefined); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a literal null module listener",
    source:
      'import { useEffect } from "react";\nconst listener = null;\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines an undefined module listener alias",
    source:
      'import { useEffect } from "react";\nconst missing = undefined; const listener = missing;\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a known primitive module listener",
    source:
      'import { useEffect } from "react";\nconst listener = false;\nfunction attach() { window.addEventListener("resize", listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "declines a void listener expression",
    source:
      'import { useEffect } from "react";\nconst listener = () => {};\nfunction attach() { window.addEventListener("resize", void listener); }\nexport const Panel = () => { useEffect(() => { attach(); }, []); return null; };',
    expected: 0,
  },
  {
    name: "reports a component helper despite an optional event teardown",
    source:
      'import {useEffect,useCallback} from "react"; export const SignalWatch=({enabled,onSignal})=>{const notify=useCallback(()=>onSignal(),[onSignal]);function begin(){document.addEventListener("visibilitychange",notify);}function end(){document.removeEventListener("visibilitychange",notify);}useEffect(()=>{if(enabled)begin();},[enabled]);return <button onClick={end}>Finish</button>;};',
    expected: 1,
  },
  {
    name: "reports a guarded module helper through a genuine conditional effect alias",
    source:
      'import {useEffect,useLayoutEffect} from "react";const useBrowserEffect=typeof window!=="undefined"?useLayoutEffect:useEffect;function observeReady(element){if(document.readyState==="complete")return;function refresh(){element.focus();}window.addEventListener("load",refresh);}export const Entry=({element})=>{useBrowserEffect(()=>{if(element)observeReady(element);},[element]);return null;};',
    expected: 1,
  },
  {
    name: "declines a mutable listener replaced with null",
    source:
      'import {useEffect} from "react"; let listener=()=>{};listener=null; function attach(){window.addEventListener("resize",listener);} export const Panel=()=>{useEffect(()=>{attach();},[]);return null;};',
    expected: 0,
  },
  {
    name: "declines a member callback holding null",
    source:
      'import {useEffect} from "react"; const holder={listener:null}; function attach(){window.addEventListener("resize",holder.listener);} export const Panel=()=>{useEffect(()=>{attach();},[]);return null;};',
    expected: 0,
  },
  {
    name: "declines an unresolved callback value",
    source:
      'import {useEffect} from "react"; declare const listener:()=>void; function attach(){window.addEventListener("resize",listener);} export const Panel=()=>{useEffect(()=>{attach();},[]);return null;};',
    expected: 0,
  },
  {
    name: "declines a same-name local callback factory",
    source:
      'import {useEffect} from "react"; const useCallback=(callback)=>null;const listener=useCallback(()=>{}); function attach(){window.addEventListener("resize",listener);} export const Panel=()=>{useEffect(()=>{attach();},[]);return null;};',
    expected: 0,
  },

  {
    name: "declines a replaced imported React callback provider",
    source:
      'import React,{useEffect} from "react";React.useCallback=()=>null;const listener=React.useCallback(()=>{},[]);function attach(){window.addEventListener("resize",listener);}export const Panel=()=>{useEffect(()=>{attach();},[]);return null;};',
    expected: 0,
  },
  {
    name: "declines an unbound global callback factory",
    source:
      'import {useEffect} from "react";const listener=useCallback(()=>{},[]);function attach(){window.addEventListener("resize",listener);}export const Panel=()=>{useEffect(()=>{attach();},[]);return null;};',
    expected: 0,
  },
];

describe("effect-needs-cleanup immediate own listener helpers", () => {
  for (const testCase of directHelperListenerCases) {
    it(testCase.name, () => {
      const result = runRule(effectNeedsCleanup, testCase.source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  }
});
