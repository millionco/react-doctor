import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const isUseStdinCall = (node: EsTreeNode | null | undefined, scopes: ScopeAnalysis): boolean => {
  if (!node) return false;
  const unwrappedNode = stripParenExpression(node);
  return (
    isNodeOfType(unwrappedNode, "CallExpression") &&
    resolveInkApiName(unwrappedNode.callee, scopes) === "useStdin"
  );
};

const isInkSetRawModeCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: Parameters<typeof findRenderPhaseComponentOrHook>[1],
): boolean => {
  const callee = callExpression.callee;
  if (isNodeOfType(callee, "MemberExpression")) {
    if (getStaticPropertyName(callee) !== "setRawMode") return false;
    const stdinObject = stripParenExpression(callee.object);
    if (isUseStdinCall(stdinObject, context)) return true;
    return (
      isNodeOfType(stdinObject, "Identifier") &&
      isUseStdinCall(context.symbolFor(stdinObject)?.initializer, context)
    );
  }
  if (!isNodeOfType(callee, "Identifier") || callee.name !== "setRawMode") return false;
  const symbol = context.symbolFor(callee);
  return Boolean(
    symbol &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    isUseStdinCall(symbol.declarationNode.init, context),
  );
};

export const inkNoDirectRawMode = defineRule({
  id: "ink-no-direct-raw-mode",
  title: "Raw mode changed during render",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Move `useStdin().setRawMode()` to an effect and restore it in cleanup.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isInkSetRawModeCall(node, context.scopes)) return;
      if (!findRenderPhaseComponentOrHook(node, context.scopes)) return;
      context.report({
        node,
        message: "Changing terminal raw mode during render is an untracked side effect.",
      });
    },
  }),
});
