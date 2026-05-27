import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoImpureMemo } from "./solid-no-impure-memo.js";

describe("solid-no-impure-memo", () => {
  it("flags setter call inside createMemo", () => {
    const result = runRule(
      solidNoImpureMemo,
      `import { createMemo } from "solid-js";
       const doubled = createMemo(() => {
         setOther(value());
         return value() * 2;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setter");
  });

  it("flags console.log inside createMemo", () => {
    const result = runRule(
      solidNoImpureMemo,
      `import { createMemo } from "solid-js";
       const doubled = createMemo(() => {
         console.log("computing");
         return value() * 2;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("console.log()");
  });

  it("does not flag .error() on non-console receiver", () => {
    const result = runRule(
      solidNoImpureMemo,
      `import { createMemo } from "solid-js";
       const result = createMemo(() => validation.error());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags fetch inside createMemo", () => {
    const result = runRule(
      solidNoImpureMemo,
      `import { createMemo } from "solid-js";
       const data = createMemo(() => {
         fetch("/api");
         return cached;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("fetch()");
  });

  it("does not flag pure createMemo", () => {
    const result = runRule(
      solidNoImpureMemo,
      `import { createMemo } from "solid-js";
       const doubled = createMemo(() => count() * 2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag without Solid import", () => {
    const result = runRule(
      solidNoImpureMemo,
      `const doubled = createMemo(() => {
         setOther(value());
         return value() * 2;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
