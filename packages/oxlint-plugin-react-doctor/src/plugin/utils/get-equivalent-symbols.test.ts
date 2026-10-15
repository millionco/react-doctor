import type { EsTreeNode } from "./es-tree-node.js";
import { walkAst } from "./walk-ast.js";
import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";

const analyzeFixture = (source: string) => {
  const parsed = parseFixture(source);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  return analyzeScopes(parsed.program);
};

describe("getEquivalentSymbols pattern binding opt-in", () => {
  it("retains the default exclusion while including the tuple root and scalar aliases on request", () => {
    const scopes = analyzeFixture(`const [value, dispatch] = createState();
      const firstAlias = dispatch; const secondAlias = firstAlias;`);
    const root = scopes.rootScope.symbols.find((symbol) => symbol.name === "dispatch");
    if (!root) throw new Error("Missing fixture binding");
    expect(getEquivalentSymbols(root.bindingIdentifier, scopes)).toEqual([]);
    expect(
      getEquivalentSymbols(root.bindingIdentifier, scopes, true).map((symbol) => symbol.name),
    ).toEqual(["dispatch", "firstAlias", "secondAlias"]);
    expect(getEquivalentSymbols(root.bindingIdentifier, scopes)).toEqual([]);
    expect(
      getEquivalentSymbols(root.bindingIdentifier, scopes, true).map((symbol) => symbol.name),
    ).toEqual(["dispatch", "firstAlias", "secondAlias"]);
  });

  it("keeps default scalar aliases unchanged and excludes shadowed bindings", () => {
    const scopes = analyzeFixture(`const retained = {}; const alias = retained;
      const setup = retained => { const unrelated = retained; };`);
    const root = scopes.rootScope.symbols.find((symbol) => symbol.name === "retained");
    if (!root) throw new Error("Missing fixture binding");
    const baseline = getEquivalentSymbols(root.bindingIdentifier, scopes).map(
      (symbol) => symbol.name,
    );
    expect(baseline).toEqual(["retained", "alias"]);
    expect(
      getEquivalentSymbols(root.bindingIdentifier, scopes, true).map((symbol) => symbol.name),
    ).toEqual(baseline);
  });
});

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
