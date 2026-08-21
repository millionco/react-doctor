import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { collectR3fHostRefSymbolIds } from "./utils/collect-r3f-host-ref-symbol-ids.js";
import { getShaderConfigurationMutationReceiver } from "./utils/get-shader-configuration-mutation-receiver.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const isManagedShaderMaterialRefCurrent = (
  expression: EsTreeNode,
  managedRefSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean => {
  const currentMember = stripParenExpression(expression);
  if (
    !isNodeOfType(currentMember, "MemberExpression") ||
    getStaticPropertyName(currentMember) !== "current"
  ) {
    return false;
  }
  const refExpression = stripParenExpression(currentMember.object);
  if (!isNodeOfType(refExpression, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(refExpression, context.scopes);
  return Boolean(symbol && managedRefSymbolIds.has(symbol.id));
};

export const r3fNoShaderConfigurationMutationInUseFrame = defineRule({
  id: "r3f-no-shader-configuration-mutation-in-use-frame",
  title: "R3F shader configuration mutates every frame",
  category: "Performance",
  severity: "error",
  recommendation:
    "Keep shader source and program configuration stable; animate materialRef.current.uniforms.*.value instead",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    let managedRefSymbolIds: ReadonlySet<number> = new Set();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        managedRefSymbolIds = collectR3fHostRefSymbolIds(
          node,
          context.scopes,
          (openingElement) =>
            isNodeOfType(openingElement.name, "JSXIdentifier") &&
            (openingElement.name.name === "shaderMaterial" ||
              openingElement.name.name === "rawShaderMaterial"),
        );
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
          if (isConditionallyExecuted || !isNodeOfType(candidate, "AssignmentExpression")) return;
          const receiver = getShaderConfigurationMutationReceiver(candidate);
          if (
            !receiver ||
            !isManagedShaderMaterialRefCurrent(receiver, managedRefSymbolIds, context)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "This useFrame callback rewrites shader program configuration every frame. Keep it stable and update existing uniform values instead",
          });
        });
      },
    };
  },
});
