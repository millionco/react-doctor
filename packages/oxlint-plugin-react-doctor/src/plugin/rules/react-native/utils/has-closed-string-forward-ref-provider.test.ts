import { describe, expect, it, vi } from "vite-plus/test";
import { attachParentReferences } from "../../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import { hasClosedStringForwardRefProvider } from "./has-closed-string-forward-ref-provider.js";

const walkAstCounter = vi.hoisted(() => vi.fn());

vi.mock("../../../utils/walk-ast.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../../utils/walk-ast.js")>();
  return { ...originalModule, walkAst: walkAstCounter.mockImplementation(originalModule.walkAst) };
});

describe("hasClosedStringForwardRefProvider", () => {
  it.each([
    { prefix: "", expected: true },
    { prefix: "require('react').forwardRef = replacement;", expected: false },
  ])("caches positive and negative admission per analysis: $prefix", ({ prefix, expected }) => {
    const parsed = parseFixture(`import {forwardRef} from "react"; ${prefix}`, {
      filename: "native.tsx",
    });
    expect(parsed.errors).toHaveLength(0);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    walkAstCounter.mockClear();
    expect(hasClosedStringForwardRefProvider(scopes, "react")).toBe(expected);
    expect(hasClosedStringForwardRefProvider(scopes, "react")).toBe(expected);
    expect(walkAstCounter).toHaveBeenCalledTimes(1);
  });

  it("keeps source-specific imported provider proofs separate", () => {
    const parsed = parseFixture(
      'import {forwardRef} from "react"; import OtherReact from "preact/compat"; void OtherReact;',
      { filename: "native.tsx" },
    );
    expect(parsed.errors).toHaveLength(0);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    walkAstCounter.mockClear();
    expect(hasClosedStringForwardRefProvider(scopes, "react")).toBe(true);
    expect(hasClosedStringForwardRefProvider(scopes, "preact/compat")).toBe(false);
    expect(hasClosedStringForwardRefProvider(scopes, "react")).toBe(true);
    expect(hasClosedStringForwardRefProvider(scopes, "preact/compat")).toBe(false);
    expect(walkAstCounter).toHaveBeenCalledTimes(2);
  });
});
