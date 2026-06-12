import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const runTsx = (code: string) => runRule(rulesOfHooks, code, { filename: "fixture.tsx" });

describe("react-builtins/rules-of-hooks — regressions: HoC callbacks under non-PascalCase bindings", () => {
  it("does not flag hooks in a forwardRef callback bound to an underscore-prefixed name", () => {
    const result = runTsx(`
      import { forwardRef, useState } from "react";
      const _Wrapped = forwardRef((props, ref) => {
        const [value] = useState(0);
        return <div ref={ref}>{value}</div>;
      });
      export const Wrapped = _Wrapped;
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag hooks in a memo callback bound to an underscore-prefixed name", () => {
    const result = runTsx(`
      import { memo, useState } from "react";
      const _Memoized = memo(function (props) {
        const [value] = useState(0);
        return <span>{value}</span>;
      });
      export const Memoized = _Memoized;
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag hooks in a React.forwardRef callback assigned to a lowercase binding", () => {
    const result = runTsx(`
      import * as React from "react";
      const _wrapped = React.forwardRef((props, ref) => {
        React.useEffect(() => {}, []);
        return <div ref={ref} />;
      });
      export default _wrapped;
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag hooks in a forwardRef callback inside memo(forwardRef(...))", () => {
    const result = runTsx(`
      import { memo, forwardRef, useState } from "react";
      const _Wrapped = memo(
        forwardRef((props, ref) => {
          const [value] = useState(0);
          return <div ref={ref}>{value}</div>;
        }),
      );
      export const Wrapped = _Wrapped;
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags hooks in a non-component underscore-prefixed function", () => {
    const result = runTsx(`
      import { useState } from "react";
      const _helper = () => {
        const [value] = useState(0);
        return value;
      };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags hooks in a named callback passed to an arbitrary non-React HoC", () => {
    const result = runTsx(`
      import { useState } from "react";
      const _wrapped = trackEvents(function _process() {
        const [value] = useState(0);
        return value;
      });
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
