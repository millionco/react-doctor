import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";

describe("hasSymbolBindingWrites", () => {
  it.each([
    { name: "ordinary reads", operation: "callback();", expected: false },
    {
      name: "wrapped reads",
      operation: "((callback as unknown) as (() => void))();",
      expected: false,
    },
    { name: "property writes", operation: "callback.description = replacement;", expected: false },
    { name: "computed keys", operation: "({ [callback]: other } = replacement);", expected: false },
    { name: "default values", operation: "({ other = callback } = replacement);", expected: false },
    {
      name: "shadowed writes",
      operation: "const replace = (callback) => { callback = replacement; };",
      expected: false,
    },
    { name: "direct writes", operation: "callback = replacement;", expected: true },
    { name: "logical writes", operation: "callback ||= replacement;", expected: true },
    { name: "updates", operation: "callback++;", expected: true },
    { name: "array targets", operation: "[callback] = replacement;", expected: true },
    { name: "object targets", operation: "({ callback } = replacement);", expected: true },
    {
      name: "nested targets",
      operation: "({ callbacks: [callback] } = replacement);",
      expected: true,
    },
    { name: "rest targets", operation: "[...callback] = replacement;", expected: true },
    {
      name: "default targets",
      operation: "({ callback = replacement } = replacements);",
      expected: true,
    },
    { name: "loop targets", operation: "for (callback of replacements) break;", expected: true },
    {
      name: "wrapped targets",
      operation: "(callback as (() => void)) = replacement;",
      expected: true,
    },
  ])("computes $name once for repeated queries", ({ operation, expected }) => {
    const parsed = parseFixture(`let callback = () => {}; ${operation} callback(); callback();`);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const symbol = scopes.rootScope.symbols.find((candidate) => candidate.name === "callback");
    if (!symbol) throw new Error("Missing callback binding");
    let flagReadCount = 0;
    const observedSymbol: SymbolDescriptor = {
      ...symbol,
      references: symbol.references.map(
        (reference) =>
          new Proxy(reference, {
            get: (target, property, receiver) => {
              if (property === "flag") flagReadCount += 1;
              return Reflect.get(target, property, receiver);
            },
          }),
      ),
    };
    observedSymbol.references.forEach(() => {
      expect(hasSymbolBindingWrites(observedSymbol, scopes)).toBe(expected);
    });
    expect(flagReadCount).toBeGreaterThan(0);
    expect(flagReadCount).toBeLessThanOrEqual(observedSymbol.references.length);
  });

  it("keeps facts separate for different symbols in one Program", () => {
    const parsed = parseFixture(
      "let first = () => {}; let second = () => {}; second = replacement; first(); second();",
    );
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const firstSymbol = scopes.rootScope.symbols.find((symbol) => symbol.name === "first");
    const secondSymbol = scopes.rootScope.symbols.find((symbol) => symbol.name === "second");
    if (!firstSymbol || !secondSymbol) throw new Error("Missing callback bindings");
    expect(hasSymbolBindingWrites(firstSymbol, scopes)).toBe(false);
    expect(hasSymbolBindingWrites(secondSymbol, scopes)).toBe(true);
    expect(hasSymbolBindingWrites(firstSymbol, scopes)).toBe(false);
    expect(hasSymbolBindingWrites(secondSymbol, scopes)).toBe(true);
  });

  it("refreshes facts when an analysis handle points at another Program", () => {
    const firstParsed = parseFixture("let callback = () => {}; callback();");
    const secondParsed = parseFixture("let callback = replacement; callback();");
    expect(firstParsed.errors).toEqual([]);
    expect(secondParsed.errors).toEqual([]);
    attachParentReferences(firstParsed.program);
    attachParentReferences(secondParsed.program);
    const firstScopes = analyzeScopes(firstParsed.program);
    const secondScopes = analyzeScopes(secondParsed.program);
    let currentScopes = firstScopes;
    const reusedScopes = new Proxy(firstScopes, {
      get: (target, property, receiver) =>
        property === "rootScope"
          ? currentScopes.rootScope
          : Reflect.get(target, property, receiver),
    });
    const symbol = firstScopes.rootScope.symbols.find((candidate) => candidate.name === "callback");
    if (!symbol) throw new Error("Missing callback binding");
    const reusedSymbol: SymbolDescriptor = {
      ...symbol,
      references: symbol.references.map(
        (reference) =>
          new Proxy(reference, {
            get: (target, property, receiver) => {
              if (property === "flag" && currentScopes === secondScopes) return "write";
              return Reflect.get(target, property, receiver);
            },
          }),
      ),
    };
    expect(hasSymbolBindingWrites(reusedSymbol, reusedScopes)).toBe(false);
    currentScopes = secondScopes;
    expect(hasSymbolBindingWrites(reusedSymbol, reusedScopes)).toBe(true);
    currentScopes = firstScopes;
    expect(hasSymbolBindingWrites(reusedSymbol, reusedScopes)).toBe(false);
  });
});
