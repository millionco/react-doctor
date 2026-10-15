import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoUselessFragment } from "./jsx-no-useless-fragment.js";

describe("single-expression fragments returned directly", () => {
  it("optional-render-child", () => {
    const result = runRule(
      jsxNoUselessFragment,
      'import React from "react"; const View=React.memo(({children}:{children?:React.ReactNode})=>{return <>{children}</>;});',
      {
        filename: "fragment-return.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated" } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("unknown-conjunction", () => {
    const result = runRule(
      jsxNoUselessFragment,
      'import React from "react"; const View=({entry}:{entry:{enabled?:boolean}})=>{return <>{entry.enabled && <span/>}</>;};',
      {
        filename: "fragment-return.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated" } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("native-element-return", () => {
    const result = runRule(jsxNoUselessFragment, "const View=()=>{return <><span/></>;};", {
      filename: "fragment-return.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated" } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("native-parent-expression", () => {
    const result = runRule(jsxNoUselessFragment, "const View=({label})=><div><>{label}</></div>;", {
      filename: "fragment-return.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated" } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("empty-fragment", () => {
    const result = runRule(jsxNoUselessFragment, "const View=()=>{return <></>;};", {
      filename: "fragment-return.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated" } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("null-normalized-return", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=({label})=>{return <>{label ?? null}</>;};",
      {
        filename: "fragment-return.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated" } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("defined-conditional", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=({visible})=>{return <>{visible ? <span/> : null}</>;};",
      {
        filename: "fragment-return.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated" } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("unknown-jsx-prop", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=({label})=><Panel content={<>{label}</>}/>;",
      {
        filename: "fragment-return.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated" } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("allow-expressions", () => {
    const result = runRule(jsxNoUselessFragment, "const View=({label})=>{return <>{label}</>;};", {
      filename: "fragment-return.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          jsxNoUselessFragment: { allowExpressions: true },
        },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("keyed-fragment", () => {
    const result = runRule(
      jsxNoUselessFragment,
      'import React from "react"; const View=({label})=>{return <React.Fragment key="label">{label}</React.Fragment>;};',
      {
        filename: "fragment-return.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated" } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("call-expression", () => {
    const result = runRule(jsxNoUselessFragment, "const View=()=>{return <>{getLabel()}</>;};", {
      filename: "fragment-return.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated" } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("comment-only-fragment", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=()=>{return <>{/* explanation */}</>;};",
      {
        filename: "fragment-return.tsx",
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated" } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("named fragment with optional return", () => {
    const result = runRule(
      jsxNoUselessFragment,
      'import { Fragment } from "react"; const View=({label})=><Fragment>{label}</Fragment>;',
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("namespace fragment with optional return", () => {
    const result = runRule(
      jsxNoUselessFragment,
      'import * as React from "react"; const View=({label})=><React.Fragment>{label}</React.Fragment>;',
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("aliased fragment with optional return", () => {
    const result = runRule(
      jsxNoUselessFragment,
      'import { Fragment as Group } from "react"; const View=({label})=><Group>{label}</Group>;',
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("shadowed fragment component", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const Fragment=({children})=><section>{children}</section>; const View=({label})=><Fragment>{label}</Fragment>;",
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("asserted fragment return", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=({label})=>(<>{label}</> as React.ReactNode);",
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("asserted child remains unknown", () => {
    const result = runRule(jsxNoUselessFragment, "const View=({label})=><>{label as string}</>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("non-null child assertion remains unknown", () => {
    const result = runRule(jsxNoUselessFragment, "const View=({label})=><>{label!}</>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("optional member child", () => {
    const result = runRule(jsxNoUselessFragment, "const View=({entry})=><>{entry?.label}</>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("undefined literal return", () => {
    const result = runRule(jsxNoUselessFragment, "const View=()=><>{undefined}</>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("void child return", () => {
    const result = runRule(jsxNoUselessFragment, "const View=()=><>{void 0}</>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("conditional undefined branch", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=({ready})=><>{ready ? <span/> : undefined}</>;",
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("unknown logical right branch", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=({ready,label})=><>{ready || label}</>;",
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("undefined nullish fallback", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=({label})=><>{label ?? undefined}</>;",
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("discarded defined sequence", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=({label})=><>{(null,label) as React.ReactNode}</>;",
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("null child return", () => {
    const result = runRule(jsxNoUselessFragment, "const View=()=><>{null}</>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("false child return", () => {
    const result = runRule(jsxNoUselessFragment, "const View=()=><>{false}</>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("number child return", () => {
    const result = runRule(jsxNoUselessFragment, "const View=()=><>{0}</>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("string child return", () => {
    const result = runRule(jsxNoUselessFragment, 'const View=()=><>{"Label"}</>;', {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("defined nullish fallback", () => {
    const result = runRule(jsxNoUselessFragment, "const View=({label})=><>{label ?? <span/>}</>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("defined logical fallback", () => {
    const result = runRule(jsxNoUselessFragment, "const View=({label})=><>{label || <span/>}</>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("defined conjunction sides", () => {
    const result = runRule(jsxNoUselessFragment, "const View=()=><>{false && <span/>}</>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("undefined left logical fallback", () => {
    const result = runRule(jsxNoUselessFragment, "const View=()=><>{undefined || <span/>}</>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("discarded unknown sequence", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=({label})=><>{(label,null) as React.ReactNode}</>;",
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("named empty fragment", () => {
    const result = runRule(
      jsxNoUselessFragment,
      'import { Fragment } from "react"; const View=()=> <Fragment/>;',
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("html multiple children", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=()=> <main><><span/><span/></></main>;",
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("unknown fragment in array is unchanged", () => {
    const result = runRule(jsxNoUselessFragment, "const View=({label})=>[<>{label}</>];", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("nested conditional return is unchanged", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=({ready,label})=>ready ? <>{label}</> : null;",
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("text whitespace remains meaningful", () => {
    const result = runRule(jsxNoUselessFragment, "const View=()=><> </>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("two expressions unchanged", () => {
    const result = runRule(
      jsxNoUselessFragment,
      "const View=({first,second})=><>{first}{second}</>;",
      { filename: "fragment-return.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("empty settings remain default off metadata", () => {
    const result = runRule(jsxNoUselessFragment, "const View=()=> <><span/></>;", {
      filename: "fragment-return.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("preserves the opt-in policy", () => {
    expect(jsxNoUselessFragment.defaultEnabled).toBe(false);
  });
});
