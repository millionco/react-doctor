import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noWholeObjectDepWithMemberReads } from "./no-whole-object-dep-with-member-reads.js";

describe("no-whole-object-dep-with-member-reads", () => {
  it("flags exact React memo hooks that read static props members", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useCallback, useMemo, useImperativeHandle } from "react";
       function Panel(props) {
         const label = useMemo(() => props.title, [props]);
         const handle = useCallback(() => props.onChange(), [props]);
         useImperativeHandle(props.ref, () => ({ focus: props.onFocus }), [props]);
         return [label, handle];
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("resolves renamed imports and namespace calls", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import React, { useMemo as memoValue } from "react";
       function Panel(props) {
         const first = memoValue(() => props.first, [props]);
         const second = React.useCallback(() => props.second, [props]);
         return [first, second];
       }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("resolves named callbacks and const callback aliases", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useMemo } from "react";
       function Panel(props) {
         function selectLabel() { return props.label; }
         const selectAlias = selectLabel;
         return useMemo(selectAlias, [props]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves const aliases of the props parameter", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useMemo } from "react";
       function Panel(props) {
         const panelProps = props;
         const stableProps = panelProps;
         return useMemo(() => stableProps.label, [panelProps]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("treats static object destructuring as member reads", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useCallback } from "react";
       function Panel(props) {
         return useCallback(() => {
           const { onChange, title: label } = props;
           onChange(label);
         }, [props]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts static computed string and template members", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useMemo } from "react";
       function Panel(props) {
         return useMemo(() => props["title"] + props[\`subtitle\`], [props]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores unbound and local hook lookalikes", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `const useMemo = (callback) => callback();
       function First(props) { return useMemo(() => props.value, [props]); }
       function Second(props) { return useCallback(() => props.value, [props]); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores shadowed React hook imports", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useMemo } from "react";
       function Panel(props) {
         const useMemo = (callback) => callback();
         return useMemo(() => props.value, [props]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores effects", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useEffect, useLayoutEffect } from "react";
       function App(props) {
         useEffect(() => props.onInit(), [props]);
         useLayoutEffect(() => props.onMeasure(), [props]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores destructured component parameters", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useMemo } from "react";
       function Card({ user }) {
         return useMemo(() => user.name, [user]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores dynamic and rest destructuring", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useCallback } from "react";
       function Panel(props) {
         const first = useCallback(() => { const { [key]: value } = props; return value; }, [props]);
         const second = useCallback(() => { const { title, ...rest } = props; return rest; }, [props]);
         return [first, second];
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores dynamic member reads and bare object uses", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useMemo } from "react";
       function Panel(props) {
         const dynamic = useMemo(() => props[key], [props]);
         const spread = useMemo(() => ({ ...props }), [props]);
         const argument = useMemo(() => save(props), [props]);
         return [dynamic, spread, argument];
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores writes through props members", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useCallback } from "react";
       function Panel(props) {
         const assign = useCallback(() => { props.value = 1; }, [props]);
         const update = useCallback(() => { props.count++; }, [props]);
         const remove = useCallback(() => { delete props.value; }, [props]);
         return [assign, update, remove];
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores member dependencies and hook-created objects", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useContext, useMemo } from "react";
       function Panel(props) {
         const context = useContext(Context);
         const first = useMemo(() => props.value, [props.value]);
         const second = useMemo(() => context.value, [context]);
         return [first, second];
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("respects callback and dependency shadowing", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useCallback } from "react";
       function Panel(props) {
         return useCallback((props) => props.value, [props]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores lowercase functions and mutable aliases", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useMemo } from "react";
       function helper(props) { return useMemo(() => props.value, [props]); }
       function Panel(props) {
         let mutableProps = props;
         return useMemo(() => mutableProps.value, [mutableProps]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores reads confined to an unexecuted nested function", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useMemo } from "react";
       function Panel(props) {
         return useMemo(() => {
           const unused = () => props.value;
           return 1;
         }, [props]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps reference analysis linear for wide callbacks", () => {
    const memberReads = Array.from(
      { length: 1_000 },
      (_, memberIndex) => `props.value${memberIndex}`,
    ).join(" + ");
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `import { useMemo } from "react";
       function Panel(props) { return useMemo(() => ${memberReads}, [props]); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("carries the test-noise tag", () => {
    expect(noWholeObjectDepWithMemberReads.tags).toContain("test-noise");
  });

  it("tracks member bindings extracted before the hook", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      'import { useMemo } from "react"; function Panel(props){const {value}=props;return useMemo(()=>value,[props])}',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks synchronous and returned closures", () => {
    const mapped = runRule(
      noWholeObjectDepWithMemberReads,
      'import { useMemo } from "react"; function Panel(props){return useMemo(()=>items.map(()=>props.value),[props])}',
    );
    const returned = runRule(
      noWholeObjectDepWithMemberReads,
      'import { useMemo } from "react"; function Panel(props){return useMemo(()=>({getValue:()=>props.value}),[props])}',
    );
    const promise = runRule(
      noWholeObjectDepWithMemberReads,
      'import { useMemo } from "react"; function Panel(props){return useMemo(()=>new Promise(resolve=>resolve(props.value)),[props])}',
    );
    expect(mapped.diagnostics).toHaveLength(1);
    expect(returned.diagnostics).toHaveLength(1);
    expect(promise.diagnostics).toHaveLength(1);
  });

  it("does not treat nested member writes as reads", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      'import { useCallback } from "react"; function Panel(props){return useCallback(()=>{props.user.name="Ada"},[props])}',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("tracks nested, aliased, and array destructuring of props members", () => {
    const nested = runRule(
      noWholeObjectDepWithMemberReads,
      'import{useMemo}from"react";function Panel(props){const{user:{name}}=props;return useMemo(()=>name,[props])}',
    );
    const aliased = runRule(
      noWholeObjectDepWithMemberReads,
      'import{useMemo}from"react";function Panel(props){const alias=props;const{value}=alias;return useMemo(()=>value,[props])}',
    );
    const array = runRule(
      noWholeObjectDepWithMemberReads,
      'import{useMemo}from"react";function Panel(props){const[first]=props.items;return useMemo(()=>first,[props])}',
    );
    expect(nested.diagnostics).toHaveLength(1);
    expect(aliased.diagnostics).toHaveLength(1);
    expect(array.diagnostics).toHaveLength(1);
  });

  it("tracks a defaulted identifier props parameter", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      'import{useMemo}from"react";interface Props{x?:number}const Panel=(props:Props={})=>useMemo(()=>props.x??0,[props])',
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
