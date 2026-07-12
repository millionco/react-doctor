import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { forwardRefUsesRef } from "./forward-ref-uses-ref.js";

const expectDiagnosticCount = (code: string, expectedCount: number): void => {
  const result = runRule(forwardRefUsesRef, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedCount);
};

describe("react-builtins/forward-ref-uses-ref binding provenance", () => {
  it("ignores unrelated local functions named forwardRef", () => {
    expectDiagnosticCount(
      `const forwardRef = (transform: (value: string) => string): string => transform("hello");
       forwardRef((value) => value.toUpperCase());`,
      0,
    );
  });

  it("reports renamed React forwardRef imports with unary callbacks", () => {
    expectDiagnosticCount(
      `import { forwardRef as wrapRef } from "react";
       wrapRef((props) => <button>{props.label}</button>);`,
      1,
    );
  });

  it("reports direct React forwardRef imports with unary callbacks", () => {
    expectDiagnosticCount(
      `import { forwardRef } from "react";
       forwardRef((props) => <button>{props.label}</button>);`,
      1,
    );
  });

  it("ignores direct and renamed React forwardRef callbacks that accept ref", () => {
    expectDiagnosticCount(
      `import { forwardRef, forwardRef as wrapRef } from "react";
       forwardRef((props, ref) => <button ref={ref}>{props.label}</button>);
       wrapRef((props, ref) => <button ref={ref}>{props.label}</button>);`,
      0,
    );
  });
});
