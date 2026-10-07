import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedNameFromReactRouter } from "./get-imported-name-from-react-router.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

export const containsReactRouterExportUsage = (
  context: RuleContext,
  root: EsTreeNode,
  exportNames: ReadonlySet<string>,
): boolean => {
  let hasUsage = false;
  walkAst(root, (descendant) => {
    if (hasUsage) return false;
    if (descendant !== root && isFunctionLike(descendant)) return false;
    const identifier = isNodeOfType(descendant, "CallExpression")
      ? descendant.callee
      : isNodeOfType(descendant, "JSXOpeningElement")
        ? descendant.name
        : null;
    if (!isNodeOfType(identifier, "Identifier") && !isNodeOfType(identifier, "JSXIdentifier")) {
      return;
    }
    const importedName = getImportedNameFromReactRouter(context, identifier, identifier.name);
    if (importedName !== null && exportNames.has(importedName)) {
      hasUsage = true;
      return false;
    }
  });
  return hasUsage;
};
