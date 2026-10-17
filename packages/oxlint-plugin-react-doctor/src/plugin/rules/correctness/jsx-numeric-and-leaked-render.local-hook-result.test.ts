import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { jsxNumericAndLeakedRender } from "./jsx-numeric-and-leaked-render.js";

interface NumericResultCase {
  name: string;
  code: string;
  expectedCount: number;
  files: Readonly<Record<string, string>>;
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "numeric-result-source-"));
const commonOptions: RunRuleOptions = {
  forceJsx: true,
  includeLocations: true,
};
const commonReactSettings = { capabilities: ["react"], portedRuleMode: "curated" };
const cases: NumericResultCase[] = [
  {
    name: "local-number-or-undefined",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 1,
    files: {},
  },
  {
    name: "relative-number-or-undefined",
    code: 'import {useEntries} from "./use-entries.ts";\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 1,
    files: {
      "use-entries.ts":
        "export function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\n",
    },
  },
  {
    name: "renamed-return-field",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example=({items})=>{ const {count:amount}=useEntries(items); return <section>{amount && <output>Ready</output>}</section>; };\n",
    expectedCount: 1,
    files: {},
  },
  {
    name: "existing-direct-length",
    code: "export const Example=({items})=><section>{items.length && <output>Ready</output>}</section>;\n",
    expectedCount: 1,
    files: {},
  },
  {
    name: "boolean-result",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length > 0 : false; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "string-result",
    code: 'function useEntries(items) { const entries = []; const count = Array.isArray(items) ? "ready" : ""; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "foreign-package-result",
    code: 'import {useEntries} from "foreign-counts";\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-spread",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count, ...other }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "mutable-destructured-count",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { let {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "explicit-positive-comparison",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count > 0 && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "positive-guard-alias",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example=({items})=>{const {count}=useEntries(items);const hasEntries=count>0;return <section>{hasEntries && count && <output>Ready</output>}</section>;};\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "explicit-ternary",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example=({items})=>{const {count}=useEntries(items);return <section>{count ? <output>Ready</output> : null}</section>;};\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "shadowed-array-predicate",
    code: "const Array={isArray:()=>true};\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "mixed-own-return",
    code: 'function useEntries(items){if(items.special)return {entries:[],count:""};const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "opaque-dynamic-return",
    code: "function useEntries(items){return obtainEntries(items);}\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "native-state-array-setup",
    code: 'import {useState,useEffect,useCallback} from "react";\nfunction useEntries(items){const[entries,writeEntries]=useState([]);const count=Array.isArray(items)?items.length:undefined;const refresh=useCallback(()=>writeEntries(items),[items]);useEffect(()=>{refresh();},[refresh]);return {entries,count};}\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 1,
    files: {},
  },
  {
    name: "null-alternate",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : null; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 1,
    files: {},
  },
  {
    name: "const-local-provider",
    code: "const useEntries = (items) => { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; };\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 1,
    files: {},
  },
  {
    name: "renamed-relative-value-import",
    code: 'import {useEntries as obtain} from "./use-entries.ts";\nexport const Example = ({items}) => { const {entries,count}=obtain(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 1,
    files: {
      "use-entries.ts":
        "export function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\n",
    },
  },
  {
    name: "type-only-relative-import",
    code: 'import type {useEntries} from "./use-entries.ts";\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {
      "use-entries.ts":
        "export function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\n",
    },
  },
  {
    name: "namespace-relative-import",
    code: 'import * as entriesModule from "./use-entries.ts";\nexport const Example = ({items}) => { const {entries,count}=entriesModule.useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {
      "use-entries.ts":
        "export function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\n",
    },
  },
  {
    name: "default-relative-import",
    code: 'import useEntries from "./use-entries.ts";\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {
      "use-entries.ts":
        "export default function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\n",
    },
  },
  {
    name: "mutable-provider-binding",
    code: "let useEntries = (items) => { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; };\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "replaced-provider-function",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nuseEntries = alternate;\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "written-imported-provider",
    code: 'import {useEntries} from "./use-entries.ts";\n[useEntries]=alternate;\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {
      "use-entries.ts":
        "export function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\n",
    },
  },
  {
    name: "selected-array-pattern-write",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); [count]=alternate; return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "selected-object-pattern-write",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); ({count}=alternate); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "provider-parameter-write",
    code: "function useEntries(items) { items=[]; const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "mutable-provider-count",
    code: "function useEntries(items) { const entries = []; let count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "computed-return-field",
    code: 'function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, ["count"]: count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "getter-return-field",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, get count(){ return count; } }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "method-return-field",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count(){ return count; } }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "duplicate-return-field",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count, count:other }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "rest-consumer-pattern",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count,...other}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "default-consumer-count",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count=1}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "unknown-count-alias",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); const amount=count; return <section>{entries && amount && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "direct-count-positive-guard",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count>0 && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "literal-false-before-count",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{false && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "conditional-render-return",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); if(!items)return null; return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "provider-nonzero-only-completion",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; if(!count)throw Error(); return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "constructed-provider-callback",
    code: 'function useEntries(items) { const later=()=>{ return "unrelated"; }; const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 1,
    files: {},
  },
  {
    name: "array-provider-alias-exposure",
    code: "const listApi=Array;\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "array-predicate-replacement",
    code: "Array.isArray=alternate;\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "global-array-provider-replacement",
    code: "globalThis.Array.isArray=alternate;\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "local-array-lookalike",
    code: "const Array={isArray:()=>true};\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "react-namespace-exposure",
    code: 'import * as React from "react";\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "react-default-exposure",
    code: 'import React from "react";\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "type-only-react-setup",
    code: 'import type {useState,useEffect,useCallback} from "react";\nfunction useEntries(items){const[entries,writeEntries]=useState([]);const count=Array.isArray(items)?items.length:undefined;const refresh=useCallback(()=>writeEntries(items),[items]);useEffect(()=>{refresh();},[refresh]);return {entries,count};}\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "foreign-react-setup",
    code: 'import {useState,useEffect,useCallback} from "foreign-react";\nfunction useEntries(items){const[entries,writeEntries]=useState([]);const count=Array.isArray(items)?items.length:undefined;const refresh=useCallback(()=>writeEntries(items),[items]);useEffect(()=>{refresh();},[refresh]);return {entries,count};}\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "global-require-exposure",
    code: "const loader=require;\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "builtin-module-carrier",
    code: 'import {createRequire} from "node:module";\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "global-eval-exposure",
    code: "const evaluator=eval;\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "global-function-exposure",
    code: "const constructor=Function;\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "static-constructor-projection",
    code: "const constructor=(()=>null).constructor;\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "pattern-constructor-projection",
    code: "const {constructor}=()=>null;\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "nested-render-callback",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries.map(()=>count && <output>Ready</output>)}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "async-provider",
    code: "async function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "generator-provider",
    code: "function* useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "opaque-own-call-completion",
    code: "function useEntries(items) { mustComplete(items); const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "different-count-parameter",
    code: "function useEntries(items,other) { const entries = []; const count = Array.isArray(items) ? other.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "shadowed-undefined",
    code: 'function useEntries(items) { const undefined="empty"; const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "parameter-pattern-write",
    code: "function useEntries(items) { [items]=alternate; const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "provider-count-loop-write",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; for([count] of alternate){} return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "shadowed-global-name",
    code: "const Function=()=>null; const evalValue={eval:()=>null};\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 1,
    files: {},
  },
  {
    name: "type-only-loader-carrier",
    code: 'import type {Module} from "node:module";\nfunction useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 1,
    files: {},
  },
  {
    name: "safe-fragment-child",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <>{entries && count && <output>Ready</output>}</>; };\n",
    expectedCount: 1,
    files: {},
  },
  {
    name: "unconditional-owner-throw",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); throw Error(); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "literal-null-before-count",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{null && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "readonly-positive-alias-written",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); const positive=count>0; [positive]=alternate; return <section>{positive && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 1,
    files: {},
  },
  {
    name: "literal-nullish-safe-alternate",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count:count ? count : null }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "empty-array-actual-argument",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries([]); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 1,
    files: {},
  },
  {
    name: "nonempty-array-actual-argument",
    code: 'function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(["ready"]); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "primitive-actual-argument",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(1); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "function-actual-argument",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(()=>[]); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "readonly-function-actual-alias",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const input=()=>[]; const {entries,count}=useEntries(input); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "conditional-empty-array-input",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items ? [] : ()=>[]); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 1,
    files: {},
  },
  {
    name: "lazy-state-initializer",
    code: 'import {useState} from "react";\nfunction useEntries(items) { const state=useState(()=>{if(!items.length)throw Error(); return 1;}); const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "aliased-lazy-state-initializer",
    code: 'import {useState} from "react";\nfunction useEntries(items) { const initial=()=>{if(!items.length)throw Error(); return 1;}; const state=useState(initial); const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "called-state-initializer",
    code: 'import {useState} from "react";\nfunction useEntries(items) { const state=useState(check(items)); const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "member-state-initializer",
    code: 'import {useState} from "react";\nfunction useEntries(items) { const state=useState(items.seed); const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "spread-state-initializer",
    code: 'import {useState} from "react";\nfunction useEntries(items) { const state=useState(...args); const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "state-parameter-literal-actual",
    code: 'import {useState} from "react";\nfunction useEntries(items,seed) { const state=useState(seed); const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items,1); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 1,
    files: {},
  },
  {
    name: "state-parameter-function-actual",
    code: 'import {useState} from "react";\nfunction useEntries(items,seed) { const state=useState(seed); const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items,()=>{if(!items.length)throw Error();}); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "deferred-native-effect-body",
    code: 'import {useEffect} from "react";\nfunction useEntries(items) { useEffect(()=>{check(items);},[items]); const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 1,
    files: {},
  },
  {
    name: "selected-array-parameter-state-seed",
    code: 'import {useState} from "react";\nfunction useEntries(items) { const state=useState(items); const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 1,
    files: {},
  },
  {
    name: "mutable-argument-alias",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { let input=items; const {entries,count}=useEntries(input); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "member-actual-argument",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items.value); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 0,
    files: {},
  },
  {
    name: "readonly-empty-array-argument",
    code: "function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const input=[]; const {entries,count}=useEntries(input); return <section>{entries && count && <output>Ready</output>}</section>; };\n",
    expectedCount: 1,
    files: {},
  },
  {
    name: "readonly-nonempty-array-argument",
    code: 'function useEntries(items) { const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const input=["ready"]; const {entries,count}=useEntries(input); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "constructed-callback-state-array",
    code: 'import {useState} from "react";\nfunction useEntries(items) { const state=useState([()=>1]); const entries = []; const count = Array.isArray(items) ? items.length : undefined; return { entries, count }; }\nexport const Example = ({items}) => { const {entries,count}=useEntries(items); return <section>{entries && count && <output>Ready</output>}</section>; };\n',
    expectedCount: 0,
    files: {},
  },
  {
    name: "multi-parameter-native-setup-source-shape",
    code: 'import {useState,useCallback,useEffect} from "react"; function useEntries(seed,limit,items){const[entries,writeEntries]=useState([]); const[page,writePage]=useState(seed); const[ready,writeReady]=useState(true); const count=Array.isArray(items)?items.length:undefined; let pending; const refresh=useCallback(async()=>{await update(items);writeEntries(items);},[limit,items]); const next=()=>writePage(page+1);useEffect(()=>{refresh();},[refresh,page]); return{entries,count,next,refresh,select:(value)=>writePage(value)};} export const Example=({items})=>{const input=items?items:()=>[];const{entries,count}=useEntries(1,10,input);return <section>{entries&&count&&<output>Ready</output>}</section>;};',
    expectedCount: 1,
    files: {},
  },
  {
    name: "empty-array-member-mutation",
    code: 'function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const input=[];input.push("ready");const {count}=useEntries(input);return <section>{count&&<output/>}</section>;};',
    expectedCount: 0,
    files: {},
  },
  {
    name: "empty-array-unknown-transport",
    code: "function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const input=[];consume(input);const {count}=useEntries(input);return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "empty-array-alias-member-mutation",
    code: 'function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const input=[];const alias=input;alias.push("ready");const {count}=useEntries(alias);return <section>{count&&<output/>}</section>;};',
    expectedCount: 0,
    files: {},
  },
  {
    name: "empty-array-closed-alias",
    code: "function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const input=[];const alias=input;const {count}=useEntries(alias);return <section>{count&&<output/>}</section>;};",
    expectedCount: 1,
    files: {},
  },
  {
    name: "input-own-positive-filter",
    code: "function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{mustBeNonempty(items);const {count}=useEntries(items);return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "conditional-test-own-call-filter",
    code: "function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const input=mustBeNonempty(items)?items:[];const {count}=useEntries(input);return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "conditional-inert-test",
    code: "function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const input=items?items:()=>[];const {count}=useEntries(input);return <section>{count&&<output/>}</section>;};",
    expectedCount: 1,
    files: {},
  },
  {
    name: "count-own-call-filter",
    code: "function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const {count}=useEntries(items);mustBePositive(count);return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "count-own-initializer-filter",
    code: "function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const {count}=useEntries(items);const checked=mustBePositive(count);return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "count-own-alias-filter",
    code: "function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const {count}=useEntries(items);const alias=count;mustBePositive(alias);return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "count-own-inert-positive-comparison",
    code: "function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const {count}=useEntries(items);const positive=count>0;return <section>{count&&<output/>}</section>;};",
    expectedCount: 1,
    files: {},
  },
  {
    name: "unrelated-opaque-owner-call",
    code: "function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const context=useContextValue();const {count}=useEntries(items);const view=flag?getView(context):null;return <section>{count&&<output/>}</section>;};",
    expectedCount: 1,
    files: {},
  },
  {
    name: "return-sibling-filter",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count,ignored:count||throwIfZero()};}export const Example=({items})=>{const {count}=useEntries(items);return <section>{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "return-inline-callback",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count,refresh:()=>check(items)};}export const Example=({items})=>{const {count}=useEntries(items);return <section>{count&&<output/>}</section>};",
    expectedCount: 1,
    files: {},
  },
  {
    name: "provider-object-default",
    code: "function useEntries(items){const {missing=throwIfZero(items)}=items;const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const {count}=useEntries(items);return <section>{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "provider-array-default",
    code: "function useEntries(items){const [missing=throwIfZero(items)]=items;const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const {count}=useEntries(items);return <section>{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "native-state-simple-tuple",
    code: 'import {useState} from "react";function useEntries(items){const [entries,writeEntries]=useState([]);const count=Array.isArray(items)?items.length:undefined;return {count,entries};}export const Example=({items})=>{const {count}=useEntries(items);return <section>{count&&<output/>}</section>};',
    expectedCount: 1,
    files: {},
  },
  {
    name: "native-state-defaulted-tuple",
    code: 'import {useState} from "react";function useEntries(items){const [entries=throwIfZero(items),writeEntries]=useState([]);const count=Array.isArray(items)?items.length:undefined;return {count,entries};}export const Example=({items})=>{const {count}=useEntries(items);return <section>{count&&<output/>}</section>};',
    expectedCount: 0,
    files: {},
  },
  {
    name: "type-only-react-runtime-carrier",
    code: 'import type * as React from "react";React.useState=other;function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const {count}=useEntries(items);return <section>{count&&<output/>}</section>;};',
    expectedCount: 0,
    files: {},
  },
  {
    name: "type-only-loader-runtime-carrier",
    code: 'import type {createRequire} from "node:module";const loader=createRequire;function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const {count}=useEntries(items);return <section>{count&&<output/>}</section>;};',
    expectedCount: 0,
    files: {},
  },
  {
    name: "type-only-genuine-type-use",
    code: 'import type {ReactNode} from "react";type Content=ReactNode;function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const {count}=useEntries(items);return <section>{count&&<output/>}</section>;};',
    expectedCount: 1,
    files: {},
  },
  {
    name: "evaluated-ts-export-assignment",
    code: "function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const {count}=useEntries(items);return <section>{count&&<output/>}</section>;};export = sideEffect();",
    expectedCount: 0,
    files: {},
  },
  {
    name: "evaluated-ts-parameter-property",
    code: "class Holder {constructor(public value=sideEffect()){}}function useEntries(items){const entries=[];const count=Array.isArray(items)?items.length:undefined;return {entries,count};}export const Example=({items,flag})=>{const {count}=useEntries(items);return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "literal-true-does-not-select-empty-alternate",
    code: 'function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const {count}=useEntries(true?["ready"]:[]);return <section>{count&&<output/>}</section>;};',
    expectedCount: 0,
    files: {},
  },
  {
    name: "literal-false-selects-empty-alternate",
    code: 'function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const {count}=useEntries(false?["ready"]:[]);return <section>{count&&<output/>}</section>;};',
    expectedCount: 1,
    files: {},
  },
  {
    name: "literal-true-selects-empty-consequent",
    code: 'function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const {count}=useEntries(true?[]:["ready"]);return <section>{count&&<output/>}</section>;};',
    expectedCount: 1,
    files: {},
  },
  {
    name: "literal-zero-selects-empty-alternate",
    code: 'function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const {count}=useEntries(0?["ready"]:[]);return <section>{count&&<output/>}</section>;};',
    expectedCount: 1,
    files: {},
  },
  {
    name: "identifier-test-false-arm-input-is-not-empty",
    code: 'function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const {count}=useEntries(items?["ready"]:items);return <section>{count&&<output/>}</section>;};',
    expectedCount: 0,
    files: {},
  },
  {
    name: "identifier-test-false-arm-empty-is-unsupported",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const {count}=useEntries(items?()=>[]:[]);return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "const-false-test-does-not-select-empty-consequent",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const choose=false;const {count}=useEntries(choose?[]:()=>[]);return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "const-true-test-selects-empty-consequent",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const choose=true;const {count}=useEntries(choose?[]:()=>[]);return <section>{count&&<output/>}</section>;};",
    expectedCount: 1,
    files: {},
  },
  {
    name: "captured-count-before-return-is-unsupported",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const {count}=useEntries(items);const check=()=>mustBePositive(count);check();return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "deferred-count-before-return-still-unsupported",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const {count}=useEntries(items);const check=()=>count;return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-prototype-setter-key-is-unsupported",
    code: "function useEntries(items,prototype){const count=Array.isArray(items)?items.length:undefined;return {__proto__:prototype,count};}export const Example=({items,prototype})=>{const{missing,count}=useEntries(items,prototype);return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "captured-input-before-call-is-unsupported",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const check=()=>mustBeNonempty(items);check();const {count}=useEntries(items);return <section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "literal-condition-alias-selects-actual-empty-arm",
    code: 'function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=({items})=>{const first=false;const choice=first;const {count}=useEntries(choice?["ready"]:[]);return <section>{count&&<output/>}</section>;};',
    expectedCount: 1,
    files: {},
  },
  {
    name: "destructured-input-is-not-whole-initializer-alias",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return {count};}export const Example=()=>{const[input]=[];const{count}=useEntries(input);return <section>{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-array-value-outside-finite-shape",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,ignored:[]};}export const Example=({items})=>{const{count}=useEntries(items);return<section>{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-native-call-outside-finite-shape",
    code: 'import {useState} from"react";function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,ignored:useState(items)};}export const Example=({items})=>{const{count}=useEntries(items);return<section>{count&&<output/>}</section>};',
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-provider-count-capture",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,check:()=>{if(!count)throw Error();}};}export const Example=({items})=>{const{count,check}=useEntries(items);check();return<section>{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-provider-count-alias-capture",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;const checked=count;const check=()=>{if(!checked)throw Error();};return{count,check};}export const Example=({items})=>{const{count,check}=useEntries(items);check();return<section>{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-input-callback-own-call",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,check:()=>mustBeNonempty(items)};}export const Example=({items})=>{const{count,check}=useEntries(items);check();return<section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-input-callback-own-alias-transport",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,check:()=>mustBeNonempty(items)};}export const Example=({items})=>{const{count,check}=useEntries(items);const verify=check;verify();return<section>{count&&<output/>}</section>;};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-input-callback-deferred-jsx",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,check:()=>mustBeNonempty(items)};}export const Example=({items})=>{const{count,check}=useEntries(items);return<section><button onClick={check}>Check</button>{count&&<output/>}</section>;};",
    expectedCount: 1,
    files: {},
  },
  {
    name: "unselected-returned-input-callback",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,check:()=>mustBeNonempty(items)};}export const Example=({items})=>{const{count}=useEntries(items);return<section>{count&&<output/>}</section>;};",
    expectedCount: 1,
    files: {},
  },
  {
    name: "returned-native-callback-own-call",
    code: 'import{useCallback}from"react";function useEntries(items){const count=Array.isArray(items)?items.length:undefined;const check=useCallback(()=>mustBeNonempty(items),[items]);return{count,check};}export const Example=({items})=>{const{count,check}=useEntries(items);check();return<section>{count&&<output/>}</section>;};',
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-state-setter-own-call",
    code: 'import{useState}from"react";function useEntries(items){const[entries,check]=useState([]);const count=Array.isArray(items)?items.length:undefined;return{count,check};}export const Example=({items})=>{const{count,check}=useEntries(items);check([]);return<section>{count&&<output/>}</section>;};',
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-callback-eager-jsx-child",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,check:()=>mustBeNonempty(items)};}export const Example=({items})=>{const{count,check}=useEntries(items);return<section>{check()}{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-callback-eager-jsx-attribute",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,check:()=>mustBeNonempty(items)};}export const Example=({items})=>{const{count,check}=useEntries(items);return<section><button onClick={check()}>Check</button>{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-callback-eager-constructed-iife",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,check:()=>mustBeNonempty(items)};}export const Example=({items})=>{const{count,check}=useEntries(items);return<section><button onClick={(()=>{check();})()}>Check</button>{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "returned-callback-deferred-inline-attribute",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,check:()=>mustBeNonempty(items)};}export const Example=({items})=>{const{count,check}=useEntries(items);return<section><button onClick={()=>{check();}}>Check</button>{count&&<output/>}</section>};",
    expectedCount: 1,
    files: {},
  },
  {
    name: "selected-count-eager-jsx-call",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count};}export const Example=({items})=>{const{count}=useEntries(items);return<section>{mustBePositive(count)}{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "selected-count-eager-jsx-member",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count};}export const Example=({items})=>{const{count}=useEntries(items);return<section>{count.valueOf()}{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "selected-count-guarded-right-arm-math",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count};}export const Example=({items})=>{const{count}=useEntries(items);return<section>{count&&<output>{Math.ceil(count/10)}</output>}</section>};",
    expectedCount: 1,
    files: {},
  },
  {
    name: "selected-count-eager-jsx-arithmetic",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count};}export const Example=({items})=>{const{count}=useEntries(items);return<section>{count/1}{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "explicit-nonshorthand-count-field",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count:count};}export const Example=({items})=>{const{count:count}=useEntries(items);return<section>{count&&<output/>}</section>};",
    expectedCount: 1,
    files: {},
  },
  {
    name: "extra-return-field-is-not-selected-key-mirror",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,other:count};}export const Example=({items})=>{const{count}=useEntries(items);return<section>{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
  {
    name: "extra-captured-count-is-not-selected-key-mirror",
    code: "function useEntries(items){const count=Array.isArray(items)?items.length:undefined;return{count,other:()=>count};}export const Example=({items})=>{const{count}=useEntries(items);return<section>{count&&<output/>}</section>};",
    expectedCount: 0,
    files: {},
  },
];

afterAll(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

describe("jsx-numeric-and-leaked-render local numeric results", () => {
  it.each(cases)("$name", ({ name, code, expectedCount, files }) => {
    const rootDirectory = path.join(fixtureRoot, name);
    fs.mkdirSync(rootDirectory);
    const filename = path.join(rootDirectory, "Example.tsx");
    fs.writeFileSync(filename, code);
    for (const [relative, source] of Object.entries(files))
      fs.writeFileSync(path.join(rootDirectory, relative), source);
    const result = runRule(jsxNumericAndLeakedRender, code, {
      ...commonOptions,
      filename,
      settings: {
        "react-doctor": {
          ...commonReactSettings,
          rootDirectory,
        },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
