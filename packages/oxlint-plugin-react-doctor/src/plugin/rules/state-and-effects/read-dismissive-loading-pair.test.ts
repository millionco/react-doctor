import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseSourceText } from "../../utils/parse-source-file.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { readDismissiveLoadingPair } from "./read-passive-loading-pair.js";

const component = (effects: string) => `
import { useCallback, useEffect, useState } from "react";
import { useCatalog } from "./catalog";
export default function Catalog({ shown, category, dismiss }) {
  const { listItems } = useCatalog();
  const [loading, setLoading] = useState(false);
  const query = useCallback(async () => {
    const selected = category;
    try {
      const items = await listItems(selected);
      return items;
    } finally {
      setLoading(false);
    }
  }, [category, listItems]);
  const prune = useCallback(() => {}, []);
  ${effects}
  const restore = useCallback(async () => {
    try {
      await query();
      dismiss(false);
    } catch {
      return;
    }
  }, [query, dismiss]);
  return <button onClick={restore}>{String(loading)}</button>;
}
`;

const separate = `
  useEffect(() => {
    if (!shown) { return; }
    void query();
  }, [shown, query]);
  useEffect(() => {
    setLoading(shown);
    prune();
  }, [category, shown, prune]);
`;

const combined = `
  useEffect(() => {
    if (!shown) {
      setLoading((previous) => previous ? false : previous);
      prune();
      return;
    }
    prune();
    void query();
  }, [shown, category, query, prune]);
`;

const inspect = (sourceText: string) => {
  const program = parseSourceText({ filename: "Catalog.tsx", sourceText });
  if (!isNodeOfType(program, "Program")) throw new Error("Invalid authored test source");
  const context = { scopes: analyzeScopes(program) } as RuleContext;
  let firstAwait: EsTreeNodeOfType<"AwaitExpression"> | undefined;
  let extraSetterIdentifier: EsTreeNode | undefined;
  walkAst(program, (node) => {
    if (
      isNodeOfType(node, "AwaitExpression") &&
      isNodeOfType(node.argument, "CallExpression") &&
      isNodeOfType(node.argument.callee, "Identifier") &&
      node.argument.callee.name === "listItems"
    )
      firstAwait = node;
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "setLoading" &&
      !isNodeOfType(node.arguments[0], "Literal")
    )
      extraSetterIdentifier = node.callee;
  });
  if (!firstAwait || !extraSetterIdentifier) throw new Error("Missing authored calls");
  const request = findEnclosingFunction(firstAwait);
  const owner = request && findEnclosingFunction(request);
  if (!request || !owner) throw new Error("Missing authored owner");
  return readDismissiveLoadingPair({ owner, request, extraSetterIdentifier, firstAwait, context });
};

describe("dismissed loading request pairing", () => {
  it("binds the unconditional dismissal after an awaited request", () => {
    expect(inspect(component(separate))).toMatchObject({
      openProperty: "shown",
      viewProperty: "category",
      dismissalProperty: "dismiss",
      contextField: "listItems",
    });
  });

  it("accepts a false-only release in the same effect that starts the request", () => {
    expect(inspect(component(combined))).toMatchObject({
      dismissalProperty: "dismiss",
      releaseInLaunch: true,
    });
  });

  it.each([
    ["dismissal omitted", "      dismiss(false);", ""],
    ["conditional dismissal", "      dismiss(false);", "      if (shown) dismiss(false);"],
    ["deferred dismissal", "      dismiss(false);", "      queueMicrotask(() => dismiss(false));"],
    ["request observed only after dismissal", "      await query();", "      void query();"],
    [
      "independent late dependency",
      "[category, shown, prune]",
      "[category, shown, prune, loading]",
    ],
  ])("rejects %s", (_label, before, after) => {
    expect(inspect(component(separate).replace(before, after))).toBeNull();
  });

  it("rejects the same-effect updater when it can return true", () => {
    expect(
      inspect(
        component(combined).replace("previous ? false : previous", "previous ? false : true"),
      ),
    ).toBeNull();
  });
});
