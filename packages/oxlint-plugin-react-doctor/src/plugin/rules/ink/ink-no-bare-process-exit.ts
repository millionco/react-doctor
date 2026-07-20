import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../utils/is-proven-global-namespace-reference.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

const findUseInputHandler = (node: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  const enclosingFunction = findEnclosingFunction(node);
  if (!enclosingFunction) return null;
  const parentNode = enclosingFunction.parent;
  return parentNode &&
    isNodeOfType(parentNode, "CallExpression") &&
    parentNode.arguments[0] === enclosingFunction &&
    resolveInkApiName(parentNode.callee, context.scopes) === "useInput"
    ? enclosingFunction
    : null;
};

export const inkNoBareProcessExit = defineRule({
  id: "ink-no-bare-process-exit",
  title: "Process exits before Ink cleanup",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Use Ink's `useApp().exit()` so Ink restores terminal state.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        getStaticPropertyName(node.callee) !== "exit" ||
        !isProvenGlobalNamespaceReference(node.callee.object, "process", context.scopes)
      ) {
        return;
      }
      if (!findUseInputHandler(node, context)) return;
      context.report({
        node,
        message: "`process.exit()` in an Ink input handler bypasses Ink's terminal cleanup.",
      });
    },
  }),
});
