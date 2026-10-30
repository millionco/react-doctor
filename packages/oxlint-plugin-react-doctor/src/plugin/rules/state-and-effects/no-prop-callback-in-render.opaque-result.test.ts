import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noPropCallbackInRender } from "./no-prop-callback-in-render.js";

interface OpaqueResultCase {
  name: string;
  code: string;
  expectedCount: number;
}

const commonOptions: RunRuleOptions = {
  filename: "synthetic-callback-origin.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: {
    "react-doctor": {
      capabilities: ["react"],
      portedRuleMode: "curated",
    },
  },
};

const cases: OpaqueResultCase[] = [
  {
    name: "opaque-import-owned-method",
    code: 'import { useAdapter } from "adapter"; function Panel({data}) { const {prepare} = useAdapter({data}); prepare(data); return <div/>; }',
    expectedCount: 0,
  },
  {
    name: "opaque-import-forwarded-callback-unknown",
    code: 'import { useAdapter } from "adapter"; function Panel({onSave}) { const {run} = useAdapter({onSave}); run(); return <div/>; }',
    expectedCount: 0,
  },
  {
    name: "direct-destructured-prop",
    code: "function Panel({onSave}) { onSave(); return <div/>; }",
    expectedCount: 1,
  },
  {
    name: "direct-whole-props-method",
    code: "function Panel(props) { props.onSave(); return <div/>; }",
    expectedCount: 1,
  },
  {
    name: "immutable-prop-alias",
    code: "function Panel({onSave}) { const run=onSave; run(); return <div/>; }",
    expectedCount: 1,
  },
  {
    name: "destructured-props-alias",
    code: "function Panel(props) { const {onSave:run}=props; run(); return <div/>; }",
    expectedCount: 1,
  },
  {
    name: "local-hook-parameter-forwarding",
    code: "function useRun(onSave) { onSave(); } function Panel({onSave}) { useRun(onSave); return <div/>; }",
    expectedCount: 1,
  },
  {
    name: "local-returned-callback",
    code: "function useRun(onSave) { return {run:onSave}; } function Panel({onSave}) { const {run}=useRun(onSave); run(); return <div/>; }",
    expectedCount: 1,
  },
  {
    name: "native-usecallback-alias",
    code: 'import {useCallback} from "react"; function Panel({onSave}) { const run=useCallback(onSave,[onSave]); run(); return <div/>; }',
    expectedCount: 0,
  },
  {
    name: "native-usememo-returned-callback",
    code: 'import {useMemo} from "react"; function Panel({onSave}) { const {run}=useMemo(()=>({run:onSave}),[onSave]); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "opaque-import-selected-default",
    code: 'import { useAdapter } from "adapter"; function Panel({data,onSave}) { const {run=onSave}=useAdapter(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "opaque-import-binding-alias",
    code: 'import { useAdapter } from "adapter"; function Panel({data}) { const {prepare}=useAdapter(data); const run=prepare; run(); return <div/>; }',
    expectedCount: 0,
  },
  {
    name: "opaque-import-renamed-callee",
    code: 'import { useAdapter as build } from "adapter"; function Panel({data}) { const {prepare}=build(data); prepare(data); return <div/>; }',
    expectedCount: 0,
  },
  {
    name: "local-shadowed-import",
    code: 'import {useAdapter} from "adapter"; function Panel({onSave}) { const useAdapter=(value)=>({run:value}); const {run}=useAdapter(onSave); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "type-only-import-runtime-use",
    code: 'import type {useAdapter} from "adapter"; function Panel({data}) { const {prepare}=useAdapter(data); prepare(data); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "namespace-import-member-call",
    code: 'import * as adapter from "adapter"; function Panel({data}) { const {prepare}=adapter.useAdapter(data); prepare(data); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "default-import-result",
    code: 'import build from "adapter"; function Panel({data}) { const {run}=build(data); run(); return <div/>; }',
    expectedCount: 0,
  },
  {
    name: "ordinary-import-name-result",
    code: 'import {build} from "adapter"; function Panel({data}) { const {run}=build(data); run(); return <div/>; }',
    expectedCount: 0,
  },
  {
    name: "foreign-usecallback-result",
    code: 'import {useCallback} from "adapter"; function Panel({data}) { const {run}=useCallback(data); run(); return <div/>; }',
    expectedCount: 0,
  },
  {
    name: "multiple-readonly-aliases",
    code: 'import {build} from "adapter"; function Panel({data}) { const {run}=build(data); const first=run; const second=first; second(); return <div/>; }',
    expectedCount: 0,
  },
  {
    name: "let-result-binding",
    code: 'import {build} from "adapter"; function Panel({data}) { let {run}=build(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "var-result-binding",
    code: 'import {build} from "adapter"; function Panel({data}) { var {run}=build(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "mutable-result-alias",
    code: 'import {build} from "adapter"; function Panel({data}) { const {run}=build(data); let alias=run; alias(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "result-assigned-parent-callback",
    code: 'import {build} from "adapter"; function Panel({data,onSave}) { const {run}=build(data); run=onSave; run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "alias-assigned-parent-callback",
    code: 'import {build} from "adapter"; function Panel({data,onSave}) { const {run}=build(data); const alias=run; alias=onSave; alias(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "imported-callee-written",
    code: 'import {build} from "adapter"; function Panel({data,onSave}) { build=onSave; const {run}=build(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "aliased-imported-callee",
    code: 'import {build} from "adapter"; const call=build; function Panel({data}) { const {run}=call(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "optional-import-call",
    code: 'import {build} from "adapter"; function Panel({data}) { const {run}=build?.(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "rest-result-pattern",
    code: 'import {build} from "adapter"; function Panel({data}) { const {run,...rest}=build(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "nested-result-pattern",
    code: 'import {build} from "adapter"; function Panel({data}) { const {nested:{run}}=build(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "computed-result-pattern",
    code: 'import {build} from "adapter"; function Panel({data,key}) { const {[key]:run}=build(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "sibling-default-result-pattern",
    code: 'import {build} from "adapter"; function Panel({data,onSave}) { const {run,other=onSave}=build(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "duplicate-result-property",
    code: 'import {build} from "adapter"; function Panel({data}) { const {run:first,run:second}=build(data); first(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "inline-type-only-import",
    code: 'import {type build} from "adapter"; function Panel({data}) { const {run}=build(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "native-memo-renamed-import",
    code: 'import {useMemo as memo} from "react"; function Panel({onSave}) { const {run}=memo(()=>({run:onSave}),[onSave]); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "native-memo-namespace",
    code: 'import * as React from "react"; function Panel({onSave}) { const {run}=React.useMemo(()=>({run:onSave}),[onSave]); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "sibling-parent-callback-still-reports",
    code: 'import {build} from "adapter"; function Panel({data,onSave}) { const {run}=build(data); run(); onSave(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "deferred-result-event",
    code: 'import {build} from "adapter"; function Panel({data}) { const {run}=build(data); return <button onClick={()=>run()}/>; }',
    expectedCount: 0,
  },
  {
    name: "consumed-result-value",
    code: 'import {build} from "adapter"; function Panel({data}) { const {run}=build(data); return <div>{run()}</div>; }',
    expectedCount: 0,
  },
  {
    name: "wrapped-import-result",
    code: 'import {build} from "adapter"; function Panel({data}) { const {run}=(build(data) as {run:()=>void}); run(); return <div/>; }',
    expectedCount: 0,
  },
  {
    name: "selected-array-assignment",
    code: 'import {build} from "adapter"; function Panel({data,callbacks}) { const {run}=build(data); [run]=callbacks; run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "selected-object-assignment",
    code: 'import {build} from "adapter"; function Panel({data,callbacks}) { const {run}=build(data); ({run}=callbacks); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "alias-array-assignment",
    code: 'import {build} from "adapter"; function Panel({data,callbacks}) { const {run}=build(data); const alias=run; [alias]=callbacks; alias(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "alias-object-assignment",
    code: 'import {build} from "adapter"; function Panel({data,callbacks}) { const {run}=build(data); const alias=run; ({run:alias}=callbacks); alias(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "provider-array-assignment",
    code: 'import {build} from "adapter"; function Panel({data,providers}) { [build]=providers; const {run}=build(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "provider-object-assignment",
    code: 'import {build} from "adapter"; function Panel({data,providers}) { ({build}=providers); const {run}=build(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "selected-destructuring-for-of",
    code: 'import {build} from "adapter"; function Panel({data,callbacks}) { const {run}=build(data); for ([run] of callbacks) {} run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "alias-destructuring-for-of",
    code: 'import {build} from "adapter"; function Panel({data,callbacks}) { const {run}=build(data); const alias=run; for ({run:alias} of callbacks) {} alias(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "provider-destructuring-for-of",
    code: 'import {build} from "adapter"; function Panel({data,providers}) { for ([build] of providers) {} const {run}=build(data); run(); return <div/>; }',
    expectedCount: 1,
  },
  {
    name: "selected-destructuring-for-in",
    code: 'import {build} from "adapter"; function Panel({data,callbacks}) { const {run}=build(data); for ([run] in callbacks) {} run(); return <div/>; }',
    expectedCount: 1,
  },
];

describe("no-prop-callback-in-render imported object results", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noPropCallbackInRender, code, commonOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
