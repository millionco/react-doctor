import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

describe("react-builtins/exhaustive-deps — regressions", () => {
  // A module-scope constant used only as a parameter default is stable
  // across renders, so it must NOT be reported as a missing dependency.
  // Previously a manual (unfiltered) param-default walk added it
  // unconditionally; the scope analyzer now records the reference so the
  // normal module-scope filter excludes it.
  it("does not flag a module-scope constant used as a parameter default", () => {
    const code = `
      const SOME_MODULE_CONST = { a: 1 };
      function MyComponent() {
        return useCallback((opts = SOME_MODULE_CONST) => opts, []);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("SOME_MODULE_CONST");
  });

  // Regression guard for the other direction: a genuine component-scope
  // value used as a parameter default is still reported when omitted from
  // the dependency array (the fix must not silence real findings).
  it("still flags a component-scope value used as a parameter default", () => {
    const code = `
      function MyComponent({ value }) {
        return useCallback((opts = value) => opts, []);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("value");
  });

  // The render callback passed directly to forwardRef/memo is a
  // component by construction, even under a non-PascalCase binding
  // (`const _Wrapped = forwardRef(...)`). Without that promotion the
  // component-scope boundary resolves to null and captures from an
  // enclosing factory scope are wrongly reported as missing deps —
  // they live outside the component, so they can't change between
  // renders.
  it("does not flag factory-scope captures inside a forwardRef callback under an underscore-prefixed binding", () => {
    const code = `
      import { forwardRef, useEffect } from "react";
      const buildComponent = (logger) => {
        const _Wrapped = forwardRef((props, ref) => {
          useEffect(() => {
            logger(props.value);
          }, [props.value]);
          return <div ref={ref} />;
        });
        return _Wrapped;
      };
    `;
    const result = runRule(exhaustiveDeps, code, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("logger");
  });
});
