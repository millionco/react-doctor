import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findProvablyRepeatedMapCallsForCallback } from "./utils/find-provably-repeated-map-calls-for-callback.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isReferenceStableAcrossFunctionExecutions } from "./utils/is-reference-stable-across-function-executions.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";

const hasSharedGeometryAndMaterial = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  callback: EsTreeNode,
  context: RuleContext,
): boolean => {
  for (const attributeName of ["geometry", "material"]) {
    const attribute = getAuthoritativeJsxAttribute(node.attributes, attributeName);
    if (
      !attribute?.value ||
      !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
      isNodeOfType(attribute.value.expression, "JSXEmptyExpression") ||
      !isReferenceStableAcrossFunctionExecutions(attribute.value.expression, callback, context)
    ) {
      return false;
    }
  }
  return true;
};

export const r3fPreferInstancedMesh = defineRule({
  id: "r3f-prefer-instanced-mesh",
  title: "Repeated R3F meshes use separate draw calls",
  tags: ["react-jsx-only"],
  category: "Performance",
  severity: "warn",
  recommendation:
    "Render repeated meshes that share geometry and material with <instancedMesh> so they can use one draw call",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          !isR3fHostIntrinsic(node) ||
          !isNodeOfType(node.name, "JSXIdentifier") ||
          node.name.name !== "mesh"
        ) {
          return;
        }
        const callback = findEnclosingFunction(node);
        if (
          !callback ||
          isNodeConditionallyExecuted(node, callback) ||
          !functionReturnsMatchingExpression(
            callback,
            context.scopes,
            (returnedExpression) => isAstDescendant(node, returnedExpression),
            context.cfg,
            "every",
          ) ||
          !hasSharedGeometryAndMaterial(node, callback, context)
        ) {
          return;
        }
        const repeatedRenderedMaps = findProvablyRepeatedMapCallsForCallback(
          callback,
          context,
        ).filter((mapCall) => {
          const renderOwner = findRenderPhaseComponentOrHook(mapCall, context.scopes);
          return Boolean(
            renderOwner &&
            functionReturnsMatchingExpression(
              renderOwner,
              context.scopes,
              (returnedExpression) => isAstDescendant(mapCall, returnedExpression),
              context.cfg,
            ),
          );
        });
        if (repeatedRenderedMaps.length === 0) return;
        context.report({
          node,
          message:
            "This map renders multiple meshes with the same geometry and material, creating a draw call for each item. Use <instancedMesh> and set each instance transform",
        });
      },
    };
  },
});
