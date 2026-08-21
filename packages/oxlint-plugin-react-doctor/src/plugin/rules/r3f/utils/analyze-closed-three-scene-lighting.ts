import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../../utils/is-nullish-expression.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { THREE_LIGHT_CONSTRUCTOR_NAMES, THREE_MESH_MATERIAL_ARGUMENT_INDEX } from "../constants.js";
import type { StaticThreePbrMaterialLighting } from "./get-static-three-pbr-material-lighting.js";
import { getStaticThreePbrMaterialLighting } from "./get-static-three-pbr-material-lighting.js";
import { getStaticThreeLightIntensity } from "./get-static-three-light-intensity.js";
import { resolveThreeConstructor } from "./resolve-three-constructor.js";

export interface ClosedThreeSceneLighting {
  hasEnvironment: boolean;
  hasLight: boolean;
  isComplete: boolean;
  materials: ReadonlyArray<StaticThreePbrMaterialLighting>;
}

const THREE_RENDERER_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "WebGLRenderer",
  "WebGPURenderer",
]);

export const isThreeSceneRenderCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean =>
  isNodeOfType(node.callee, "MemberExpression") &&
  getStaticPropertyName(node.callee) === "render" &&
  THREE_RENDERER_CONSTRUCTOR_NAMES.has(
    resolveThreeConstructor(node.callee.object, context.scopes)?.constructorName ?? "",
  );

export const analyzeClosedThreeSceneLighting = (
  sceneExpression: EsTreeNode,
  renderCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): ClosedThreeSceneLighting | null => {
  if (resolveThreeConstructor(sceneExpression, context.scopes)?.constructorName !== "Scene") {
    return null;
  }
  const sceneKey = resolveExpressionKey(sceneExpression, context);
  const program = findProgramRoot(sceneExpression);
  if (!sceneKey || !program) return null;
  const materials: StaticThreePbrMaterialLighting[] = [];
  let hasEnvironment = false;
  let hasLight = false;
  let isComplete = true;
  walkAst(program, (node) => {
    if (!isComplete) return;
    if (isNodeOfType(node, "AssignmentExpression") && node.operator === "=") {
      const target = stripParenExpression(node.left);
      if (
        isNodeOfType(target, "MemberExpression") &&
        resolveExpressionKey(target.object, context) === sceneKey &&
        getStaticPropertyName(target) === "environment"
      ) {
        if (!nodeDominatesNode(node, renderCall, context)) {
          isComplete = false;
          return;
        }
        hasEnvironment = !isNullishExpression(node.right);
      }
      return;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    if (node === renderCall) return;
    if (isNodeOfType(node.callee, "MemberExpression")) {
      const receiverKey = resolveExpressionKey(node.callee.object, context);
      if (receiverKey === sceneKey) {
        if (getStaticPropertyName(node.callee) !== "add") {
          isComplete = false;
          return;
        }
        if (!nodeDominatesNode(node, renderCall, context)) {
          isComplete = false;
          return;
        }
        for (const argument of node.arguments) {
          if (isNodeOfType(argument, "SpreadElement")) {
            isComplete = false;
            return;
          }
          const constructor = resolveThreeConstructor(argument, context.scopes);
          if (!constructor) {
            isComplete = false;
            return;
          }
          if (THREE_LIGHT_CONSTRUCTOR_NAMES.has(constructor.constructorName)) {
            const light = getStaticThreeLightIntensity(argument, node, renderCall, context);
            if (!light?.isComplete) {
              isComplete = false;
              return;
            }
            if (light.intensity > 0) hasLight = true;
            continue;
          }
          if (constructor.constructorName === "Mesh") {
            if (stripParenExpression(argument) !== constructor.node) {
              isComplete = false;
              return;
            }
            const materialExpression =
              constructor.node.arguments[THREE_MESH_MATERIAL_ARGUMENT_INDEX];
            if (!materialExpression || isNodeOfType(materialExpression, "SpreadElement")) continue;
            const material = getStaticThreePbrMaterialLighting(
              materialExpression,
              renderCall,
              context,
            );
            if (material && (!material.isComplete || material.isVisible)) materials.push(material);
            continue;
          }
          if (!constructor.constructorName.endsWith("Camera")) {
            isComplete = false;
            return;
          }
        }
        return;
      }
    }
    for (const argument of node.arguments) {
      if (
        !isNodeOfType(argument, "SpreadElement") &&
        resolveExpressionKey(argument, context) === sceneKey
      ) {
        isComplete = false;
        return;
      }
    }
  });
  if (materials.some((material) => !material.isComplete)) isComplete = false;
  return { hasEnvironment, hasLight, isComplete, materials };
};
