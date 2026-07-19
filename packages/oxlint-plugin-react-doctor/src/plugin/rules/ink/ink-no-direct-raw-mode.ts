import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

const isUseStdinCall = (node: EsTreeNode | null | undefined, scopes: ScopeAnalysis): boolean =>
  Boolean(
    node &&
    isNodeOfType(node, "CallExpression") &&
    resolveInkApiName(node.callee, scopes) === "useStdin",
  );

const isInkSetRawModeCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: Parameters<typeof findRenderPhaseComponentOrHook>[1],
): boolean => {
  const callee = callExpression.callee;
  if (isNodeOfType(callee, "MemberExpression")) {
    if (getStaticPropertyName(callee) !== "setRawMode") return false;
    if (isUseStdinCall(callee.object, context)) return true;
    return (
      isNodeOfType(callee.object, "Identifier") &&
      isUseStdinCall(context.symbolFor(callee.object)?.initializer, context)
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
  title: "Raw mode managed outside Ink",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Let Ink's input hooks manage terminal raw mode and cleanup.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isInkSetRawModeCall(node, context.scopes)) return;
      if (!findRenderPhaseComponentOrHook(node, context.scopes)) return;
      context.report({
        node,
        message: "Direct `setRawMode` calls can leave the terminal corrupted after exit.",
      });
    },
  }),
});
