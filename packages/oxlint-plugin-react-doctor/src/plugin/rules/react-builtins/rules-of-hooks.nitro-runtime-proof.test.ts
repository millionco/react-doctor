import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  NITRO_GETTER_PROPERTY_PROOF_FIXED_READ_COUNT,
  NITRO_GETTER_PROPERTY_PROOF_READ_MULTIPLIER,
  NON_REACT_UTILITY_WORK_LARGE_CALL_COUNT,
  NON_REACT_UTILITY_WORK_SMALL_CALL_COUNT,
} from "../../constants/thresholds.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const runTsx = (source: string) =>
  runRule(wrapWithSemanticContext(rulesOfHooks), source, { filename: "fixture.tsx" });

describe("Nitro runtime value binding proof", () => {
  it.each([
    'interface useNitroApp {} const {useNitroApp}=await import("nitropack/runtime"); consume(useNitroApp());',
    'const {useNitroApp}=await import("nitropack/runtime"); interface useNitroApp {} consume(useNitroApp());',
    'type useNitroApp=unknown; const {useNitroApp}=await import("nitropack/runtime"); consume(useNitroApp());',
    'const {useNitroApp}=await import("nitropack/runtime"); type useNitroApp=unknown; consume(useNitroApp());',
    'interface useWorkerApp {} const {useNitroApp:useWorkerApp}=await import("nitropack/runtime"); consume(useWorkerApp());',
    'const {useNitroApp:useWorkerApp}=await import("nitropack/runtime"); interface useWorkerApp {} consume(useWorkerApp());',
    'type useWorkerApp=unknown; const {useNitroApp:useWorkerApp}=await import("nitropack/runtime"); consume(useWorkerApp());',
    'const {useNitroApp:useWorkerApp}=await import("nitropack/runtime"); type useWorkerApp=unknown; consume(useWorkerApp());',
    'const {useNitroApp}=await import("nitropack/runtime"); { interface useNitroApp {} consume(useNitroApp()); }',
    'const {useNitroApp}=await import("nitropack/runtime"); { type useNitroApp=unknown; consume(useNitroApp()); }',
    'const {useNitroApp}=await import("nitropack/runtime"); function read(){ interface useNitroApp {} return useNitroApp(); }',
    'declare function otherGetter():void; const {useNitroApp}=await import("nitropack/runtime"); interface useNitroApp {} consume(useNitroApp());',
    'declare function useNitroApp():void; async function read(){ const {useNitroApp}=await import("nitropack/runtime"); interface useNitroApp {} return useNitroApp(); }',
  ])("keeps erased declarations separate from the immutable value: %s", (source) => {
    const result = runTsx(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'const {useNitroApp}=await import("nitropack/runtime"); { const useNitroApp=other; interface useNitroApp {} consume(useNitroApp()); }',
    'const {useNitroApp}=await import("nitropack/runtime"); { let useNitroApp=other; interface useNitroApp {} consume(useNitroApp()); }',
    'const {useNitroApp}=await import("nitropack/runtime"); function read(useNitroApp){ interface useNitroApp {} return useNitroApp(); }',
    'const {useNitroApp}=await import("nitropack/runtime"); { declare const useNitroApp:()=>object; interface useNitroApp {} consume(useNitroApp()); }',
    'const {useNitroApp}=await import("nitropack/runtime"); { declare function useNitroApp():object; interface useNitroApp {} consume(useNitroApp()); }',
    'const {useNitroApp}=await import("nitropack/runtime"); { declare function useNitroApp():object; consume(useNitroApp()); }',
    'const {useNitroApp}=await import("nitropack/runtime"); { namespace useNitroApp {} consume(useNitroApp()); }',
    'const {useNitroApp}=await import("nitropack/runtime"); useNitroApp=other; interface useNitroApp {} consume(useNitroApp());',
    'const {useNitroApp}=await import("nitropack/runtime"); interface useNitroApp {} useNitroApp=other; consume(useNitroApp());',
    'const {useNitroApp}=await import("nitropack/runtime"); type useNitroApp=unknown; ({callback:useNitroApp}=other); consume(useNitroApp());',
    'const {useNitroApp}=await import("other-runtime"); interface useNitroApp {} consume(useNitroApp());',
    'const {useRuntimeConfig:useNitroApp}=await import("nitropack/runtime"); interface useNitroApp {} consume(useNitroApp());',
    'import {useState as useNitroApp} from "react"; interface useNitroApp {} consume(useNitroApp());',
    'let {useNitroApp}=await import("nitropack/runtime"); interface useNitroApp {} consume(useNitroApp());',
    'const {useNitroApp}=await import("nitropack/runtime"); { var useNitroApp=other; var useNitroApp=otherAgain; interface useNitroApp {} consume(useNitroApp()); }',
  ])("declines competing values, ambient contracts, writes and unsupported roles: %s", (source) => {
    const result = runTsx(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      callCount: NON_REACT_UTILITY_WORK_SMALL_CALL_COUNT,
      renamed: false,
      erased: false,
      mutation: "",
    },
    {
      callCount: NON_REACT_UTILITY_WORK_LARGE_CALL_COUNT,
      renamed: false,
      erased: false,
      mutation: "",
    },
    {
      callCount: NON_REACT_UTILITY_WORK_LARGE_CALL_COUNT,
      renamed: true,
      erased: true,
      mutation: "",
    },
    {
      callCount: NON_REACT_UTILITY_WORK_LARGE_CALL_COUNT,
      renamed: false,
      erased: false,
      mutation: "useNitroApp=replacement;",
    },
    {
      callCount: NON_REACT_UTILITY_WORK_LARGE_CALL_COUNT,
      renamed: false,
      erased: true,
      mutation: "useNitroApp=replacement;",
    },
  ])(
    "checks each symbol reference once: $callCount $renamed $erased $mutation",
    ({ callCount, renamed, erased, mutation }) => {
      const name = renamed ? "useWorkerApp" : "useNitroApp";
      let flagReads = 0;
      let referenceCount = 0;
      const observed: typeof rulesOfHooks = {
        ...rulesOfHooks,
        create: (context) => {
          for (const symbol of context.scopes.rootScope.symbols.filter(
            (candidate) => candidate.name === name,
          )) {
            referenceCount += symbol.references.length;
            for (const reference of symbol.references) {
              const flag = reference.flag;
              Object.defineProperty(reference, "flag", {
                configurable: true,
                get: () => {
                  flagReads += 1;
                  return flag;
                },
              });
            }
          }
          return rulesOfHooks.create(context);
        },
      };
      const source = `const {${renamed ? "useNitroApp:useWorkerApp" : "useNitroApp"}}=await import("nitropack/runtime"); ${erased ? `interface ${name} {}` : ""} export const applications=[${Array.from({ length: callCount }, () => `${name}()`).join(",")}]; ${mutation}`;
      const result = runRule(wrapWithSemanticContext(observed), source, {
        filename: "fixture.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(mutation ? callCount : 0);
      expect(flagReads).toBeGreaterThan(0);
      expect(flagReads).toBeLessThanOrEqual(referenceCount);
    },
  );

  it.each([NON_REACT_UTILITY_WORK_SMALL_CALL_COUNT, NON_REACT_UTILITY_WORK_LARGE_CALL_COUNT])(
    "indexes a shared value scope once for %s distinct getter bindings",
    (bindingCount) => {
      let scopeSymbolReads = 0;
      const observed: typeof rulesOfHooks = {
        ...rulesOfHooks,
        create: (context) => {
          const scope = context.scopes.rootScope;
          const symbols = scope.symbols;
          Object.defineProperty(scope, "symbols", {
            configurable: true,
            get: () => {
              scopeSymbolReads += 1;
              return symbols;
            },
          });
          return rulesOfHooks.create(context);
        },
      };
      const source = Array.from(
        { length: bindingCount },
        (_, bindingIndex) =>
          `const {useNitroApp:useWorker${bindingIndex}}=await import("nitropack/runtime"); interface useWorker${bindingIndex} {} consume(useWorker${bindingIndex}());`,
      ).join("\n");
      const result = runRule(wrapWithSemanticContext(observed), source, {
        filename: "fixture.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(scopeSymbolReads).toBe(1);
    },
  );

  it.each([
    { propertyCount: NON_REACT_UTILITY_WORK_SMALL_CALL_COUNT, source: "nitropack/runtime" },
    { propertyCount: NON_REACT_UTILITY_WORK_LARGE_CALL_COUNT, source: "nitropack/runtime" },
    { propertyCount: NON_REACT_UTILITY_WORK_SMALL_CALL_COUNT, source: "other-runtime" },
    { propertyCount: NON_REACT_UTILITY_WORK_LARGE_CALL_COUNT, source: "other-runtime" },
  ])("checks the whole getter proof once: $propertyCount $source", ({ propertyCount, source }) => {
    let computedPropertyReads = 0;
    const observed: typeof rulesOfHooks = {
      ...rulesOfHooks,
      create: (context) => {
        const symbol = context.scopes.rootScope.symbols.find(
          (candidate) => candidate.name === "useNitroApp",
        );
        if (
          symbol?.declarationNode.type !== "VariableDeclarator" ||
          symbol.declarationNode.id.type !== "ObjectPattern"
        )
          throw new Error("Expected getter destructuring");
        for (const property of symbol.declarationNode.id.properties) {
          if (property.type !== "Property") throw new Error("Expected static property");
          const computed = property.computed;
          Object.defineProperty(property, "computed", {
            configurable: true,
            get: () => {
              computedPropertyReads += 1;
              return computed;
            },
          });
        }
        return rulesOfHooks.create(context);
      },
    };
    const properties = Array.from({ length: propertyCount }, (_, propertyIndex) =>
      propertyIndex ? `extra${propertyIndex}` : "useNitroApp",
    ).join(",");
    const calls = Array.from({ length: propertyCount }, () => "useNitroApp()").join(",");
    const result = runRule(
      wrapWithSemanticContext(observed),
      `const {${properties}}=await import("${source}"); export const applications=[${calls}];`,
      { filename: "fixture.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(source === "nitropack/runtime" ? 0 : propertyCount);
    expect(computedPropertyReads).toBeGreaterThan(0);
    expect(computedPropertyReads).toBeLessThanOrEqual(
      propertyCount * NITRO_GETTER_PROPERTY_PROOF_READ_MULTIPLIER +
        NITRO_GETTER_PROPERTY_PROOF_FIXED_READ_COUNT,
    );
  });

  it.each([NON_REACT_UTILITY_WORK_SMALL_CALL_COUNT, NON_REACT_UTILITY_WORK_LARGE_CALL_COUNT])(
    "rejects unrelated bindings before the shared pattern proof: %s",
    (propertyCount) => {
      let computedPropertyReads = 0;
      const observed: typeof rulesOfHooks = {
        ...rulesOfHooks,
        create: (context) => {
          const symbol = context.scopes.rootScope.symbols.find(
            (candidate) => candidate.name === "useOther0",
          );
          if (
            symbol?.declarationNode.type !== "VariableDeclarator" ||
            symbol.declarationNode.id.type !== "ObjectPattern"
          )
            throw new Error("Expected unrelated getter destructuring");
          for (const property of symbol.declarationNode.id.properties) {
            if (property.type !== "Property") throw new Error("Expected static property");
            const computed = property.computed;
            Object.defineProperty(property, "computed", {
              configurable: true,
              get: () => {
                computedPropertyReads += 1;
                return computed;
              },
            });
          }
          return rulesOfHooks.create(context);
        },
      };
      const properties = Array.from(
        { length: propertyCount },
        (_, propertyIndex) => `other${propertyIndex}:useOther${propertyIndex}`,
      ).join(",");
      const calls = Array.from(
        { length: propertyCount },
        (_, propertyIndex) => `useOther${propertyIndex}()`,
      ).join(",");
      const result = runRule(
        wrapWithSemanticContext(observed),
        `const {${properties}}=await import("nitropack/runtime"); export const applications=[${calls}];`,
        { filename: "fixture.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(propertyCount);
      expect(computedPropertyReads).toBeGreaterThan(0);
      expect(computedPropertyReads).toBeLessThanOrEqual(
        propertyCount * NITRO_GETTER_PROPERTY_PROOF_READ_MULTIPLIER +
          NITRO_GETTER_PROPERTY_PROOF_FIXED_READ_COUNT,
      );
    },
  );

  it.each([NON_REACT_UTILITY_WORK_SMALL_CALL_COUNT, NON_REACT_UTILITY_WORK_LARGE_CALL_COUNT])(
    "checks a duplicate-key pattern once across distinct bindings: %s",
    (propertyCount) => {
      let computedPropertyReads = 0;
      const observed: typeof rulesOfHooks = {
        ...rulesOfHooks,
        create: (context) => {
          const symbol = context.scopes.rootScope.symbols.find(
            (candidate) => candidate.name === "useGetter0",
          );
          if (
            symbol?.declarationNode.type !== "VariableDeclarator" ||
            symbol.declarationNode.id.type !== "ObjectPattern"
          )
            throw new Error("Expected duplicate getter destructuring");
          for (const property of symbol.declarationNode.id.properties) {
            if (property.type !== "Property") throw new Error("Expected static property");
            const computed = property.computed;
            Object.defineProperty(property, "computed", {
              configurable: true,
              get: () => {
                computedPropertyReads += 1;
                return computed;
              },
            });
          }
          return rulesOfHooks.create(context);
        },
      };
      const properties = [
        ...Array.from(
          { length: propertyCount },
          (_, propertyIndex) => `filler${propertyIndex}:fillerValue${propertyIndex}`,
        ),
        ...Array.from(
          { length: propertyCount },
          (_, propertyIndex) => `useNitroApp:useGetter${propertyIndex}`,
        ),
      ].join(",");
      const calls = Array.from(
        { length: propertyCount },
        (_, propertyIndex) => `useGetter${propertyIndex}()`,
      ).join(",");
      const result = runRule(
        wrapWithSemanticContext(observed),
        `const {${properties}}=await import("nitropack/runtime"); export const applications=[${calls}];`,
        { filename: "fixture.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(propertyCount);
      expect(computedPropertyReads).toBeGreaterThan(0);
      expect(computedPropertyReads).toBeLessThanOrEqual(
        (properties.split(",").length + NITRO_GETTER_PROPERTY_PROOF_FIXED_READ_COUNT) *
          NITRO_GETTER_PROPERTY_PROOF_READ_MULTIPLIER,
      );
    },
  );

  it("keeps cached true and false proofs isolated between analyses", () => {
    for (const mutation of ["", "useNitroApp=replacement;", ""]) {
      const result = runTsx(
        `const {useNitroApp}=await import("nitropack/runtime"); interface useNitroApp {} ${mutation} consume(useNitroApp());`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(mutation ? 1 : 0);
    }
  });
});
