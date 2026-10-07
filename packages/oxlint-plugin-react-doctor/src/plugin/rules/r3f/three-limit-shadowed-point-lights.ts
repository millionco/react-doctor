import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { MAX_SHADOWED_POINT_LIGHT_COUNT } from "./constants.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface ShadowedPointLightFact {
  readonly lightKey: string;
  readonly node: EsTreeNode;
  readonly owner: EsTreeNode;
}

interface SceneLightFact {
  readonly lightKey: string;
  readonly owner: EsTreeNode;
  readonly sceneKey: string;
}

const getExecutionOwner = (node: EsTreeNode, program: EsTreeNode): EsTreeNode =>
  findEnclosingFunction(node) ?? program;

export const threeLimitShadowedPointLights = defineRule({
  id: "three-limit-shadowed-point-lights",
  title: "Too many shadow-casting Three.js point lights",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Keep at most two shadow-casting point lights in one scene, or use cheaper directional, spot, baked, or fake shadows",
  create: (context: RuleContext) => {
    const sceneLightFacts: SceneLightFact[] = [];
    const shadowedPointLights: ShadowedPointLightFact[] = [];
    let program: EsTreeNode | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        program = node;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !program ||
          !isNodeOfType(node.callee, "MemberExpression") ||
          getStaticPropertyName(node.callee) !== "add" ||
          getThreeConstructorName(node.callee.object, context.scopes) !== "Scene"
        ) {
          return;
        }
        const owner = getExecutionOwner(node, program);
        if (isNodeConditionallyExecuted(node, owner)) return;
        const sceneKey = resolveExpressionKey(node.callee.object, context);
        if (!sceneKey) return;
        for (const light of node.arguments) {
          if (
            isNodeOfType(light, "SpreadElement") ||
            getThreeConstructorName(light, context.scopes) !== "PointLight"
          ) {
            continue;
          }
          const lightKey = resolveExpressionKey(light, context);
          if (lightKey) sceneLightFacts.push({ lightKey, owner, sceneKey });
        }
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        const assignedValue = stripParenExpression(node.right);
        if (
          !program ||
          node.operator !== "=" ||
          !isNodeOfType(node.left, "MemberExpression") ||
          getStaticPropertyName(node.left) !== "castShadow" ||
          getThreeConstructorName(node.left.object, context.scopes) !== "PointLight" ||
          !isNodeOfType(assignedValue, "Literal") ||
          assignedValue.value !== true
        ) {
          return;
        }
        const owner = getExecutionOwner(node, program);
        if (isNodeConditionallyExecuted(node, owner)) return;
        const lightKey = resolveExpressionKey(node.left.object, context);
        if (lightKey) shadowedPointLights.push({ lightKey, node, owner });
      },
      "Program:exit"() {
        const countByOwnerAndScene = new Map<EsTreeNode, Map<string, number>>();
        const countedLights = new Map<EsTreeNode, Map<string, Set<string>>>();
        for (const shadowedLight of shadowedPointLights) {
          const matchingScene = sceneLightFacts.find(
            (sceneLight) =>
              sceneLight.owner === shadowedLight.owner &&
              sceneLight.lightKey === shadowedLight.lightKey,
          );
          if (!matchingScene) continue;
          const ownerCounts = countByOwnerAndScene.get(shadowedLight.owner) ?? new Map();
          const ownerLights = countedLights.get(shadowedLight.owner) ?? new Map();
          countByOwnerAndScene.set(shadowedLight.owner, ownerCounts);
          countedLights.set(shadowedLight.owner, ownerLights);
          const sceneLights = ownerLights.get(matchingScene.sceneKey) ?? new Set();
          ownerLights.set(matchingScene.sceneKey, sceneLights);
          if (sceneLights.has(shadowedLight.lightKey)) continue;
          sceneLights.add(shadowedLight.lightKey);
          const nextCount = (ownerCounts.get(matchingScene.sceneKey) ?? 0) + 1;
          ownerCounts.set(matchingScene.sceneKey, nextCount);
          if (nextCount <= MAX_SHADOWED_POINT_LIGHT_COUNT) continue;
          context.report({
            node: shadowedLight.node,
            message:
              "This is the third or later shadow-casting point light added to the same scene. Each point-light shadow renders six cube faces, multiplying shadow passes",
          });
        }
      },
    };
  },
});
