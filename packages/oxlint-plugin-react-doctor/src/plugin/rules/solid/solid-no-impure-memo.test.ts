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

  it("flags DOM mutation inside createMemo", () => {
    const result = runRule(
      solidNoImpureMemo,
      `import { createMemo } from "solid-js";
       const title = createMemo(() => {
         document.title = "updated";
         return count();
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("mutates an external object");
  });

  it("flags addEventListener inside createMemo", () => {
    const result = runRule(
      solidNoImpureMemo,
      `import { createMemo } from "solid-js";
       const val = createMemo(() => {
         el.addEventListener("click", handler);
         return count();
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(".addEventListener()");
  });

  it("does not flag pure memo with conditional logic", () => {
    const result = runRule(
      solidNoImpureMemo,
      `import { createMemo } from "solid-js";
       const label = createMemo(() => {
         if (count() > 10) return "big";
         return "small";
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag pure memo with ternary expression", () => {
    const result = runRule(
      solidNoImpureMemo,
      `import { createMemo } from "solid-js";
       const label = createMemo(() => count() > 10 ? "big" : "small");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
