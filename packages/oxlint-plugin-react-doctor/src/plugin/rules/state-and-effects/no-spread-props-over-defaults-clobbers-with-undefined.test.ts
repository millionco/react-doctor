import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSpreadPropsOverDefaultsClobbersWithUndefined } from "./no-spread-props-over-defaults-clobbers-with-undefined.js";

describe("no-spread-props-over-defaults-clobbers-with-undefined", () => {
  it("flags an optional defaulted key that reaches a computation", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `interface Props { width?: number; label: string }
       const defaultProps = { width: 100 };
       const Panel = (props: Props) => { const merged = { ...defaultProps, ...props }; return <div>{merged.width * 2}</div>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses key-specific optionality instead of any optional property", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `interface Props { width: number; label?: string }
       const defaultProps = { width: 100, label: "x" };
       const Panel = (props: Props) => { const merged = { ...defaultProps, ...props }; return <div>{merged.width * 2}</div>; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a required property whose type explicitly includes undefined", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `type Props = { width: number | undefined };
       const defaults = { width: 100 };
       const useWidth = (props: Props) => { const merged = { ...defaults, ...props }; return Math.round(merged.width); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows parameter and merge aliases by symbol", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `interface Props { width?: number }
       const defaults = { width: 100 };
       const Panel = (props: Props) => { const incoming = props; const merged = { ...defaults, ...incoming }; const alias = merged; return <div>{alias.width * 2}</div>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not confuse a shadowed object with the merge result", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `interface Props { width?: number }
       const defaults = { width: 100 };
       const Panel = (props: Props) => { const merged = { ...defaults, ...props }; return [1].map(() => { const merged = { width: 2 }; return merged.width * 2; }); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes use-site, destructuring, object-literal, and assignment repairs", () => {
    const useSite = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `interface Props { width?: number } const defaults = { width: 100 }; const A = (props: Props) => { const merged = { ...defaults, ...props }; return (merged.width ?? 100) * 2; };`,
    );
    const destructuring = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `interface Props { width?: number } const defaults = { width: 100 }; const B = (props: Props) => { const { width = 100 } = { ...defaults, ...props }; return width * 2; };`,
    );
    const objectLiteral = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `interface Props { width?: number } const defaults = { width: 100 }; const C = (props: Props) => { const merged = { ...defaults, ...props, width: props.width ?? 100 }; return merged.width * 2; };`,
    );
    const assignment = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `interface Props { width?: number } const defaults = { width: 100 }; const D = (props: Props) => { const merged = { ...defaults, ...props }; merged.width ??= 100; return merged.width * 2; };`,
    );
    expect(useSite.diagnostics).toHaveLength(0);
    expect(destructuring.diagnostics).toHaveLength(0);
    expect(objectLiteral.diagnostics).toHaveLength(0);
    expect(assignment.diagnostics).toHaveLength(0);
  });

  it("requires a proven nonundefined value from visible defaults", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `interface Props { width?: number }
       const maybeWidth = getWidth();
       const defaults = { width: maybeWidth };
       const Panel = (props: Props) => { const merged = { ...defaults, ...props }; return merged.width * 2; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag computations on keys absent from visible defaults", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `interface Props { width?: number; color?: string }
       const defaults = { color: "red" };
       const Panel = (props: Props) => { const merged = { ...defaults, ...props }; return merged.width * 2; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag props sanitized through a call", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `interface Props { width?: number }
       const defaults = { width: 100 };
       const Panel = (props: Props) => { const definedProps = pickDefined(props); const merged = { ...defaults, ...definedProps }; return merged.width * 2; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("handles many merges without rescanning the component per merge", () => {
    const merges = Array.from(
      { length: 1600 },
      (_, mergeIndex) =>
        `const merged${mergeIndex} = { ...defaults, ...props }; total += merged${mergeIndex}.width;`,
    ).join("\n");
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `interface Props { width?: number } const defaults = { width: 100 }; const Panel = (props: Props) => { let total = 0; ${merges} return total; };`,
    );
    expect(result.diagnostics).toHaveLength(1600);
  });

  it("abstains when visible defaults do not prove the computed key", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props { width?: number } const Panel = (props: Props) => { const merged = { ...Panel.defaultProps, ...props }; return merged.width * 2; }; Panel.defaultProps = { color: 'red' };",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes branch guards and loose null checks", () => {
    const ternary = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props { width?: number } const defaults={width:100}; const Panel=(props:Props)=>{const merged={...defaults,...props};return merged.width===undefined?100:merged.width*2}",
    );
    const guarded = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props { width?: number } const defaults={width:100}; const Panel=(props:Props)=>{const merged={...defaults,...props};if(merged.width!=null)return merged.width*2;return 0}",
    );
    const strictNull = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props { width?: number } const defaults={width:100}; const Panel=(props:Props)=>{const merged={...defaults,...props};if(merged.width!==null)return merged.width*2;return 0}",
    );
    expect(ternary.diagnostics).toHaveLength(0);
    expect(guarded.diagnostics).toHaveLength(0);
    expect(strictNull.diagnostics).toHaveLength(1);
  });

  it("supports inherited, wrapped, union, and intersection optional keys", () => {
    const inherited = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Base { width?: number } interface Props extends Base { label: string } const defaults={width:100}; const Panel=(props:Props)=>{const merged={...defaults,...props};return merged.width*2}",
    );
    const wrapped = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "type Props=Readonly<Partial<{width:number}>>; const defaults={width:100}; const Panel=(props:Props)=>{const merged={...defaults,...props};return merged.width*2}",
    );
    const intersection = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "type Props={width?:number}&{label:string}; const defaults={width:100}; const Panel=(props:Props)=>{const merged={...defaults,...props};return merged.width*2}",
    );
    expect(inherited.diagnostics).toHaveLength(1);
    expect(wrapped.diagnostics).toHaveLength(1);
    expect(intersection.diagnostics).toHaveLength(1);
  });

  it("stays quiet for recursive type aliases it cannot resolve safely", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "type Props=Readonly<RecursiveProps>; type RecursiveProps=Props; const defaults={width:100}; const Panel=(props:Props)=>{const merged={...defaults,...props};return merged.width*2}",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses last-write semantics for defaults and repairs", () => {
    const duplicateDefault = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number} const defaults={width:100,width:undefined}; const Panel=(props:Props)=>{const merged={...defaults,...props};return merged.width*2}",
    );
    const invalidatedRepair = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number} const defaults={width:100}; const Panel=(props:Props)=>{const merged={...defaults,...props};merged.width=100;merged.width=undefined;return merged.width*2}",
    );
    expect(duplicateDefault.diagnostics).toHaveLength(0);
    expect(invalidatedRepair.diagnostics).toHaveLength(1);
  });

  it("accepts truthiness guards in conditional and branch forms", () => {
    const conditional = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:100};const Panel=(props:Props)=>{const merged={...defaults,...props};return merged.width?merged.width*2:0}",
    );
    const branch = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:100};const Panel=(props:Props)=>{const merged={...defaults,...props};if(!merged.width)return 0;return merged.width*2}",
    );
    expect(conditional.diagnostics).toHaveLength(0);
    expect(branch.diagnostics).toHaveLength(0);
  });

  it("finds defaults and props spreads with unrelated spreads around them", () => {
    const leading = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:100};const Panel=(props:Props)=>{const merged={...theme,...defaults,...props};return merged.width*2}",
    );
    const intervening = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:100};const Panel=(props:Props)=>{const merged={...defaults,...theme,...props};return merged.width*2}",
    );
    const trailing = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:100};const Panel=(props:Props)=>{const merged={...defaults,...props,...theme};return merged.width*2}",
    );
    expect(leading.diagnostics).toHaveLength(1);
    expect(intervening.diagnostics).toHaveLength(1);
    expect(trailing.diagnostics).toHaveLength(1);
  });

  it("invalidates an earlier guard after a later unsafe write", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:100};const Panel=(props:Props)=>{const merged={...defaults,...props};if(merged.width){merged.width=undefined;return merged.width*2}return 0}",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("models later spreads, conditional repairs, and member computations", () => {
    const finalDefaults = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:100};const C=(props:Props)=>{const merged={...defaults,...props,...defaults};return merged.width*2}",
    );
    const conditionalRepair = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:100};const C=(props:Props)=>{const merged={...defaults,...props};if(merged.width===undefined){merged.width=100}return merged.width*2}",
    );
    const conditionalWrite = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number;flag:boolean}const defaults={width:100};const C=(props:Props)=>{const merged={...defaults,...props};if(props.flag)merged.width=100;return merged.width*2}",
    );
    const logicalRepair = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:100};const C=(props:Props)=>{const merged={...defaults,...props};merged.width||=100;return merged.width*2}",
    );
    const memberCall = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:100};const C=(props:Props)=>{const merged={...defaults,...props};return merged.width.toFixed(2)}",
    );
    const updateExpression = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:100};const C=(props:Props)=>{const merged={...defaults,...props};return merged.width++}",
    );
    expect(finalDefaults.diagnostics).toHaveLength(0);
    expect(conditionalRepair.diagnostics).toHaveLength(0);
    expect(conditionalWrite.diagnostics).toHaveLength(1);
    expect(logicalRepair.diagnostics).toHaveLength(0);
    expect(memberCall.diagnostics).toHaveLength(1);
    expect(updateExpression.diagnostics).toHaveLength(1);
  });
});
