import { describe, expect, it, vi } from "vite-plus/test";
import { REF_NOTIFICATION_WORK_COMPONENT_COUNT } from "../rules/state-and-effects/utils/constants.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasOnlyErasedTypeNameBindings } from "./has-only-erased-type-name-bindings.js";

describe("hasOnlyErasedTypeNameBindings", () => {
  it.each([true, false])("reuses the pure binding result %s", (expected) => {
    const content = [
      "interface candidate {}",
      ...Array.from(
        { length: REF_NOTIFICATION_WORK_COMPONENT_COUNT },
        (_, recordIndex) => `const unrelated${recordIndex} = 0;`,
      ),
      ...(expected ? [] : ["const candidate = 0;"]),
    ].join("\n");
    const parsed = parseFixture(content);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const symbols = scopes.rootScope.symbols;
    const symbol = symbols.find((candidate) => candidate.name === "candidate");
    if (!symbol) throw new Error("Missing fixture binding");
    let symbolVisits = 0;
    const originalSome = symbols.some.bind(symbols);
    const symbolLookup = vi.spyOn(symbols, "some").mockImplementation((predicate) =>
      originalSome((candidate, index, array) => {
        symbolVisits += 1;
        return predicate(candidate, index, array);
      }),
    );
    try {
      for (
        let queryIndex = 0;
        queryIndex < REF_NOTIFICATION_WORK_COMPONENT_COUNT;
        queryIndex += 1
      ) {
        expect(hasOnlyErasedTypeNameBindings(symbol)).toBe(expected);
      }
      expect(symbolVisits).toBe(symbols.length);
    } finally {
      symbolLookup.mockRestore();
    }
  });

  it.each([
    { code: "interface candidate {}", expected: true, nested: false },
    { code: "type candidate = unknown;", expected: true, nested: false },
    { code: "interface candidate {} type candidate = unknown;", expected: true, nested: false },
    { code: "const unrelated = 0; interface candidate {}", expected: true, nested: false },
    { code: "declare const candidate: unknown;", expected: false, nested: false },
    {
      code: "declare function candidate(): void; interface candidate {}",
      expected: false,
      nested: false,
    },
    { code: "declare class candidate {}", expected: false, nested: false },
    { code: "namespace candidate {}", expected: false, nested: false },
    { code: 'import type candidate from "provider";', expected: false, nested: false },
    { code: 'import candidate from "provider";', expected: false, nested: false },
    { code: "const candidate = 0; interface candidate {}", expected: false, nested: false },
    { code: "interface candidate {} const candidate = 0;", expected: false, nested: false },
    {
      code: "interface candidate {} declare const candidate: unknown;",
      expected: false,
      nested: false,
    },
    { code: "class candidate {} interface candidate {}", expected: false, nested: false },
    { code: "function candidate() {} interface candidate {}", expected: false, nested: false },
    {
      code: "interface candidate {} function owner() { type candidate = unknown; }",
      expected: true,
      nested: true,
    },
    {
      code: "const candidate = 0; function owner() { interface candidate {} }",
      expected: false,
      nested: true,
    },
    {
      code: "declare const candidate: unknown; function owner() { interface candidate {} }",
      expected: false,
      nested: true,
    },
    {
      code: "declare function candidate(): void; function owner() { interface candidate {} }",
      expected: false,
      nested: true,
    },
    {
      code: "function owner(candidate: unknown) { interface candidate {} }",
      expected: false,
      nested: true,
    },
    {
      code: "function owner() { declare function candidate(): void; interface candidate {} }",
      expected: false,
      nested: true,
    },
    {
      code: "export declare function candidate(): void; interface candidate {}",
      expected: false,
      nested: false,
    },
    {
      code: "declare function unrelated(): void; interface candidate {}",
      expected: true,
      nested: false,
    },
  ])("resolves $code", ({ code, expected, nested }) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const bindingScope = nested
      ? scopes.rootScope.children.find((scope) => scope.kind === "function")
      : scopes.rootScope;
    const symbol = bindingScope?.symbols.findLast((binding) => binding.name === "candidate");
    expect(symbol).toBeDefined();
    if (!symbol) throw new Error("Missing fixture binding");
    expect(hasOnlyErasedTypeNameBindings(symbol)).toBe(expected);
  });
});
