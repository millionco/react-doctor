import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";

const runRuleForCode = (code: string) =>
  runRule(noRefCallbackCleanupBeforeReact19, code, { filename: "src/tree.tsx" });

describe("no-ref-callback-cleanup-before-react-19", () => {
  it("reports the exact Nteract callback-ref cleanup shape", () => {
    const result = runRuleForCode(`
      const TreeItem = ({ itemRefs, node }) => (
        <li
          ref={(element) => {
            if (element) itemRefs.current.set(node.id, element);
            return () => { itemRefs.current.delete(node.id); };
          }}
        />
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("React 18");
  });

  it("reports concise and conditionally returned cleanup functions", () => {
    const result = runRuleForCode(`
      const Examples = ({ remove }) => (
        <>
          <div ref={(node) => () => remove(node)} />
          <span ref={(node) => node ? () => remove(node) : undefined} />
          <button ref={(node) => node && (() => remove(node))} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports immutable local callbacks and aliases", () => {
    const result = runRuleForCode(`
      const Component = ({ remove, condition }) => {
        const attach = (node) => {
          return () => remove(node);
        };
        const attachAlias = attach;
        const attachWithoutCleanup = (node) => { remove(node); };
        return (
          <>
            <div ref={attachAlias} />
            <span ref={condition ? attachWithoutCleanup : attach} />
          </>
        );
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports immutable function declaration callbacks and aliases", () => {
    const result = runRuleForCode(`
      const Component = ({ remove }) => {
        const attachAlias = attach;
        return <><div ref={attach} /><span ref={attachAlias} /></>;

        function attach(node) {
          return () => remove(node);
        }
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports callbacks stabilized with React useCallback", () => {
    const result = runRuleForCode(`
      import React, { useCallback as useStableCallback } from "react";
      const Component = ({ remove }) => {
        const firstRef = React.useCallback((node) => () => remove(node), [remove]);
        const secondRef = useStableCallback((node) => {
          return () => remove(node);
        }, [remove]);
        return <><div ref={firstRef} /><span ref={secondRef} /></>;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays silent for React 18-compatible null-detach callbacks", () => {
    const result = runRuleForCode(`
      const Component = ({ itemRefs, id }) => (
        <li ref={(element) => {
          if (element) itemRefs.current.set(id, element);
          else itemRefs.current.delete(id);
        }} />
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not mistake nested function returns for ref callback returns", () => {
    const result = runRuleForCode(`
      const Component = ({ subscribe }) => (
        <div ref={(node) => {
          const register = () => {
            return () => subscribe(node);
          };
          register();
        }} />
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report statically unreachable logical cleanup branches", () => {
    const result = runRuleForCode(`
      const Component = ({ remove }) => (
        <>
          <div ref={(node) => false && (() => remove(node))} />
          <span ref={(node) => true || (() => remove(node))} />
          <button ref={(node) => "attached" ?? (() => remove(node))} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report statically unreachable conditional cleanup branches", () => {
    const result = runRuleForCode(`
      const safeRef = (node) => { node?.focus(); };
      const Component = ({ remove }) => (
        <>
          <div ref={false ? ((node) => () => remove(node)) : safeRef} />
          <span ref={true ? safeRef : ((node) => () => remove(node))} />
          <button ref={0 ? ((node) => () => remove(node)) : safeRef} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for unknown, mutable, async, and non-ref callbacks", () => {
    const result = runRuleForCode(`
      import { importedRef } from "./refs";
      let mutableRef = (node) => () => node.remove();
      function reassignedRef(node) { return () => node.remove(); }
      reassignedRef = (node) => { node?.focus(); };
      const handlers = { ref: (node) => () => node.remove() };
      const Component = ({ providedRef }) => (
        <>
          <div ref={importedRef} />
          <div ref={mutableRef} />
          <div ref={reassignedRef} />
          <div ref={handlers.ref} />
          <div ref={providedRef} />
          <div ref={async (node) => () => node.remove()} />
          <div onClick={(event) => () => event.preventDefault()} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
