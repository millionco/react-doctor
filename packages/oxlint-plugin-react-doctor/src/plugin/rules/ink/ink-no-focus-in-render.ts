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

const FOCUS_METHOD_NAMES = new Set(["focus", "focusNext", "focusPrevious"]);

const isUseFocusManagerCall = (
  node: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(
    node &&
    isNodeOfType(node, "CallExpression") &&
    resolveInkApiName(node.callee, scopes) === "useFocusManager",
  );

const isFocusManagerMethodCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: Parameters<typeof findRenderPhaseComponentOrHook>[1],
): boolean => {
  const callee = callExpression.callee;
  if (isNodeOfType(callee, "MemberExpression")) {
    const methodName = getStaticPropertyName(callee);
    if (!methodName || !FOCUS_METHOD_NAMES.has(methodName)) return false;
    const focusManagerObject = stripParenExpression(callee.object);
    if (isUseFocusManagerCall(focusManagerObject, context)) return true;
    if (!isNodeOfType(focusManagerObject, "Identifier")) return false;
    return isUseFocusManagerCall(context.symbolFor(focusManagerObject)?.initializer, context);
  }
  if (!isNodeOfType(callee, "Identifier") || !FOCUS_METHOD_NAMES.has(callee.name)) return false;
  const symbol = context.symbolFor(callee);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "VariableDeclarator")) return false;
  return isUseFocusManagerCall(symbol.declarationNode.init, context);
};

export const inkNoFocusInRender = defineRule({
  id: "ink-no-focus-in-render",
  title: "Ink focus changed during render",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Move focus-manager calls to an effect or input handler.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isFocusManagerMethodCall(node, context.scopes) ||
        !findRenderPhaseComponentOrHook(node, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message: "Changing Ink focus during render can trigger render loops.",
      });
    },
  }),
});
