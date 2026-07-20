import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { functionReturnsCollectionAtPath } from "./function-returns-collection-at-path.js";
import { isFunctionLike } from "./is-function-like.js";
import { walkAst } from "./walk-ast.js";

const getFunction = (
  code: string,
): { functionNode: EsTreeNode; scopes: ReturnType<typeof analyzeScopes> } => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  let functionNode: EsTreeNode | null = null;
  walkAst(parsed.program, (node: EsTreeNode) => {
    if (functionNode || !isFunctionLike(node)) return;
    functionNode = node;
  });
  if (!functionNode) throw new Error("Expected a function fixture");
  return { functionNode, scopes };
};

describe("functionReturnsCollectionAtPath", () => {
  it("proves nested arrays and Map or Set instances through immutable aliases", () => {
    const { functionNode, scopes } = getFunction(`
      const selected = new Set();
      const createState = () => ({ nested: { items: [], selected } });
    `);
    expect(
      functionReturnsCollectionAtPath({
        collectionKind: "array",
        functionNode,
        propertyPath: ["nested", "items"],
        scopes,
      }),
    ).toBe(true);
    expect(
      functionReturnsCollectionAtPath({
        collectionKind: "map-or-set",
        functionNode,
        propertyPath: ["nested", "selected"],
        scopes,
      }),
    ).toBe(true);
  });

  it("rejects custom objects, mutable aliases, shadowed constructors, and mixed returns", () => {
    const customObject = getFunction(`
      const createState = () => ({ queue: { push: () => queue } });
    `);
    expect(
      functionReturnsCollectionAtPath({
        collectionKind: "array",
        functionNode: customObject.functionNode,
        propertyPath: ["queue"],
        scopes: customObject.scopes,
      }),
    ).toBe(false);

    const mixedReturns = getFunction(`
      const createState = (enabled) => {
        if (enabled) return { items: [] };
        return { items: makeItems() };
      };
    `);
    expect(
      functionReturnsCollectionAtPath({
        collectionKind: "array",
        functionNode: mixedReturns.functionNode,
        propertyPath: ["items"],
        scopes: mixedReturns.scopes,
      }),
    ).toBe(false);
  });
});
