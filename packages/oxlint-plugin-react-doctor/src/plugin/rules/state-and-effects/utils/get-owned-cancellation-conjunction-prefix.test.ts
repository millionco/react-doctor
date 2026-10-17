import { describe, expect, it, vi } from "vite-plus/test";
import { attachParentReferences } from "../../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../../test-utils/parse-fixture.js";
import { analyzeControlFlow } from "../../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getOwnedCancellationConjunctionPrefix } from "./get-owned-cancellation-conjunction-prefix.js";

describe("owned conjunction readonly reference work", () => {
  it.each([20, 100])("scans one binding once for %s repeated tails", (tailCount) => {
    const code = `import { useEffect, useState } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const payload = await Promise.resolve(1);
      if (!cancelled && ${Array(tailCount).fill("payload").join(" && ")}) setValue(payload);
    };
    void load();
    return () => { cancelled = true; };
  }, []);
  return <output>{String(value)}</output>;
};`;
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    let effectCallback: EsTreeNode | null = null;
    let guard: EsTreeNode | null = null;
    let payload: EsTreeNodeOfType<"Identifier"> | null = null;
    walkAst(parsed.program, (node) => {
      if (
        isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "Identifier") &&
        node.callee.name === "useEffect"
      )
        effectCallback = node.arguments[0] ?? null;
      if (isNodeOfType(node, "IfStatement")) guard = node.test;
      if (
        isNodeOfType(node, "VariableDeclarator") &&
        isNodeOfType(node.id, "Identifier") &&
        node.id.name === "payload"
      )
        payload = node.id;
    });
    if (!effectCallback || !guard || !payload) throw new Error("Missing owned guard fixture nodes");
    const symbol = scopes.symbolFor(payload);
    if (!symbol) throw new Error("Missing payload binding");
    const everyReference = symbol.references.every.bind(symbol.references);
    let referenceVisits = 0;
    const readonlyChecks = vi.spyOn(symbol.references, "every").mockImplementation((predicate) =>
      everyReference((reference, index, references) => {
        referenceVisits += 1;
        return predicate(reference, index, references);
      }),
    );
    const prefix = getOwnedCancellationConjunctionPrefix(guard, effectCallback, {
      scopes,
      cfg: analyzeControlFlow(parsed.program),
      report: () => {},
    });
    expect(prefix?.type).toBe("UnaryExpression");
    expect(symbol.references).toHaveLength(tailCount + 1);
    expect(readonlyChecks).toHaveBeenCalledTimes(1);
    expect(referenceVisits).toBe(tailCount + 1);
    readonlyChecks.mockRestore();
  });
});
