import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { walkAst } from "./walk-ast.js";

describe("getEquivalentSymbols", () => {
  it("indexes separate alias roots within one scope analysis", () => {
    const parsed = parseFixture(`
      const rootAlpha = {};
      const aliasAlpha = rootAlpha;
      const rootBeta = {};
      const aliasBeta = rootBeta;
      consume(aliasAlpha, aliasBeta);
    `);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const callArguments = new Map<string, EsTreeNode>();
    walkAst(parsed.program, (node) => {
      if (
        node.type === "Identifier" &&
        node.parent?.type === "CallExpression" &&
        node.name !== "consume"
      ) {
        callArguments.set(node.name, node);
      }
    });

    const getBindingNames = (identifierName: string): unknown[] => {
      const identifier = callArguments.get(identifierName);
      if (!identifier) throw new Error(`Missing ${identifierName} call argument`);
      return getEquivalentSymbols(identifier, scopes).map((symbol) =>
        "name" in symbol.bindingIdentifier ? symbol.bindingIdentifier.name : null,
      );
    };

    expect(getBindingNames("aliasAlpha")).toEqual(["rootAlpha", "aliasAlpha"]);
    expect(getBindingNames("aliasBeta")).toEqual(["rootBeta", "aliasBeta"]);
  });
});
