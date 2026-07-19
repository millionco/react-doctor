import { defineRule } from "../../utils/define-rule.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { resolveR3fJsxEventHandler } from "./utils/resolve-r3f-jsx-event-handler.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const R3F_POINTER_EVENT_NAMES: ReadonlySet<string> = new Set([
  "onClick",
  "onContextMenu",
  "onDoubleClick",
  "onPointerCancel",
  "onPointerDown",
  "onPointerEnter",
  "onPointerLeave",
  "onPointerMove",
  "onPointerOut",
  "onPointerOver",
  "onPointerUp",
  "onWheel",
]);

const MUTATING_VECTOR_METHOD_NAMES: ReadonlySet<string> = new Set([
  "add",
  "addScalar",
  "addScaledVector",
  "addVectors",
  "applyAxisAngle",
  "applyEuler",
  "applyMatrix3",
  "applyMatrix4",
  "applyNormalMatrix",
  "applyQuaternion",
  "ceil",
  "clamp",
  "clampLength",
  "clampScalar",
  "copy",
  "cross",
  "crossVectors",
  "divide",
  "divideScalar",
  "floor",
  "fromArray",
  "lerp",
  "lerpVectors",
  "max",
  "min",
  "multiply",
  "multiplyScalar",
  "multiplyVectors",
  "negate",
  "normalize",
  "project",
  "projectOnPlane",
  "projectOnVector",
  "random",
  "randomDirection",
  "reflect",
  "round",
  "roundToZero",
  "set",
  "setFromColor",
  "setFromCylindrical",
  "setFromCylindricalCoords",
  "setFromEuler",
  "setFromMatrix3Column",
  "setFromMatrixColumn",
  "setFromMatrixPosition",
  "setFromMatrixScale",
  "setFromSpherical",
  "setFromSphericalCoords",
  "setLength",
  "setScalar",
  "setX",
  "setY",
  "setZ",
  "sub",
  "subScalar",
  "subVectors",
  "transformDirection",
  "unproject",
]);

const MUTATING_VECTOR_ARGUMENT_METHOD_NAMES: ReadonlySet<string> = new Set([
  "localToWorld",
  "worldToLocal",
]);
const SHARED_POINTER_EVENT_VECTOR_NAMES: ReadonlySet<string> = new Set([
  "normal",
  "point",
  "ray",
  "uv",
]);

const isSharedPointerEventVectorOrDescendant = (
  expression: EsTreeNode,
  handler: EsTreeNode,
  context: RuleContext,
): boolean => {
  let candidate = stripParenExpression(expression);
  while (true) {
    for (const propertyName of SHARED_POINTER_EVENT_VECTOR_NAMES) {
      if (isR3fCallbackStateProperty(candidate, handler, propertyName, context.scopes)) {
        return true;
      }
    }
    if (!isNodeOfType(candidate, "MemberExpression")) return false;
    candidate = stripParenExpression(candidate.object);
  }
};

const getMutatedEventPoint = (
  candidate: EsTreeNode,
  handler: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  if (isNodeOfType(candidate, "AssignmentExpression")) {
    return isSharedPointerEventVectorOrDescendant(candidate.left, handler, context)
      ? candidate.left
      : null;
  }
  if (isNodeOfType(candidate, "UpdateExpression")) {
    return isSharedPointerEventVectorOrDescendant(candidate.argument, handler, context)
      ? candidate.argument
      : null;
  }
  if (!isNodeOfType(candidate, "CallExpression")) return null;
  const callee = stripParenExpression(candidate.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(callee);
  if (
    methodName &&
    MUTATING_VECTOR_METHOD_NAMES.has(methodName) &&
    isSharedPointerEventVectorOrDescendant(callee.object, handler, context)
  ) {
    return callee.object;
  }
  if (!methodName || !MUTATING_VECTOR_ARGUMENT_METHOD_NAMES.has(methodName)) return null;
  const pointArgument = candidate.arguments.find(
    (argument) =>
      !isNodeOfType(argument, "SpreadElement") &&
      isSharedPointerEventVectorOrDescendant(argument, handler, context),
  );
  return pointArgument && !isNodeOfType(pointArgument, "SpreadElement") ? pointArgument : null;
};

export const r3fNoMutatingPointerEventData = defineRule({
  id: "r3f-no-mutating-pointer-event-data",
  title: "Mutation of shared R3F pointer-event data",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Copy shared pointer-event vectors before applying local-space transforms or other mutations",
  create: (context: RuleContext) => {
    const reportedNodes = new WeakSet<EsTreeNode>();
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!importsReactThreeFiber) return;
        for (const eventName of R3F_POINTER_EVENT_NAMES) {
          const handler = resolveR3fJsxEventHandler(node, eventName, context);
          if (!handler) continue;
          walkFunctionExecution(handler, context.scopes, (candidate) => {
            const mutatedPoint = getMutatedEventPoint(candidate, handler, context);
            if (!mutatedPoint || reportedNodes.has(candidate)) return;
            reportedNodes.add(candidate);
            context.report({
              node: mutatedPoint,
              message:
                "This mutates pointer-event hit data supplied by R3F. Copy it into an owned vector or ray before changing it",
            });
          });
        }
      },
    };
  },
});
