import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noFetchInEffect } from "./no-fetch-in-effect.js";

interface NativeCallbackCase {
  name: string;
  code: string;
  expectedCount: number;
}

const nativeCallbackRuleOptions: RunRuleOptions = {
  filename: "native-callback-effect.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      capabilities: ["react", "react:19"],
      reactVersion: "19.0.0",
    },
  },
};

const cases: NativeCallbackCase[] = [
  {
    name: "readonly-effect-callback",
    code: 'import {useCallback,useEffect} from "react"; export const SearchPanel=({query})=>{const load=useCallback(async(value)=>{await fetch(value)},[]); const effect=()=>{load(query)}; useEffect(effect,[query,load]);return null;};',
    expectedCount: 1,
  },
  {
    name: "readonly-effect-callback-alias-chain",
    code: 'import {useCallback,useEffect} from "react"; export const SearchPanel=({query})=>{const load=useCallback(async(value)=>{await fetch(value)},[]); const effect=()=>{load(query)}; const alias=effect; useEffect(alias,[query,load]);return null;};',
    expectedCount: 1,
  },
  {
    name: "reassigned-effect-callback",
    code: 'import {useCallback,useEffect} from "react"; export const SearchPanel=({query})=>{const load=useCallback(async(value)=>{await fetch(value)},[]); let effect=()=>{load(query)}; effect=()=>{}; useEffect(effect,[query,load]);return null;};',
    expectedCount: 0,
  },
  {
    name: "opaque-effect-callback",
    code: 'import {useCallback,useEffect} from "react"; export const SearchPanel=({query})=>{const load=useCallback(async(value)=>{await fetch(value)},[]); const effect=opaqueFactory(()=>{load(query)}); useEffect(effect,[query,load]);return null;};',
    expectedCount: 0,
  },
  {
    name: "deferred-aliased-effect-callback",
    code: 'import {useCallback,useEffect} from "react"; export const SearchPanel=({query})=>{const load=useCallback(async(value)=>{await fetch(value)},[]); const effect=()=>{setTimeout(()=>load(query),0)}; useEffect(effect,[query,load]);return null;};',
    expectedCount: 0,
  },
  {
    name: "async-aliased-effect-callback",
    code: 'import {useCallback,useEffect} from "react"; export const SearchPanel=({query})=>{const load=useCallback(async(value)=>{await fetch(value)},[]); const effect=async()=>{await load(query)}; useEffect(effect,[query,load]);return null;};',
    expectedCount: 0,
  },

  {
    name: "native-async-arrow-parameter",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const [rows, setRows] = useState([]);
const load = useCallback(async (value) => { const response = await fetch("/api/items?key=" + value); const data = await response.json(); setRows(data); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "native-sync-arrow",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback((value) => { fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "conditional-async-try-catch-finally",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const [rows, setRows] = useState([]); const [busy, setBusy] = useState(false);
const load = useCallback(async (value) => { if (!value) { setRows([]); return; } setBusy(true); try { const response = await fetch("/api/items?key=" + value); setRows(await response.json()); } catch { setRows([]); } finally { setBusy(false); } }, []);
useEffect(() => { if (query) { load(query); } else { setRows([]); } }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "renamed-canonical-named-hook",
    code: `import { useCallback as memoRequest, useEffect } from "react";
const SearchPanel = ({ query }) => {
const load = memoRequest(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "legacy-direct-request",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {

useEffect(() => { fetch("/api/items?key=" + query); }, [query]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "legacy-local-function-request",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = async (value) => { await fetch("/api/items?key=" + value); };
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "local-fetch-mock",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const fetch = useCallback(async (value) => fakeFetch(value), []);
useEffect(() => { fetch(query); }, [query, fetch]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "foreign-use-callback",
    code: `import { useEffect } from "react"; import { useCallback } from "other-hooks";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch(value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "shadowed-callback-provider",
    code: `import { useEffect } from "react";
const SearchPanel = ({ query }) => {
const useCallback = () => () => null; const load = useCallback(async (value) => { await fetch(value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "type-only-callback-import",
    code: `import type { useCallback } from "react"; import { useEffect } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch(value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "namespace-provider-replacement",
    code: `import { useCallback, useEffect, useState } from "react";
import * as ReactProvider from "react"; ReactProvider.useCallback = () => () => null;
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch(value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "result-alias-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const original = useCallback(async (value) => { await fetch(value); }, []); const load = original;
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "result-reassignment",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
let load = useCallback(async (value) => { await fetch(value); }, []); load = () => null;
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "result-pattern-write",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch(value); }, []); [load] = [() => null];
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "result-opaque-escape",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch(value); }, []); consume(load);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "deferred-event-only",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async () => { await fetch("/api/items"); }, []);
useEffect(() => { window.addEventListener("focus", load); return () => window.removeEventListener("focus", load); }, [load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "use-memo-factory-deferred",
    code: `import { useMemo, useEffect } from "react";
const SearchPanel = ({ query }) => {
const load = useMemo(() => async (value) => { await fetch(value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "async-effect-callback-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch(value); }, []);
useEffect(async () => { await load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "wrong-owner-captured-result",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch(value); }, []);
const NestedPanel = () => { useEffect(() => { load(query); }, [query, load]); return null; };

return <NestedPanel />;
};
`,
    expectedCount: 0,
  },
  {
    name: "direct-eval-provider-exposure",
    code: `import { useCallback, useEffect, useState } from "react";
eval("void 0");
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch(value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "ordinary-navigation-does-not-expose-provider",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
const navigate = () => { const params = new URLSearchParams(window.location.search); window.location.href = "/items?" + params.toString(); };
useEffect(() => { load(query); }, [query, load]);
return <button onClick={navigate}>Open</button>;
};
`,
    expectedCount: 1,
  },
  {
    name: "matching-abort-cleanup-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (signal) => { await fetch("/api/items", { signal }); }, []);
useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "ignore-flag-cleanup-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { let ignore = false; load(query); return () => { ignore = true; }; }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "early-undefined-return-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { if (!query) return; load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "implicit-return-effect-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => load(query), [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "callback-hook-spread-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(...callbacks, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "callback-dependency-spread-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch(value); }, [...dependencies]);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "effect-hook-first-spread-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(...effects, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "effect-dependency-spread-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load, ...dependencies]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "callback-missing-dependencies-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch(value); });
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "effect-missing-dependencies-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); });
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "ordinary-function-callback-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async function(value) { await fetch(value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "generator-callback-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(function*(value) { yield fetch(value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "default-parameter-callback-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value = query) => { await fetch(value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "destructured-parameter-callback-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async ({ url }) => { await fetch(url); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "object-pattern-result-write-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
({ load } = replacement);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "loop-target-result-write-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
for (load of replacements) {}
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "result-method-member-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load.call(null, query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "result-optional-call-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load?.(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "result-jsx-handler-escape-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return <button onClick={load}>Load</button>;
};
`,
    expectedCount: 0,
  },
  {
    name: "react-import-alias-escape-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const memoFactory = useCallback;
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "genuine-require-alias-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const loadModule = require;
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "function-constructor-provider-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
Function("return null");
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "static-constructor-carrier-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const create = (() => null).constructor;
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "dynamic-react-import-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
import("react").then(consume);
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "builtin-module-import-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
import { createRequire } from "node:module";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "shadowed-function-name-positive",
    code: `import { useCallback, useEffect, useState } from "react";
const Function = () => null; Function();
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "type-only-react-namespace-positive",
    code: `import { useCallback, useEffect, useState } from "react";
import type * as ReactTypes from "react";
type Result = ReactTypes.ReactNode;
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "object-reflection-provider-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
Object.defineProperty({}, "unused", { value: true });
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "foreign-effect-provider-deferred",
    code: `import { useCallback } from "react"; import { useEffect } from "other-hooks";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "runtime-default-react-carrier-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
import ReactProvider from "react"; ReactProvider.createElement("span");
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "same-result-in-two-effects-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "typed-callback-reference-positive",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
type Loader = typeof load;
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "dead-conditional-invocation-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { if (false) { load(query); } }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "nested-iife-invocation-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { (() => { load(query); })(); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "class-field-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { class Holder { value = load(query); } }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "transparent-typed-callee-positive",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { (load as (value: string) => Promise<void>)(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "multiple-direct-invocations-one-effect-positive",
    code: `import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "global-react-namespace-exposure-deferred",
    code: `import { useCallback, useEffect, useState } from "react";
globalThis.React = replacement;
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "runtime-ts-import-equals-carrier-deferred",
    code: `import { useCallback, useEffect } from "react";
import ReactCarrier = require("react"); ReactCarrier.useCallback = replacement;
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "type-only-ts-import-equals-positive",
    code: `import { useCallback, useEffect } from "react";
import type ReactTypes = require("react"); type Result = ReactTypes.ReactNode;
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "runtime-namespace-evaluator-deferred",
    code: `import { useCallback, useEffect } from "react";
namespace Hidden { export const marker = eval("void 0"); }
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "declare-namespace-positive",
    code: `import { useCallback, useEffect } from "react";
declare namespace Ambient { type Marker = string; }
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "runtime-enum-initializer-deferred",
    code: `import { useCallback, useEffect } from "react";
enum Stage { First = 1 }
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "declare-enum-positive",
    code: `import { useCallback, useEffect } from "react";
declare enum Stage { First }
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
  {
    name: "ts-export-assignment-deferred",
    code: `import { useCallback, useEffect } from "react";
export = requestMetadata;
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "parameter-property-deferred",
    code: `import { useCallback, useEffect } from "react";
class Holder { constructor(public marker: number) {} }
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 0,
  },
  {
    name: "declared-constructor-signature-positive",
    code: `import { useCallback, useEffect } from "react";
declare class Holder { constructor(marker: number); }
const SearchPanel = ({ query }) => {
const load = useCallback(async (value) => { await fetch("/api/items?key=" + value); }, []);
useEffect(() => { load(query); }, [query, load]);
return null;
};
`,
    expectedCount: 1,
  },
];

describe("no-fetch-in-effect native useCallback invocation", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noFetchInEffect, code, nativeCallbackRuleOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
