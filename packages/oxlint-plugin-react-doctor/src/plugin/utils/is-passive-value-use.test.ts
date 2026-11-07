import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH } from "./closed-json-snapshot/constants.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPassiveValueUse } from "./is-passive-value-use.js";
import { parseSourceText } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";

describe("isPassiveValueUse", () => {
  it("bounds repeated readonly alias diamonds while retaining passive data", () => {
    const maximumDepth = CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH;
    const declarations = ["const selected = values[choice];"];
    let previousName = "selected";
    for (let level = 0; level < Math.floor(maximumDepth / 2) - 1; level += 1) {
      const name = `caption${level}`;
      declarations.push(`const ${name} = ${previousName} || ${previousName};`);
      previousName = name;
    }
    declarations.push(`void ${previousName};`);
    const program = parseSourceText({
      filename: "passive.jsx",
      sourceText: declarations.join("\n"),
    });
    if (!program) throw new Error("Synthetic passive data must parse");
    let computedRead: EsTreeNode | null = null;
    walkAst(program, (node) => {
      if (isNodeOfType(node, "MemberExpression") && node.computed) computedRead = node;
    });
    if (!computedRead) throw new Error("Synthetic data must contain a computed read");
    const scopes = analyzeScopes(program);
    let bindingLookupCount = 0;
    const measuredScopes = {
      ...scopes,
      symbolFor: (node: EsTreeNode) => {
        bindingLookupCount += 1;
        return scopes.symbolFor(node);
      },
    };
    expect(isPassiveValueUse({ node: computedRead, scopes: measuredScopes, maximumDepth })).toBe(
      true,
    );
    expect(bindingLookupCount).toBeLessThanOrEqual(maximumDepth);
    expect(isPassiveValueUse({ node: computedRead, scopes, maximumDepth: 0 })).toBe(false);
  });
});
