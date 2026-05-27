import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const ONMOUNT_NAMES: ReadonlyArray<string> = ["onMount"];

const returnsFunction = (callback: EsTreeNode): boolean => {
  if (isNodeOfType(callback, "ArrowFunctionExpression") && callback.expression) {
    const body = callback.body as EsTreeNode;
    return isFunctionLike(body);
  }

  let found = false;
  walkAst(callback, (node) => {
    if (found) return false;
    if (isFunctionLike(node) && node !== callback) return false;
    if (isNodeOfType(node, "ReturnStatement") && node.argument) {
      const argument = node.argument as EsTreeNode;
      if (isFunctionLike(argument)) {
        found = true;
        return false;
      }
    }
  });
  return found;
};

export const solidNoOnmountCleanupReturn = defineRule<Rule>({
  id: "solid-no-onmount-cleanup-return",
  severity: "error",
  requires: ["solid"],
  recommendation:
    "Returning a cleanup function from `onMount` does nothing — unlike React's `useEffect`, Solid ignores the return value. Use `onCleanup()` instead.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        if (!importTracker.matchImport(ONMOUNT_NAMES, node.callee.name)) return;
        if (node.arguments.length < 1) return;
        const callback = node.arguments[0] as EsTreeNode;
        if (!isFunctionLike(callback)) return;
        if (!returnsFunction(callback)) return;
        context.report({
          node,
          message:
            "Returning a cleanup function from `onMount` has no effect — Solid ignores the return value. Register cleanup with `onCleanup(() => …)` instead.",
        });
      },
    };
  },
});
