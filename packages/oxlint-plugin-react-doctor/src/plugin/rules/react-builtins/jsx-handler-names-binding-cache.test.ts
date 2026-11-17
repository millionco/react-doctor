import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import type { Rule } from "../../utils/rule.js";
import { jsxHandlerNames } from "./jsx-handler-names.js";

interface BindingIndexOperationCounts {
  moduleFilterCallbacks: number;
  moduleIteratorCalls: number;
  moduleIteratorVisits: number;
  functionFilterCallbacks: number;
}

const createTrackedHandlerRule = (counts: BindingIndexOperationCounts): Rule => ({
  ...jsxHandlerNames,
  create: (context) => {
    let scopes: ScopeAnalysis | undefined;
    const scopeViews = new WeakMap<ScopeDescriptor, ScopeDescriptor>();
    const viewScope = (scope: ScopeDescriptor): ScopeDescriptor => {
      const existing = scopeViews.get(scope);
      if (existing) return existing;
      const view = new Proxy(scope, {
        get: (target, property) => {
          if (property === "parent") return target.parent ? viewScope(target.parent) : null;
          if (property !== "symbols") return Reflect.get(target, property, target);
          return new Proxy(target.symbols, {
            get: (symbols, key) => {
              if (key === "filter") {
                return (predicate: (symbol: SymbolDescriptor) => unknown) =>
                  symbols.filter((symbol) => {
                    if (target.kind === "module") counts.moduleFilterCallbacks++;
                    else counts.functionFilterCallbacks++;
                    return predicate(symbol);
                  });
              }
              if (key === Symbol.iterator) {
                return () => {
                  if (target.kind === "module") counts.moduleIteratorCalls++;
                  const iterator = symbols[Symbol.iterator]();
                  return {
                    next: () => {
                      const result = iterator.next();
                      if (!result.done && target.kind === "module") counts.moduleIteratorVisits++;
                      return result;
                    },
                  };
                };
              }
              return Reflect.get(symbols, key, symbols);
            },
          });
        },
      });
      scopeViews.set(scope, view);
      return view;
    };
    return jsxHandlerNames.create(
      new Proxy(context, {
        get: (target, property) => {
          if (property !== "scopes") return Reflect.get(target, property, target);
          if (!scopes) {
            const original = target.scopes;
            scopes = {
              ...original,
              rootScope: viewScope(original.rootScope),
              scopeFor: (node) => viewScope(original.scopeFor(node)),
              ownScopeFor: (node) => {
                const scope = original.ownScopeFor(node);
                return scope ? viewScope(scope) : null;
              },
            };
          }
          return scopes;
        },
      }),
    );
  },
});

describe("jsxHandlerNames per-create binding index", () => {
  it.each([16, 128])("visits a declaration module once for %s components", (componentCount) => {
    const code = Array.from(
      { length: componentCount },
      (_, index) =>
        `export function Component${index}(input) { return <button onClick={input.onClick} />; }`,
    ).join("\n");
    const counts: BindingIndexOperationCounts = {
      moduleFilterCallbacks: 0,
      moduleIteratorCalls: 0,
      moduleIteratorVisits: 0,
      functionFilterCallbacks: 0,
    };
    const ordinary = runRule(jsxHandlerNames, code, { includeLocations: true });
    const tracked = runRule(createTrackedHandlerRule(counts), code, { includeLocations: true });
    expect(ordinary.parseErrors).toEqual([]);
    expect(ordinary.diagnostics).toEqual([]);
    expect(tracked).toEqual(ordinary);
    expect(counts.moduleFilterCallbacks).toBe(0);
    expect(counts.moduleIteratorCalls).toBe(1);
    expect(counts.moduleIteratorVisits).toBe(componentCount);
    expect(counts.functionFilterCallbacks).toBe(componentCount * 2);
  });

  it.each([16, 128])(
    "visits an arrow module once for %s independent components",
    (componentCount) => {
      const code = Array.from(
        { length: componentCount },
        (_, index) =>
          `export const Component${index} = (input) => <button onClick={input.onClick} />;`,
      ).join("\n");
      const counts: BindingIndexOperationCounts = {
        moduleFilterCallbacks: 0,
        moduleIteratorCalls: 0,
        moduleIteratorVisits: 0,
        functionFilterCallbacks: 0,
      };
      const ordinary = runRule(jsxHandlerNames, code, { includeLocations: true });
      const tracked = runRule(createTrackedHandlerRule(counts), code, { includeLocations: true });
      expect(ordinary.parseErrors).toEqual([]);
      expect(ordinary.diagnostics).toEqual([]);
      expect(tracked).toEqual(ordinary);
      expect(counts.moduleFilterCallbacks).toBe(0);
      expect(counts.moduleIteratorCalls).toBe(1);
      expect(counts.moduleIteratorVisits).toBe(componentCount);
      expect(counts.functionFilterCallbacks).toBe(0);
    },
  );

  it("builds a separate index for each create invocation", () => {
    const code = "export const Component = (input) => <button onClick={input.onClick} />;";
    const counts: BindingIndexOperationCounts = {
      moduleFilterCallbacks: 0,
      moduleIteratorCalls: 0,
      moduleIteratorVisits: 0,
      functionFilterCallbacks: 0,
    };
    const trackedRule = createTrackedHandlerRule(counts);
    expect(runRule(trackedRule, code).diagnostics).toEqual([]);
    expect(runRule(trackedRule, code).diagnostics).toEqual([]);
    expect(counts.moduleIteratorCalls).toBe(2);
    expect(counts.moduleIteratorVisits).toBe(2);
  });
});
