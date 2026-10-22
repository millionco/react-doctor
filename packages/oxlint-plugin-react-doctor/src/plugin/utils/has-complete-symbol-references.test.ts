import * as astWalking from "./walk-ast.js";
import {
  PROVIDER_PROOF_SMALL_COMPONENT_COUNT,
  PROVIDER_PROOF_LARGE_COMPONENT_COUNT,
  PROVIDER_PROOF_MAX_GROWTH_RATIO,
} from "../../test-utils/constants.js";
import { describe, expect, it, vi } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { parseSourceText } from "./parse-source-file.js";

describe("hasCompleteSymbolReferences", () => {
  it.each([
    { sourceText: "const value = 1; consume(value);", expected: true },
    {
      sourceText: "const value = 1; { const value = 2; consume(value); } consume(value);",
      expected: true,
    },
    { sourceText: "const value = 1; try {} catch ({ ignored = value }) {}", expected: false },
    { sourceText: "const value = 1; enum Container { result = value };", expected: false },
  ])("retains finite reference closure for $sourceText", ({ sourceText, expected }) => {
    const program = parseSourceText({ filename: "references.tsx", sourceText });
    if (!program) throw new Error("Expected parsed source");
    const scopes = analyzeScopes(program);
    const symbol = scopes.rootScope.symbols.find((candidate) => candidate.name === "value");
    if (!symbol) throw new Error("Expected value binding");
    let lookups = 0;
    const observedScopes = {
      ...scopes,
      symbolFor: (identifier: Parameters<typeof scopes.symbolFor>[0]) => {
        lookups++;
        return scopes.symbolFor(identifier);
      },
    };
    expect(hasCompleteSymbolReferences(symbol, program, observedScopes)).toBe(expected);
    const firstLookups = lookups;
    expect(hasCompleteSymbolReferences(symbol, program, observedScopes)).toBe(expected);
    expect(lookups).toBe(firstLookups);
  });
  it("keeps negative program results separate from a safe subtree", () => {
    const program = parseSourceText({
      filename: "subtrees.tsx",
      sourceText:
        "const value = 1; const read = () => value; try {} catch ({ ignored = value }) {}",
    });
    if (!program) throw new Error("Expected parsed source");
    const scopes = analyzeScopes(program);
    const value = scopes.rootScope.symbols.find((candidate) => candidate.name === "value");
    const reader = scopes.rootScope.symbols.find((candidate) => candidate.name === "read");
    if (!value || !reader?.initializer) throw new Error("Expected value and reader");
    expect(hasCompleteSymbolReferences(value, program, scopes)).toBe(false);
    expect(hasCompleteSymbolReferences(value, reader.initializer, scopes)).toBe(true);
  });
  it("does not reuse an incomplete result in a fresh analysis", () => {
    for (const sourceText of [
      "const value = 1; try {} catch ({ ignored = value }) {}",
      "const value = 1; consume(value);",
    ]) {
      const program = parseSourceText({ filename: "isolation.tsx", sourceText });
      if (!program) throw new Error("Expected parsed source");
      const scopes = analyzeScopes(program);
      const symbol = scopes.rootScope.symbols.find((candidate) => candidate.name === "value");
      if (!symbol) throw new Error("Expected value binding");
      expect(hasCompleteSymbolReferences(symbol, program, scopes)).toBe(
        !sourceText.includes("catch"),
      );
    }
  });
});

it("indexes distinct symbol reference proofs with bounded program traversal growth", () => {
  const visits = (bindingCount: number): number => {
    const sourceText = Array.from(
      { length: bindingCount },
      (_, index) => `const value${index}=${index}; consume(value${index});`,
    ).join("\n");
    const program = parseSourceText({ filename: "distinct-references.ts", sourceText });
    if (!program) throw new Error("Expected parsed source");
    const scopes = analyzeScopes(program);
    const symbols = scopes.rootScope.symbols.filter((symbol) => symbol.name.startsWith("value"));
    expect(symbols).toHaveLength(bindingCount);
    let visitedNodes = 0;
    const walkAst = astWalking.walkAst;
    const traversal = vi.spyOn(astWalking, "walkAst").mockImplementation((node, visitor) =>
      walkAst(node, (candidate) => {
        visitedNodes++;
        return visitor(candidate);
      }),
    );
    try {
      expect(symbols.every((symbol) => hasCompleteSymbolReferences(symbol, program, scopes))).toBe(
        true,
      );
    } finally {
      traversal.mockRestore();
    }
    return visitedNodes;
  };
  const small = visits(PROVIDER_PROOF_SMALL_COMPONENT_COUNT);
  const large = visits(PROVIDER_PROOF_LARGE_COMPONENT_COUNT);
  expect(small).toBeGreaterThan(0);
  expect(large).toBeLessThan(small * PROVIDER_PROOF_MAX_GROWTH_RATIO);
});
