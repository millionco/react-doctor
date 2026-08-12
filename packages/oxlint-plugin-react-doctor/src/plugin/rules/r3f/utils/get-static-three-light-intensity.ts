import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  DEFAULT_THREE_LIGHT_INTENSITY,
  THREE_LIGHT_INTENSITY_ARGUMENT_INDEX_BY_CONSTRUCTOR,
} from "../constants.js";
import { getStaticNumber } from "./get-static-number.js";
import { resolveThreeConstructor } from "./resolve-three-constructor.js";

export interface StaticThreeLightIntensity {
  intensity: number;
  isComplete: boolean;
}

export const getStaticThreeLightIntensity = (
  expression: EsTreeNode,
  sceneAddCall: EsTreeNodeOfType<"CallExpression">,
  renderCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): StaticThreeLightIntensity | null => {
  const constructor = resolveThreeConstructor(expression, context.scopes);
  const intensityArgumentIndex = constructor
    ? THREE_LIGHT_INTENSITY_ARGUMENT_INDEX_BY_CONSTRUCTOR.get(constructor.constructorName)
    : undefined;
  if (!constructor || intensityArgumentIndex === undefined) return null;
  const intensityArgument = constructor.node.arguments[intensityArgumentIndex];
  let intensity = DEFAULT_THREE_LIGHT_INTENSITY;
  let isComplete = true;
  if (
    constructor.node.arguments
      .slice(0, intensityArgumentIndex + 1)
      .some((argument) => isNodeOfType(argument, "SpreadElement"))
  ) {
    isComplete = false;
  } else if (intensityArgument) {
    const staticIntensity = getStaticNumber(intensityArgument, context.scopes);
    if (staticIntensity === null) isComplete = false;
    else intensity = staticIntensity;
  }
  const lightKey = resolveExpressionKey(expression, context);
  if (!lightKey) {
    return {
      intensity,
      isComplete: isComplete && stripParenExpression(expression) === constructor.node,
    };
  }
  const program = findProgramRoot(expression);
  if (!program) return null;
  walkAst(program, (node) => {
    if (!isComplete) return;
    if (isNodeOfType(node, "CallExpression")) {
      if (node === sceneAddCall) return;
      const receiverKey = isNodeOfType(node.callee, "MemberExpression")
        ? resolveExpressionKey(node.callee.object, context)
        : null;
      const touchesLight =
        receiverKey === lightKey ||
        node.arguments.some(
          (argument) =>
            !isNodeOfType(argument, "SpreadElement") &&
            resolveExpressionKey(argument, context) === lightKey,
        );
      if (touchesLight) isComplete = false;
      return;
    }
    if (!isNodeOfType(node, "AssignmentExpression") || node.operator !== "=") return;
    const target = stripParenExpression(node.left);
    if (isNodeOfType(target, "Identifier") && resolveExpressionKey(target, context) === lightKey) {
      isComplete = false;
      return;
    }
    if (
      !isNodeOfType(target, "MemberExpression") ||
      resolveExpressionKey(target.object, context) !== lightKey ||
      getStaticPropertyName(target) !== "intensity"
    ) {
      return;
    }
    if (!nodeDominatesNode(node, renderCall, context)) {
      isComplete = false;
      return;
    }
    const staticIntensity = getStaticNumber(node.right, context.scopes);
    if (staticIntensity === null) isComplete = false;
    else intensity = staticIntensity;
  });
  return { intensity, isComplete };
};
