import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { parseSourceText } from "./parse-source-file.js";

describe("hasCompleteSymbolReferences", () => {
  it.each([
    {
      sourceText:
        "const value = 1; type Notes = ({ value }: { value: string }) => void; consume(value);",
      expected: true,
    },
    {
      sourceText:
        "const value = 1; interface Notes { call({value}: {value: string}): void; } consume(value);",
      expected: true,
    },
    {
      sourceText: "const value = 1; class Notes { constructor(public field = value) {} }",
      expected: false,
    },
    {
      sourceText: "const value = 1; { const value = 2; consume(value); } consume(value);",
      expected: true,
    },
    {
      sourceText: "const value = 1; try {} catch ({ ignored = value }) {}",
      expected: false,
    },
    {
      sourceText: "const value = 1; enum Container { result = value };",
      expected: false,
    },
  ])("preserves reference closure for $sourceText", ({ sourceText, expected }) => {
    const program = parseSourceText({ filename: "references.tsx", sourceText });
    if (!program) throw new Error("Expected a parsed program");
    const scopes = analyzeScopes(program);
    const symbol = scopes.rootScope.symbols.find((candidate) => candidate.name === "value");
    if (!symbol) throw new Error("Expected the value binding");
    expect(hasCompleteSymbolReferences(symbol, program, scopes)).toBe(expected);
    expect(hasCompleteSymbolReferences(symbol, program, scopes)).toBe(expected);
  });

  it("keeps completeness results separate for different analyzed subtrees", () => {
    const program = parseSourceText({
      filename: "subtrees.tsx",
      sourceText:
        "const value = 1; const read = () => value; try {} catch ({ ignored = value }) {}",
    });
    if (!program) throw new Error("Expected a parsed program");
    const scopes = analyzeScopes(program);
    const value = scopes.rootScope.symbols.find((candidate) => candidate.name === "value");
    const read = scopes.rootScope.symbols.find((candidate) => candidate.name === "read");
    if (!value || !read?.initializer) throw new Error("Expected the value and reader bindings");
    expect(hasCompleteSymbolReferences(value, program, scopes)).toBe(false);
    expect(hasCompleteSymbolReferences(value, read.initializer, scopes)).toBe(true);
  });

  it("indexes unrelated bindings together and reuses completed queries", () => {
    const sourceText = Array.from(
      { length: 32 },
      (_, index) => `const value${index} = ${index}; consume(value${index});`,
    ).join("\n");
    const program = parseSourceText({ filename: "indexed.ts", sourceText });
    if (!program) throw new Error("Expected a parsed program");
    const scopes = analyzeScopes(program);
    let lookupCount = 0;
    const observedScopes: ScopeAnalysis = {
      ...scopes,
      symbolFor: (identifier) => {
        lookupCount++;
        return scopes.symbolFor(identifier);
      },
    };
    for (const symbol of scopes.rootScope.symbols) {
      expect(hasCompleteSymbolReferences(symbol, program, observedScopes)).toBe(true);
    }
    const indexedLookupCount = lookupCount;
    expect(indexedLookupCount).toBeLessThanOrEqual(scopes.rootScope.symbols.length * 5);
    for (const symbol of scopes.rootScope.symbols) {
      expect(hasCompleteSymbolReferences(symbol, program, observedScopes)).toBe(true);
    }
    expect(lookupCount).toBe(indexedLookupCount);
  });
});
