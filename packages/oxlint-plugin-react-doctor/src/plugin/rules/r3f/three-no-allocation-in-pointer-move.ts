import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { hasThreeObjectProvenance } from "./utils/has-three-object-provenance.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";
import { resolveThreePointerMoveCallback } from "./utils/resolve-three-pointer-move-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

export const threeNoAllocationInPointerMove = defineRule({
  id: "three-no-allocation-in-pointer-move",
  title: "Three.js allocation inside pointer-move handler",
  severity: "warn",
  recommendation:
    "Reuse vectors, raycasters, and other Three.js objects while handling continuous pointer movement",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    const analyzeCallback = (node: EsTreeNode): void => {
      const callback = resolveThreePointerMoveCallback(node, context);
      if (!callback || analyzedCallbacks.has(callback)) return;
      analyzedCallbacks.add(callback);
      walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
        if (isConditionallyExecuted) return;
        if (isNodeOfType(candidate, "NewExpression")) {
          const provenance = getApiReferenceProvenance(candidate.callee, context.scopes);
          if (!provenance || !isThreeModuleSource(provenance.moduleSource)) return;
          context.report({
            node: candidate,
            message:
              "This Three.js constructor allocates on every pointer movement. Reuse an object created outside the handler",
          });
          return;
        }
        if (
          !isNodeOfType(candidate, "CallExpression") ||
          !isNodeOfType(candidate.callee, "MemberExpression") ||
          getStaticPropertyName(candidate.callee) !== "clone" ||
          !hasThreeObjectProvenance(candidate.callee.object, context.scopes)
        ) {
          return;
        }
        context.report({
          node: candidate,
          message:
            "This clone allocates a Three.js object on every pointer movement. Copy into a reusable object instead",
        });
      });
    };
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        analyzeCallback(node);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        analyzeCallback(node);
      },
    };
  },
});
