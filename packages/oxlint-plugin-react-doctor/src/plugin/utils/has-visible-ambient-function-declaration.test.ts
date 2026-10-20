import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasVisibleAmbientFunctionDeclaration } from "./has-visible-ambient-function-declaration.js";

describe("hasVisibleAmbientFunctionDeclaration", () => {
  it.each([
    { code: "declare function candidate(): void;", expected: true, nested: false },
    { code: "export declare function candidate(): void;", expected: true, nested: false },
    { code: "function candidate(): void;", expected: true, nested: false },
    {
      code: "declare function candidate(): void; function owner() {}",
      expected: true,
      nested: true,
    },
    {
      code: "function owner() { declare function candidate(): void; }",
      expected: true,
      nested: true,
    },
    { code: "declare function unrelated(): void;", expected: false, nested: false },
    {
      code: "function owner() { declare function candidate(): void; }",
      expected: false,
      nested: false,
    },
    { code: "function candidate() {}", expected: false, nested: false },
    { code: "interface candidate {}", expected: false, nested: false },
    { code: "declare const candidate: unknown;", expected: false, nested: false },
    { code: "export default function candidate(): void;", expected: true, nested: false },
  ])("checks $code", ({ code, expected, nested }) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const scope = nested
      ? scopes.rootScope.children.find((candidate) => candidate.kind === "function")
      : scopes.rootScope;
    expect(scope).toBeDefined();
    if (!scope) throw new Error("Missing fixture scope");
    expect(hasVisibleAmbientFunctionDeclaration(scope, "candidate")).toBe(expected);
  });
});
