import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { isFunctionLike } from "./is-function-like.js";
import { walkAst } from "./walk-ast.js";

interface BindingFixture {
  readonly scopes: ScopeAnalysis;
  readonly functionNode: EsTreeNode;
  readonly functions: ReadonlyArray<EsTreeNode>;
}

const createBindingFixture = (code: string): BindingFixture => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const functions: EsTreeNode[] = [];
  walkAst(parsed.program, (node) => {
    if (isFunctionLike(node)) functions.push(node);
  });
  const functionNode = functions[0];
  if (!functionNode) throw new Error("Missing fixture function");
  return { scopes: analyzeScopes(parsed.program), functionNode, functions };
};

const expectSameSymbols = (
  actual: ReadonlyArray<SymbolDescriptor>,
  expected: ReadonlyArray<SymbolDescriptor>,
): void => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((symbol, index) => expect(actual[index]).toBe(symbol));
};

describe("getFunctionBindingSymbols caller-owned index", () => {
  it.each([
    "export function Component(input) { return input; }",
    "export const Component = (input) => input;",
    "var Component = () => null; var Component = () => null;",
  ])("keeps all descriptor identities and order for %s", (code) => {
    const fixture = createBindingFixture(code);
    const cache = new WeakMap<ScopeDescriptor, WeakMap<EsTreeNode, SymbolDescriptor[]>>();
    for (const functionNode of fixture.functions) {
      const ordinary = getFunctionBindingSymbols(functionNode, fixture.scopes);
      const indexed = getFunctionBindingSymbols(functionNode, fixture.scopes, cache);
      expectSameSymbols(indexed, ordinary);
      expect(indexed).not.toBe(ordinary);
    }
  });

  it("retains every same-binding descriptor without exposing the cached array", () => {
    const fixture = createBindingFixture("const Component = () => null; const Other = () => null;");
    const first = getFunctionBindingSymbols(fixture.functionNode, fixture.scopes)[0];
    const otherFunction = fixture.functions[1];
    if (!first || !otherFunction) throw new Error("Missing fixture bindings");
    const other = getFunctionBindingSymbols(otherFunction, fixture.scopes)[0];
    if (!other) throw new Error("Missing unrelated binding");
    const duplicate: SymbolDescriptor = { ...first, references: [] };
    const symbols = [other, first, duplicate];
    const scope: ScopeDescriptor = { ...fixture.scopes.rootScope, symbols };
    const scopes: ScopeAnalysis = { ...fixture.scopes, scopeFor: () => scope };
    const cache = new WeakMap<ScopeDescriptor, WeakMap<EsTreeNode, SymbolDescriptor[]>>();
    const indexed = getFunctionBindingSymbols(fixture.functionNode, scopes, cache);
    expectSameSymbols(indexed, [first, duplicate]);
    indexed.pop();
    indexed.push(other);
    const repeated = getFunctionBindingSymbols(fixture.functionNode, scopes, cache);
    expectSameSymbols(repeated, [first, duplicate]);
    expect(repeated).not.toBe(indexed);
    expect(scope.symbols).toBe(symbols);
    expectSameSymbols(scope.symbols, [other, first, duplicate]);
  });

  it("keeps the default no-cache filter path on repeated queries", () => {
    const fixture = createBindingFixture("const Component = () => null;");
    let filters = 0;
    const symbols = new Proxy(fixture.scopes.rootScope.symbols, {
      get: (target, property) => {
        if (property === "filter") filters++;
        return Reflect.get(target, property, target);
      },
    });
    const scope: ScopeDescriptor = { ...fixture.scopes.rootScope, symbols };
    const scopes: ScopeAnalysis = { ...fixture.scopes, scopeFor: () => scope };
    const first = getFunctionBindingSymbols(fixture.functionNode, scopes);
    const second = getFunctionBindingSymbols(fixture.functionNode, scopes);
    expectSameSymbols(first, second);
    expect(first).not.toBe(second);
    expect(filters).toBe(2);
  });

  it("isolates identical names and numeric scope ids across analyses", () => {
    const first = createBindingFixture("const Component = () => null;");
    const second = createBindingFixture("const Component = () => null;");
    const cache = new WeakMap<ScopeDescriptor, WeakMap<EsTreeNode, SymbolDescriptor[]>>();
    const firstSymbols = getFunctionBindingSymbols(first.functionNode, first.scopes, cache);
    const secondSymbols = getFunctionBindingSymbols(second.functionNode, second.scopes, cache);
    expectSameSymbols(firstSymbols, getFunctionBindingSymbols(first.functionNode, first.scopes));
    expectSameSymbols(secondSymbols, getFunctionBindingSymbols(second.functionNode, second.scopes));
    expect(first.scopes.rootScope.id).toBe(second.scopes.rootScope.id);
    expect(firstSymbols[0]).not.toBe(secondSymbols[0]);
  });

  it("walks past an empty nearest scope", () => {
    const fixture = createBindingFixture("const Component = () => null;");
    const nearest: ScopeDescriptor = {
      ...fixture.scopes.rootScope,
      symbols: [],
      parent: fixture.scopes.rootScope,
    };
    const scopes: ScopeAnalysis = { ...fixture.scopes, scopeFor: () => nearest };
    const cache = new WeakMap<ScopeDescriptor, WeakMap<EsTreeNode, SymbolDescriptor[]>>();
    expectSameSymbols(
      getFunctionBindingSymbols(fixture.functionNode, scopes, cache),
      getFunctionBindingSymbols(fixture.functionNode, scopes),
    );
    expect(cache.has(nearest)).toBe(true);
    expect(cache.has(fixture.scopes.rootScope)).toBe(true);
  });

  it("does not select a nearer same-name descriptor with a different binding identifier", () => {
    const fixture = createBindingFixture("const Component = () => null;");
    const shadow = createBindingFixture("const Component = () => null;");
    const nearest: ScopeDescriptor = {
      ...shadow.scopes.rootScope,
      parent: fixture.scopes.rootScope,
    };
    const scopes: ScopeAnalysis = { ...fixture.scopes, scopeFor: () => nearest };
    const cache = new WeakMap<ScopeDescriptor, WeakMap<EsTreeNode, SymbolDescriptor[]>>();
    expectSameSymbols(
      getFunctionBindingSymbols(fixture.functionNode, scopes, cache),
      getFunctionBindingSymbols(fixture.functionNode, fixture.scopes),
    );
  });

  it("uses the nearest true binding match before its parent", () => {
    const fixture = createBindingFixture("function Component() { return null; }");
    const nearest = fixture.scopes.ownScopeFor(fixture.functionNode);
    if (!nearest) throw new Error("Missing own function scope");
    const scopes: ScopeAnalysis = { ...fixture.scopes, scopeFor: () => nearest };
    const cache = new WeakMap<ScopeDescriptor, WeakMap<EsTreeNode, SymbolDescriptor[]>>();
    const expected = getFunctionBindingSymbols(fixture.functionNode, scopes);
    expect(expected.length).toBeGreaterThan(0);
    expectSameSymbols(getFunctionBindingSymbols(fixture.functionNode, scopes, cache), expected);
    expect(cache.has(fixture.scopes.rootScope)).toBe(false);
  });

  it("does not build an index for an anonymous unbound function", () => {
    const fixture = createBindingFixture("consume(function () {});");
    const scopes: ScopeAnalysis = {
      ...fixture.scopes,
      scopeFor: () => {
        throw new Error("Anonymous lookup requested scopes");
      },
    };
    const cache = new WeakMap<ScopeDescriptor, WeakMap<EsTreeNode, SymbolDescriptor[]>>();
    expect(getFunctionBindingSymbols(fixture.functionNode, scopes, cache)).toEqual([]);
    expect(cache.has(fixture.scopes.rootScope)).toBe(false);
  });

  it("caches an empty scope while returning fresh empty arrays", () => {
    const fixture = createBindingFixture("const Component = () => null;");
    const unrelated = getFunctionBindingSymbols(fixture.functionNode, fixture.scopes)[0];
    if (!unrelated) throw new Error("Missing fixture binding");
    let iteratorReads = 0;
    const symbols = new Proxy<SymbolDescriptor[]>([], {
      get: (target, property) => {
        if (property === Symbol.iterator) iteratorReads++;
        return Reflect.get(target, property, target);
      },
    });
    const scope: ScopeDescriptor = { ...fixture.scopes.rootScope, symbols, parent: null };
    const scopes: ScopeAnalysis = { ...fixture.scopes, scopeFor: () => scope };
    const cache = new WeakMap<ScopeDescriptor, WeakMap<EsTreeNode, SymbolDescriptor[]>>();
    const first = getFunctionBindingSymbols(fixture.functionNode, scopes, cache);
    first.push(unrelated);
    const second = getFunctionBindingSymbols(fixture.functionNode, scopes, cache);
    expect(second).toEqual([]);
    expect(second).not.toBe(first);
    expect(iteratorReads).toBe(1);
  });
  it("does not share index construction between caller-owned caches", () => {
    const fixture = createBindingFixture("const Component = () => null;");
    let iteratorReads = 0;
    const symbols = new Proxy(fixture.scopes.rootScope.symbols, {
      get: (target, property) => {
        if (property === Symbol.iterator) iteratorReads++;
        return Reflect.get(target, property, target);
      },
    });
    const scope: ScopeDescriptor = { ...fixture.scopes.rootScope, symbols };
    const scopes: ScopeAnalysis = { ...fixture.scopes, scopeFor: () => scope };
    const firstCache = new WeakMap<ScopeDescriptor, WeakMap<EsTreeNode, SymbolDescriptor[]>>();
    const secondCache = new WeakMap<ScopeDescriptor, WeakMap<EsTreeNode, SymbolDescriptor[]>>();
    const expected = getFunctionBindingSymbols(fixture.functionNode, scopes);
    expectSameSymbols(
      getFunctionBindingSymbols(fixture.functionNode, scopes, firstCache),
      expected,
    );
    expectSameSymbols(
      getFunctionBindingSymbols(fixture.functionNode, scopes, firstCache),
      expected,
    );
    expectSameSymbols(
      getFunctionBindingSymbols(fixture.functionNode, scopes, secondCache),
      expected,
    );
    expect(iteratorReads).toBe(2);
  });
});
