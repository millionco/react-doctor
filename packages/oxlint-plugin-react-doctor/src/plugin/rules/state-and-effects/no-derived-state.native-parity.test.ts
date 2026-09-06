import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

describe("no-derived-state native value evidence parity", () => {
  it.each([
    {
      name: "derived-builtin-member-transform-unknown",
      source:
        "import {useState,useEffect} from 'react'; export const View=({value})=>{const [result,setResult]=useState(null);useEffect(()=>setResult([value,Boolean.toString()]),[value]);return <div>{result}</div>}",
      expectedCount: 0,
    },
    {
      name: "derived-namespace-json-stringify-known",
      source:
        "import {useState,useEffect} from 'react'; export const View=({value})=>{const [result,setResult]=useState(null);useEffect(()=>setResult(JSON.stringify(value)),[value]);return <div>{result}</div>}",
      expectedCount: 1,
    },
    {
      name: "derived-value-with-local-constant",
      source:
        "import { useEffect, useState } from 'react'; export const View = ({ price }) => { const credit = 10; const [total, setTotal] = useState(0); useEffect(() => setTotal(price - credit), [price]); return <div>{total}</div>; };",
      expectedCount: 1,
    },
    {
      name: "derived-local-constant-alone-is-not-source",
      source:
        "import { useEffect, useState } from 'react'; export const View = () => { const credit = 10; const [total, setTotal] = useState(0); useEffect(() => setTotal(credit), []); return <div>{total}</div>; };",
      expectedCount: 0,
    },
    {
      name: "derived-cleanup-filtered-asserted-missing-parameters",
      source:
        "import { useEffect, useState } from 'react'; export const View = ({ code, session, key }) => { const [status, setStatus] = useState({ kind: 'loading' }); useEffect(() => { if (code) { setStatus({ kind: 'ready', code }); return; } const missing = [!session ? 'session' : undefined, !key ? 'key' : undefined].filter(Boolean) as string[]; if (missing.length) { setStatus({ kind: 'missing', missing }); return; } let active = true; return () => { active = false; }; }, [code, session, key]); return <div>{status.kind}</div>; };",
      expectedCount: 0,
    },
    {
      name: "derived-cleanup-filtered-missing-parameters",
      source:
        "import { useEffect, useState } from 'react'; export const View = ({ code, session, key }) => { const [status, setStatus] = useState({ kind: 'loading' }); useEffect(() => { if (code) { setStatus({ kind: 'ready', code }); return; } const missing = [!session ? 'session' : undefined, !key ? 'key' : undefined].filter(Boolean); if (missing.length) { setStatus({ kind: 'missing', missing }); return; } let active = true; return () => { active = false; }; }, [code, session, key]); return <div>{status.kind}</div>; };",
      expectedCount: 0,
    },
    {
      name: "derived-filtered-missing-parameters-without-cleanup",
      source:
        "import { useEffect, useState } from 'react'; export const View = ({ code, session, key }) => { const [status, setStatus] = useState({ kind: 'loading' }); useEffect(() => { if (code) { setStatus({ kind: 'ready', code }); return; } const missing = [!session ? 'session' : undefined, !key ? 'key' : undefined].filter(Boolean); if (missing.length) { setStatus({ kind: 'missing', missing }); return; } }, [code, session, key]); return <div>{status.kind}</div>; };",
      expectedCount: 1,
    },
    {
      name: "derived-bare-builtin-unknown",
      source:
        "import {useState,useEffect} from 'react'; export const View=({value})=>{const [result,setResult]=useState(null);useEffect(()=>setResult([value, Boolean]),[value]);return <div>{result}</div>}",
      expectedCount: 0,
    },
    {
      name: "derived-direct-builtin-call-known",
      source:
        "import {useState,useEffect} from 'react'; export const View=({value})=>{const [result,setResult]=useState(null);useEffect(()=>setResult(Boolean(value)),[value]);return <div>{result}</div>}",
      expectedCount: 1,
    },
    {
      name: "derived-namespace-call-known",
      source:
        "import {useState,useEffect} from 'react'; export const View=({value})=>{const [result,setResult]=useState(null);useEffect(()=>setResult(Math.max(0,value)),[value]);return <div>{result}</div>}",
      expectedCount: 1,
    },
    {
      name: "derived-new-date-known",
      source:
        "import {useState,useEffect} from 'react'; export const View=({value})=>{const [result,setResult]=useState(null);useEffect(()=>setResult(new Date(value)),[value]);return <div>{result}</div>}",
      expectedCount: 1,
    },
    {
      name: "derived-new-set-known",
      source:
        "import {useState,useEffect} from 'react'; export const View=({value})=>{const [result,setResult]=useState(null);useEffect(()=>setResult(new Set(value)),[value]);return <div>{result}</div>}",
      expectedCount: 1,
    },
  ])("$name", ({ source, expectedCount }) => {
    const result = runRule(noDerivedState, source, { filename: "src/view.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
