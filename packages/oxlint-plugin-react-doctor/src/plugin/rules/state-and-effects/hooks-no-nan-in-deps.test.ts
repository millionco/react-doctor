import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hooksNoNanInDeps } from "./hooks-no-nan-in-deps.js";

describe("hooks-no-nan-in-deps", () => {
  it("flags `NaN` in a useEffect dep array", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useEffect } from "react";
      const Comp = () => {
        useEffect(() => { doStuff(); }, [NaN]);
        return null;
      };
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("NaN");
  });

  it("flags `Number.NaN` in a useMemo dep array", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useMemo } from "react";
      const Comp = ({ value }) => {
        const memoised = useMemo(() => compute(value), [value, Number.NaN]);
        return memoised;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `NaN` in a useCallback dep array", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useCallback } from "react";
      const Comp = ({ id }) => {
        const handler = useCallback(() => onSelect(id), [id, NaN]);
        return <button onClick={handler}>x</button>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `NaN` in a useImperativeHandle dep array (3rd argument)", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useImperativeHandle } from "react";
      const Comp = ({ ref }) => {
        useImperativeHandle(ref, () => ({ focus: () => {} }), [NaN]);
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `NaN` in a useSignalEffect dep array (Preact signals integration)", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useSignalEffect } from "@preact/signals";
      const Comp = () => {
        useSignalEffect(() => log(), [NaN]);
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a normal dep array", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useEffect } from "react";
      const Comp = ({ id, name }) => {
        useEffect(() => fetch(id), [id, name]);
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag empty deps", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useEffect } from "react";
      const Comp = () => {
        useEffect(() => mountOnce(), []);
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag missing deps array", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useEffect } from "react";
      const Comp = () => {
        useEffect(() => doStuff());
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-hook calls passing NaN", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      const config = createThing("foo", [NaN]);
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags multiple NaN entries in one dep array", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useEffect } from "react";
      const Comp = () => {
        useEffect(() => {}, [NaN, Number.NaN, NaN]);
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(3);
  });
});
