import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isInsideRepeatedExecution } from "./utils/is-inside-repeated-execution.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const receiverIsManagedInstancedMesh = (
  receiver: EsTreeNode,
  managedRefSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean => {
  if (getThreeConstructorName(receiver, context.scopes) === "InstancedMesh") return true;
  const refSymbol = resolveReactRefSymbol(receiver, context.scopes, {
    includeCreateRef: true,
    resolveNamedAliases: true,
  });
  return Boolean(refSymbol && managedRefSymbolIds.has(refSymbol.id));
};

export const r3fPreferGpuInstancedAnimation = defineRule({
  id: "r3f-prefer-gpu-instanced-animation",
  title: "Per-instance CPU transform animation in R3F useFrame",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Move repeated per-instance transform motion into instanced attributes, a vertex shader, or GPU simulation",
  create: (context: RuleContext) => {
    const frameCallbacks = new Set<EsTreeNode>();
    const managedInstancedRefSymbolIds = new Set<number>();
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
          node.name.name !== "instancedMesh"
        ) {
          return;
        }
        const refAttribute = getAuthoritativeJsxAttribute(node.attributes, "ref");
        if (
          !refAttribute?.value ||
          !isNodeOfType(refAttribute.value, "JSXExpressionContainer") ||
          isNodeOfType(refAttribute.value.expression, "JSXEmptyExpression") ||
          !isNodeOfType(refAttribute.value.expression, "Identifier")
        ) {
          return;
        }
        const symbol = resolveConstIdentifierAlias(refAttribute.value.expression, context.scopes);
        if (symbol) managedInstancedRefSymbolIds.add(symbol.id);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (callback) frameCallbacks.add(callback);
      },
      "Program:exit"() {
        for (const callback of frameCallbacks) {
          walkFunctionExecution(callback, context.scopes, (candidate) => {
            if (
              !isNodeOfType(candidate, "CallExpression") ||
              !isNodeOfType(candidate.callee, "MemberExpression") ||
              getStaticPropertyName(candidate.callee) !== "setMatrixAt" ||
              !isInsideRepeatedExecution(candidate) ||
              !receiverIsManagedInstancedMesh(
                candidate.callee.object,
                managedInstancedRefSymbolIds,
                context,
              )
            ) {
              return;
            }
            context.report({
              node: candidate,
              message:
                "This useFrame loop recomputes instance matrices on the CPU every frame. Encode repeated transform motion in instanced attributes, a vertex shader, or GPU simulation",
            });
          });
        }
      },
    };
  },
});
