import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { asyncDeferAwait } from "./async-defer-await.js";
interface CallbackPublicationCase {
  name: string;
  code: string;
  expectedCount: number;
}
const commonOptions: RunRuleOptions = {
  filename: "src/example.tsx",
  forceJsx: true,
  includeLocations: true,
};
const cases: CallbackPublicationCase[] = [
  {
    name: "object-write-callback-option",
    code: 'export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => { sink.url = "/next"; }; const result = await execute({paint}); if (sink.url) return null; return result; };\n',
    expectedCount: 0,
  },
  {
    name: "whole-object-call-exposure",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 0,
  },
  {
    name: "async-jsx-context-publication",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = async () => render(<View context={sink}/>); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 0,
  },
  {
    name: "inline-direct-callback",
    code: 'export const runView = async (execute, consume, render) => { const sink = {}; const result = await execute(() => { sink.url = "/next"; }); if (sink.url) return null; return result; };\n',
    expectedCount: 0,
  },
  {
    name: "options-rest-possible-publication",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const options = {}; const result = await execute({paint, ...options}); if (sink.url) return null; return result; };\n",
    expectedCount: 0,
  },
  {
    name: "independent-object-callback",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const other = {}; const paint = () => render(other); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "member-read-only",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => consume(sink.url); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "shadowed-object-name",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = (sink) => render(sink); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "callback-not-transported",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute({value: 1}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "unrelated-bare-guard",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const disabled = false; const result = await execute({paint}); if (disabled) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "callback-const-alias-deferred",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const alias = paint; const result = await execute({paint: alias}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "object-alias-deferred",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const alias = sink; const paint = () => render(alias); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "deeper-closure-deferred",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => { const later = () => render(sink); return 1; }; const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "ordinary-data-await",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const result = await execute({value: 1}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "unrelated-property-write",
    code: 'export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => { sink.other = "/next"; }; const result = await execute({paint}); if (sink.url) return null; return result; };\n',
    expectedCount: 1,
  },
  {
    name: "inline-async-callback",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const result = await execute(async () => render(sink)); if (sink.url) return null; return result; };\n",
    expectedCount: 0,
  },
  {
    name: "renamed-options-property",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute({onPaint: paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 0,
  },
  {
    name: "callback-binding-written",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); paint = replacement; const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "mutable-callback-binding",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; let paint = () => render(sink); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "mutable-object-binding",
    code: "export const runView = async (execute, consume, render) => { let sink = {}; const paint = () => render(sink); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "nonempty-object-initializer",
    code: "export const runView = async (execute, consume, render) => { const sink = {url: null}; const paint = () => render(sink); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "callback-function-declaration",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; function paint() { render(sink); } const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "options-object-method",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const result = await execute({paint() { render(sink); }}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "options-getter",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute({get paint() { return paint; }}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "duplicate-callback-key",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute({paint, paint: () => null}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "duplicate-unrelated-key",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute({paint, label: 1, label: 2}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "computed-callback-key",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute({[kind]: paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "options-object-alias-deferred",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const options = {paint}; const result = await execute(options); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "spread-only-callback-deferred",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute({...{paint}}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "optional-awaited-call",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute?.({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "callback-without-publication",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => 1; const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "same-property-update",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => { sink.url++; }; const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 0,
  },
  {
    name: "nested-iife-deferred",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => { (() => render(sink))(); }; const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "callback-declared-after-use",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const result = await execute({paint}); if (sink.url) return null; return result; const paint = () => render(sink); };\n",
    expectedCount: 1,
  },
  {
    name: "genuine-eval-reference",
    code: "export const runView = async (execute, consume, render) => { void eval; const sink = {}; const paint = () => render(sink); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "ordinary-global-read",
    code: "export const runView = async (execute, consume, render) => { void console; const sink = {}; const paint = () => render(sink); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 0,
  },
  {
    name: "runtime-enum-owner",
    code: "export const runView = async (execute, consume, render) => { enum Marker { Value = 1 } const sink = {}; const paint = () => render(sink); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "erased-type-annotation",
    code: "export const runView = async (execute, consume, render) => { interface Marker { value: string } const sink: object = {}; const paint = () => render(<View context={sink}/>); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 0,
  },
  {
    name: "legacy-reassigned-object-quiet",
    code: "export const runView = async (execute, consume, render) => { let sink = {}; sink = {}; const paint = () => render(sink); const result = await execute({paint}); if (sink.url) return null; return result; };\n",
    expectedCount: 0,
  },
  {
    name: "ordinary-extra-options",
    code: 'export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute({paint, label: "view", size: 1}); if (sink.url) return null; return result; };\n',
    expectedCount: 0,
  },
  {
    name: "static-computed-guard-key",
    code: 'export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => { sink.url = "/next"; }; const result = await execute({paint}); if (sink["url"]) return null; return result; };\n',
    expectedCount: 0,
  },
  {
    name: "static-computed-write-key",
    code: 'export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => { sink["url"] = "/next"; }; const result = await execute({paint}); if (sink.url) return null; return result; };\n',
    expectedCount: 0,
  },
  {
    name: "dead-callback-write",
    code: 'export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => { if (false) sink.url = "/next"; }; const result = await execute({paint}); if (sink.url) return null; return result; };\n',
    expectedCount: 1,
  },
  {
    name: "guard-constructs-unused-closure",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute({paint}); if (() => sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "guard-property-assignment-not-read",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute({paint}); if ((sink.url = false)) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "known-literal-spread-overwrites-callback",
    code: "export const runView = async (execute, consume, render) => { const sink = {}; const paint = () => render(sink); const result = await execute({paint, ...{paint: () => null}}); if (sink.url) return null; return result; };\n",
    expectedCount: 1,
  },
  {
    name: "object-interface-after-value",
    code: 'export const runView = async (execute) => {  const sink = {}; interface sink {}  const paint = () => { sink.url="/next"; };  const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 0,
  },
  {
    name: "object-type-alias-after-value",
    code: 'export const runView = async (execute) => {  const sink = {}; type sink = unknown;  const paint = () => { sink.url="/next"; };  const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 0,
  },
  {
    name: "callback-interface-after-value",
    code: 'export const runView = async (execute) => {  const sink = {};   const paint = () => { sink.url="/next"; }; interface paint {} const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 0,
  },
  {
    name: "both-type-space-names",
    code: 'export const runView = async (execute) => {  const sink = {}; interface sink {}  const paint = () => { sink.url="/next"; }; type paint = unknown; const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 0,
  },
  {
    name: "object-interface-before-value",
    code: 'export const runView = async (execute) => { interface sink {} const sink = {};   const paint = () => { sink.url="/next"; };  const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 0,
  },
  {
    name: "callback-interface-before-value",
    code: 'export const runView = async (execute) => {  const sink = {};  interface paint {} const paint = () => { sink.url="/next"; };  const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 0,
  },
  {
    name: "inner-type-resolves-outer-object",
    code: 'export const runView = async (execute) => {  const sink = {};   const paint = () => { interface sink {} sink.url="/next"; };  const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 0,
  },
  {
    name: "typed-inner-object-remains-independent",
    code: 'export const runView = async (execute) => {  const sink = {};   const paint = () => { const sink={}; interface sink {} sink.url="/next"; };  const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 1,
  },
  {
    name: "typed-unrelated-property-remains-independent",
    code: 'export const runView = async (execute) => {  const sink = {}; interface sink {}  const paint = () => { sink.other="/next"; };  const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 1,
  },
  {
    name: "callback-write-under-erased-name",
    code: 'export const runView = async (execute) => {  const sink = {};   const paint = () => { sink.url="/next"; }; interface paint {} paint = replacement; const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 1,
  },
  {
    name: "callback-pattern-write-under-erased-name",
    code: 'export const runView = async (execute) => {  const sink = {};   const paint = () => { sink.url="/next"; }; interface paint {} [paint] = replacements; const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 1,
  },
  {
    name: "typed-callback-alias-remains-unsupported",
    code: 'export const runView = async (execute) => {  const sink = {};   const paint = () => { sink.url="/next"; }; const alias=paint; interface alias {} const result = await execute({paint: alias}); if(sink.url) return null; return result; };',
    expectedCount: 1,
  },
  {
    name: "typed-mutable-callback-remains-unsupported",
    code: 'export const runView = async (execute) => {  const sink = {};   let paint = () => { sink.url="/next"; }; interface paint {} const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 1,
  },
  {
    name: "typed-nonempty-object-remains-unsupported",
    code: 'export const runView = async (execute) => {  const sink = {url:null}; interface sink {}  const paint = () => { sink.url="/next"; };  const result = await execute({paint}); if(sink.url) return null; return result; };',
    expectedCount: 1,
  },
  {
    name: "typed-shadowed-callback-remains-independent",
    code: 'export const runView=async(execute)=>{const sink={}; const paint=()=>{sink.url="/next"}; {const paint=()=>null;interface paint{};const result=await execute({paint});if(sink.url)return null;return result}};',
    expectedCount: 1,
  },
  {
    name: "inner-type-resolves-outer-callback",
    code: 'export const runView=async(execute)=>{const sink={};const paint=()=>{sink.url="/next"};{interface paint{};const result=await execute({paint});if(sink.url)return null;return result}};',
    expectedCount: 0,
  },
];
describe("awaited callback guard-object publication", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(asyncDeferAwait, code, commonOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
