import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { UNSUPPORTED_SHADOW_LIGHT_CONSTRUCTOR_NAMES } from "./constants.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface ThreeShadowFact {
  node: EsTreeNode;
  owner: EsTreeNode;
}

interface ThreeRendererFact {
  owner: EsTreeNode;
  rendererKey: string;
}

const THREE_SHADOW_OBJECT_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "castShadow",
  "receiveShadow",
]);

const getOwner = (node: EsTreeNode, program: EsTreeNode): EsTreeNode =>
  findEnclosingFunction(node) ?? program;

export const threeRequireShadowsEnabled = defineRule({
  id: "three-require-shadows-enabled",
  title: "Three.js shadow caster without renderer shadow maps",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Set renderer.shadowMap.enabled = true when rendered objects cast or receive shadows",
  create: (context: RuleContext) => {
    const renderedWith: ThreeRendererFact[] = [];
    const shadowEnabledWith: ThreeRendererFact[] = [];
    const shadowUsers: ThreeShadowFact[] = [];
    let program: EsTreeNode | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        program = node;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !program ||
          !isNodeOfType(node.callee, "MemberExpression") ||
          getStaticPropertyName(node.callee) !== "render" ||
          getThreeConstructorName(node.callee.object, context.scopes) !== "WebGLRenderer"
        ) {
          return;
        }
        const rendererKey = resolveExpressionKey(node.callee.object, context);
        if (rendererKey) renderedWith.push({ owner: getOwner(node, program), rendererKey });
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (node.operator !== "=" || !program) return;
        const assignedValue = stripParenExpression(node.right);
        if (!isNodeOfType(assignedValue, "Literal") || assignedValue.value !== true) return;
        const target = stripParenExpression(node.left);
        if (!isNodeOfType(target, "MemberExpression")) return;
        const propertyName = getStaticPropertyName(target);
        if (
          propertyName &&
          THREE_SHADOW_OBJECT_PROPERTY_NAMES.has(propertyName) &&
          (() => {
            const constructorName = getThreeConstructorName(target.object, context.scopes);
            return Boolean(
              constructorName && !UNSUPPORTED_SHADOW_LIGHT_CONSTRUCTOR_NAMES.has(constructorName),
            );
          })()
        ) {
          shadowUsers.push({ node, owner: getOwner(node, program) });
          return;
        }
        if (propertyName !== "enabled") return;
        const shadowMap = stripParenExpression(target.object);
        if (
          !isNodeOfType(shadowMap, "MemberExpression") ||
          getStaticPropertyName(shadowMap) !== "shadowMap" ||
          getThreeConstructorName(shadowMap.object, context.scopes) !== "WebGLRenderer"
        ) {
          return;
        }
        const rendererKey = resolveExpressionKey(shadowMap.object, context);
        if (rendererKey) shadowEnabledWith.push({ owner: getOwner(node, program), rendererKey });
      },
      "Program:exit"() {
        for (const shadowUser of shadowUsers) {
          const ownerRenderers = renderedWith.filter(
            (renderer) => renderer.owner === shadowUser.owner,
          );
          if (
            ownerRenderers.length === 0 ||
            ownerRenderers.every((renderer) =>
              shadowEnabledWith.some(
                (enabled) =>
                  enabled.owner === renderer.owner && enabled.rendererKey === renderer.rendererKey,
              ),
            )
          ) {
            continue;
          }
          context.report({
            node: shadowUser.node,
            message:
              "This object enables castShadow or receiveShadow, but the WebGLRenderer used by this owner never enables shadowMap.enabled",
          });
        }
      },
    };
  },
});
