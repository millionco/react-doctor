import { describe, expect, it } from "vite-plus/test";
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
