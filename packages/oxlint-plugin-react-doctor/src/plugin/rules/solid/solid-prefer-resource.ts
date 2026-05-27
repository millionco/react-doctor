import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const EFFECT_PRIMITIVES: ReadonlyArray<string> = ["createEffect", "createRenderEffect"];

const FETCH_IDENTIFIERS = new Set(["fetch"]);

const containsFetchLikeCall = (node: EsTreeNode): boolean => {
  let found = false;
  walkAst(node, (child) => {
    if (found) return false;
    if (isFunctionLike(child) && child !== node) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (isNodeOfType(child.callee, "Identifier") && FETCH_IDENTIFIERS.has(child.callee.name)) {
      found = true;
      return false;
    }
  });
  return found;
};

const containsSetterCall = (node: EsTreeNode): boolean => {
  let found = false;
  walkAst(node, (child) => {
    if (found) return false;
    if (isFunctionLike(child) && child !== node) return false;
    if (isSetterCall(child)) {
      found = true;
      return false;
    }
  });
  return found;
};

export const solidPreferResource = defineRule<Rule>({
  id: "solid-prefer-resource",
  severity: "warn",
  requires: ["solid"],
  recommendation:
    "Use `createResource` (or SolidStart's `createAsync`) for async data fetching — it integrates with `<Suspense>`, handles race conditions, and avoids the fetch-in-effect anti-pattern.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        const matchedImport = importTracker.matchImport(EFFECT_PRIMITIVES, node.callee.name);
        if (!matchedImport) return;
        if (node.arguments.length < 1) return;
        const callback = node.arguments[0];
        if (!isFunctionLike(callback)) return;
        const hasFetch = containsFetchLikeCall(callback);
        if (!hasFetch) return;
        if (!containsSetterCall(callback)) return;
        context.report({
          node,
          message: `This \`${matchedImport}\` fetches data and stores it in state — prefer \`createResource\` which integrates with \`<Suspense>\` and handles race conditions automatically.`,
        });
      },
    };
  },
});
