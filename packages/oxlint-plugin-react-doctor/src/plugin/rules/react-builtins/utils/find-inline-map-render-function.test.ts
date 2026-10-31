import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../../test-utils/parse-fixture.js";
import type { ScopeDescriptor } from "../../../semantic/scope-analysis.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { findInlineMapRenderFunction } from "./find-inline-map-render-function.js";

describe("inline map receiver proof reuse", () => {
  it.each([
    { mapCount: 20, hasMutation: false },
    { mapCount: 100, hasMutation: false },
    { mapCount: 20, hasMutation: true },
    { mapCount: 100, hasMutation: true },
  ])(
    "bounds reference work for $mapCount maps, mutation $hasMutation",
    ({ mapCount, hasMutation }) => {
      const code = `import {createRef,useEffect} from 'react';import rows from './rows';export const Example=()=>{${Array.from({ length: mapCount }, (_, index) => `const refs${index}=rows.map(()=>createRef());useEffect(()=>{void refs${index}[0].current},[refs${index}]);`).join("")}${hasMutation ? "rows[key]=replacement;" : ""}return <div/>};`;
      const parsed = parseFixture(code);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      let receiver: EsTreeNodeOfType<"Identifier"> | null = null;
      const allocations: EsTreeNodeOfType<"CallExpression">[] = [];
      walkAst(parsed.program, (node) => {
        if (isNodeOfType(node, "ImportDefaultSpecifier") && node.local.name === "rows")
          receiver = node.local;
        if (
          isNodeOfType(node, "CallExpression") &&
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name === "createRef"
        )
          allocations.push(node);
      });
      if (!receiver) throw new Error("Missing receiver fixture binding");
      const symbol = scopes.symbolFor(receiver);
      if (!symbol) throw new Error("Missing receiver symbol");
      let referenceVisits = 0;
      const references = new Proxy(symbol.references, {
        get: (target, property, receiver) => {
          if (typeof property === "string" && /^\d+$/.test(property)) referenceVisits += 1;
          return Reflect.get(target, property, receiver);
        },
      });
      Object.defineProperty(symbol, "references", { value: references });
      const owners = allocations.map((allocation) =>
        findInlineMapRenderFunction({ allocation, filename: "src/view.tsx", scopes }),
      );
      expect(owners.filter(Boolean)).toHaveLength(hasMutation ? 0 : mapCount);
      expect(referenceVisits).toBeGreaterThan(0);
      expect(referenceVisits).toBeLessThanOrEqual(symbol.references.length * 3);
    },
  );

  it.each([false, true])("keeps declaration ordering outside the cache, reverse $0", (reverse) => {
    const code = `import {createRef,useEffect} from 'react';
export const Before=()=>{const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div/>};
const rows=[1,2];
export const After=()=>{const refs=rows.map(()=>createRef());useEffect(()=>{void refs[0].current},[refs]);return <div/>};`;
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const allocations: EsTreeNodeOfType<"CallExpression">[] = [];
    walkAst(parsed.program, (node) => {
      if (
        isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "Identifier") &&
        node.callee.name === "createRef"
      )
        allocations.push(node);
    });
    if (reverse) allocations.reverse();
    const supported = allocations.map((allocation) =>
      Boolean(findInlineMapRenderFunction({ allocation, filename: "src/view.tsx", scopes })),
    );
    expect(supported).toEqual(reverse ? [true, false] : [false, true]);
  });
  it.each([20, 100])("indexes parent-scope observer symbols once for %s maps", (mapCount) => {
    const code = `import {createRef} from 'react';export const Example=()=>{${Array.from({ length: mapCount }, (_, index) => `const refs${index}=[1].map(()=>createRef());function focus${index}(index:number){void refs${index}[index].current}`).join("")}return <>${Array.from({ length: mapCount }, (_, index) => `<button onClick={()=>focus${index}(0)}/>`).join("")}</>};`;
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const allocations: EsTreeNodeOfType<"CallExpression">[] = [];
    const parentScopes = new Set<ScopeDescriptor>();
    walkAst(parsed.program, (node) => {
      if (isNodeOfType(node, "FunctionDeclaration")) parentScopes.add(scopes.scopeFor(node));
      if (
        isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "Identifier") &&
        node.callee.name === "createRef"
      )
        allocations.push(node);
    });
    let symbolVisits = 0;
    for (const scope of parentScopes) {
      const symbols = new Proxy(scope.symbols, {
        get: (target, property, receiver) => {
          if (typeof property === "string" && /^\d+$/.test(property)) symbolVisits += 1;
          return Reflect.get(target, property, receiver);
        },
      });
      Object.defineProperty(scope, "symbols", { value: symbols });
    }
    const owners = allocations.map((allocation) =>
      findInlineMapRenderFunction({ allocation, filename: "src/view.tsx", scopes }),
    );
    expect(owners.filter(Boolean)).toHaveLength(mapCount);
    expect(symbolVisits).toBeGreaterThan(0);
    expect(symbolVisits).toBeLessThanOrEqual(mapCount * 2);
  });
});
