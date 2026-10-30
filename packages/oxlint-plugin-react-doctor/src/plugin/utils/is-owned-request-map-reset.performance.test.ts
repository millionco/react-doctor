import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../semantic/control-flow-graph.js";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isOwnedRequestMapReset } from "../rules/state-and-effects/utils/is-owned-request-map-reset.js";
import { runRule } from "../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "../rules/state-and-effects/no-adjust-state-on-prop-change.js";
import {
  REQUEST_MAP_PROOF_COUNTS,
  REQUEST_MAP_MAX_COMPONENT_PASSES,
  REQUEST_MAP_MAX_REFERENCE_PASSES,
  REQUEST_MAP_MAX_AST_NODE_PASSES,
} from "../../test-utils/request-map-proof/constants.js";
interface RequestMapBodyCounter {
  node: Extract<EsTreeNode, { type: "Program" | "BlockStatement" }>;
  key: "programBodyReads" | "componentBodyReads";
}

const makeSource = (shape: string, count: number, reject: boolean) => {
  const isSharedReset = shape !== "distinct-pairs";
  const pairs = isSharedReset ? 1 : count;
  const declarations = Array.from(
    { length: pairs },
    (_, index) =>
      `const pending${index}=useRef(new Map()); const [loading${index},setLoading${index}]=useState(new Set()); const start${index}=(requestKey)=>{const controller${index}=new AbortController();pending${index}.current.set(requestKey,{controller:controller${index}});setLoading${index}(previous=>new Set(previous).add(${reject ? '"other"' : "requestKey"}));${isSharedReset ? Array.from({ length: count }, () => `fetch('/items',{signal:controller${index}.signal});`).join("") : ""}};`,
  ).join("\n");
  const cancel = Array.from(
    { length: pairs },
    (_, index) =>
      `pending${index}.current.forEach(entry=>entry.controller.abort());pending${index}.current.clear();${isSharedReset ? Array.from({ length: count }, () => `setLoading${index}(new Set());`).join("") : `setLoading${index}(new Set());`}`,
  ).join("\n");
  const rendered = Array.from(
    { length: pairs },
    (_, index) => `<button onClick={()=>start${index}('item')}>{loading${index}.size}</button>`,
  ).join("");
  return `import {useEffect,useRef,useState} from 'react';export const Requests=({query})=>{${declarations}${shape === "readonly-provider-observations" ? Array.from({ length: count }, () => "void AbortController.prototype.abort;").join("") : ""}useEffect(()=>{${cancel}},[query]);return <>${rendered}</>;};`;
};
const measureRequestMapProof = (source: string) => {
  const parsed = parseFixture(source);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program),
    cfg = analyzeControlFlow(parsed.program);
  const nodes: EsTreeNode[] = [],
    writes: EsTreeNode[] = [],
    symbols = new Set<SymbolDescriptor>(),
    functions: EsTreeNode[] = [];
  walkAst(parsed.program, (node) => {
    nodes.push(node);
    if (
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression" ||
      node.type === "FunctionDeclaration"
    )
      functions.push(node);
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      /^setLoading\d+$/.test(node.callee.name) &&
      node.arguments[0]?.type === "NewExpression"
    )
      writes.push(node);
    if (node.type === "Identifier") {
      const symbol = scopes.symbolFor(node);
      if (symbol) symbols.add(symbol);
    }
  });
  functions.forEach((node) => cfg.cfgFor(node));
  const counters = {
    astTypeReads: 0,
    parentReads: 0,
    programBodyReads: 0,
    componentBodyReads: 0,
    controllerReferenceVisits: 0,
    providerReferenceVisits: 0,
    otherReferenceVisits: 0,
  };
  for (const symbol of symbols) {
    const key = /^controller\d+$/.test(symbol.name)
      ? "controllerReferenceVisits"
      : ["useEffect", "useRef", "useState"].includes(symbol.name)
        ? "providerReferenceVisits"
        : "otherReferenceVisits";
    Object.defineProperty(symbol, "references", {
      configurable: true,
      value: new Proxy(symbol.references, {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) counters[key]++;
          return Reflect.get(target, property, receiver);
        },
      }),
    });
  }
  const component = functions.find(
    (node) =>
      node.parent?.type === "VariableDeclarator" &&
      node.parent.id?.type === "Identifier" &&
      node.parent.id.name === "Requests",
  );
  if (
    parsed.program.type !== "Program" ||
    component?.type !== "ArrowFunctionExpression" ||
    component.body.type !== "BlockStatement"
  )
    throw Error("Expected component");
  const trackedBodies: RequestMapBodyCounter[] = [
    { node: parsed.program, key: "programBodyReads" },
    { node: component.body, key: "componentBodyReads" },
  ];
  for (const { node, key } of trackedBodies) {
    const body = node.body;
    Object.defineProperty(node, "body", {
      configurable: true,
      enumerable: true,
      get() {
        counters[key]++;
        return body;
      },
    });
  }
  for (const node of nodes) {
    const type = node.type,
      parent = node.parent;
    Object.defineProperty(node, "type", {
      configurable: true,
      enumerable: true,
      get() {
        counters.astTypeReads++;
        return type;
      },
    });
    Object.defineProperty(node, "parent", {
      configurable: true,
      enumerable: false,
      get() {
        counters.parentReads++;
        return parent;
      },
    });
  }
  const context = {
    scopes,
    cfg,
    settings: { "react-doctor": { portedRuleMode: "curated" } },
    sourceCode: { ast: parsed.program, getText: () => source },
    report: () => {},
  };
  const admitted = writes.map((write) => isOwnedRequestMapReset(write, context));
  return {
    parseErrors: parsed.errors,
    admitted,
    counters: { ...counters },
    astNodes: nodes.length,
    controllerReferences: [...symbols]
      .filter((symbol) => /^controller\d+$/.test(symbol.name))
      .reduce((total, symbol) => total + symbol.references.length, 0),
  };
};
describe("request-map ownership proof work", () => {
  for (const shape of ["shared-reset", "distinct-pairs", "readonly-provider-observations"])
    for (const count of REQUEST_MAP_PROOF_COUNTS) {
      it(`${shape} ${count}`, () => {
        const code = makeSource(shape, count, false),
          rejected = makeSource(shape, count, true);
        for (const [source, admitted] of [
          [code, true],
          [rejected, false],
        ] satisfies ReadonlyArray<readonly [string, boolean]>) {
          const proof = measureRequestMapProof(source);
          expect(proof.parseErrors).toEqual([]);
          expect(proof.admitted).toHaveLength(count);
          expect(proof.admitted.every((actual) => actual === admitted)).toBe(true);
          expect(proof.counters.controllerReferenceVisits).toBeLessThanOrEqual(
            proof.controllerReferences * REQUEST_MAP_MAX_REFERENCE_PASSES,
          );
          expect(proof.counters.componentBodyReads).toBeLessThanOrEqual(
            REQUEST_MAP_MAX_COMPONENT_PASSES,
          );
          expect(proof.counters.astTypeReads).toBeLessThanOrEqual(
            proof.astNodes * REQUEST_MAP_MAX_AST_NODE_PASSES,
          );
        }
        const actual = runRule(noAdjustStateOnPropChange, code),
          control = runRule(noAdjustStateOnPropChange, rejected);
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toHaveLength(0);
        expect(control.parseErrors).toEqual([]);
        expect(control.diagnostics).toHaveLength(count);
      });
    }
});
