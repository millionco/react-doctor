import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { collectExpressionPathCoverageNodes } from "../../utils/collect-expression-path-coverage-nodes.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getRootIdentifier } from "../../utils/get-root-identifier.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";

interface ProjectionMutation {
  node: EsTreeNode;
  receiver: EsTreeNode;
  receiverKey: string;
}

interface ReceiverCall {
  node: EsTreeNodeOfType<"CallExpression">;
  receiverKey: string;
}

const CAMERA_HOST_NAMES: ReadonlySet<string> = new Set(["orthographicCamera", "perspectiveCamera"]);

const PROJECTION_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "aspect",
  "bottom",
  "far",
  "fov",
  "left",
  "near",
  "right",
  "top",
  "zoom",
]);

const hasStableRootBinding = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const rootIdentifier = getRootIdentifier(expression);
  const symbol = rootIdentifier ? scopes.symbolFor(rootIdentifier) : null;
  return Boolean(!symbol || symbol.references.every((reference) => reference.flag === "read"));
};

const useThreeSelectsCamera = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (!isR3fApiCall(callExpression, "useThree", context.scopes)) return false;
  const selectorExpression = callExpression.arguments[0];
  if (!selectorExpression || isNodeOfType(selectorExpression, "SpreadElement")) return false;
  const selector = resolveLocalReactCallback(selectorExpression, context.scopes);
  return Boolean(
    selector &&
    functionReturnsMatchingExpression(
      selector,
      context.scopes,
      (returnedExpression) =>
        isR3fCallbackStateProperty(returnedExpression, selector, "camera", context.scopes),
      context.cfg,
    ),
  );
};

const isWholeUseThreeState = (expression: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(expression);
  return Boolean(
    isNodeOfType(candidate, "CallExpression") &&
    candidate.arguments.length === 0 &&
    isR3fApiCall(candidate, "useThree", context.scopes),
  );
};

const hasWholeUseThreeStateProvenance = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isWholeUseThreeState(candidate, context)) return true;
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read") ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return hasWholeUseThreeStateProvenance(symbol.initializer, context, visitedSymbolIds);
};

const hasUseThreeCameraProvenance = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    isNodeOfType(candidate, "MemberExpression") &&
    getStaticPropertyName(candidate) === "camera" &&
    hasWholeUseThreeStateProvenance(candidate.object, context)
  ) {
    return true;
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(candidate);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  const initializer = stripParenExpression(symbol.initializer);
  if (isNodeOfType(initializer, "CallExpression") && useThreeSelectsCamera(initializer, context)) {
    return true;
  }
  if (
    getDestructuredBindingPropertyName(symbol.bindingIdentifier) === "camera" &&
    isWholeUseThreeState(initializer, context)
  ) {
    return true;
  }
  if (
    isNodeOfType(initializer, "MemberExpression") &&
    getStaticPropertyName(initializer) === "camera" &&
    hasWholeUseThreeStateProvenance(initializer.object, context)
  ) {
    return true;
  }
  if (
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  return hasUseThreeCameraProvenance(initializer, context, visitedSymbolIds);
};

const hasFrameCameraProvenance = (
  expression: EsTreeNode,
  frameCallbacks: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean =>
  [...frameCallbacks].some(
    (callback) =>
      isFunctionLike(callback) &&
      isR3fCallbackStateProperty(expression, callback, "camera", context.scopes),
  );

const hasManagedCameraRefProvenance = (
  expression: EsTreeNode,
  managedCameraRefSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean => {
  const refSymbol = resolveReactRefSymbol(stripParenExpression(expression), context.scopes, {
    includeCreateRef: true,
    resolveNamedAliases: true,
  });
  return Boolean(refSymbol && managedCameraRefSymbolIds.has(refSymbol.id));
};

const hasR3fCameraProvenance = (
  expression: EsTreeNode,
  frameCallbacks: ReadonlySet<EsTreeNode>,
  managedCameraRefSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean =>
  hasStableRootBinding(expression, context.scopes) &&
  (hasUseThreeCameraProvenance(expression, context) ||
    hasFrameCameraProvenance(expression, frameCallbacks, context) ||
    hasManagedCameraRefProvenance(expression, managedCameraRefSymbolIds, context));

const getProjectionMutationReceiver = (node: EsTreeNode): EsTreeNode | null => {
  const mutationTarget = isNodeOfType(node, "AssignmentExpression")
    ? stripParenExpression(node.left)
    : isNodeOfType(node, "UpdateExpression")
      ? stripParenExpression(node.argument)
      : null;
  return mutationTarget &&
    isNodeOfType(mutationTarget, "MemberExpression") &&
    PROJECTION_PROPERTY_NAMES.has(getStaticPropertyName(mutationTarget) ?? "")
    ? mutationTarget.object
    : null;
};

const getUpdateProjectionMatrixReceiver = (
  node: EsTreeNodeOfType<"CallExpression">,
): EsTreeNode | null => {
  const callee = stripParenExpression(node.callee);
  return isNodeOfType(callee, "MemberExpression") &&
    getStaticPropertyName(callee) === "updateProjectionMatrix"
    ? callee.object
    : null;
};

const canNodeReachLaterNodeWithinFunction = (
  sourceNode: EsTreeNode,
  targetNode: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean | null => {
  const functionCfg = context.cfg.cfgFor(owner);
  const sourceBlock = functionCfg?.blockOf(sourceNode);
  const targetBlock = functionCfg?.blockOf(targetNode);
  const sourceStart = getRangeStart(sourceNode);
  const targetStart = getRangeStart(targetNode);
  if (
    !functionCfg ||
    !sourceBlock ||
    !targetBlock ||
    sourceStart === null ||
    targetStart === null
  ) {
    return null;
  }
  if (sourceBlock === targetBlock) return sourceStart < targetStart;
  const visitedBlocks = new Set([sourceBlock]);
  const pendingBlocks = [sourceBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    for (const edge of currentBlock.successors) {
      if (edge.to === targetBlock) return true;
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return false;
};

const collectExpressionRestrictions = (
  node: EsTreeNode,
  owner: EsTreeNode,
): Map<EsTreeNode, "alternate" | "consequent" | "right"> => {
  const restrictions = new Map<EsTreeNode, "alternate" | "consequent" | "right">();
  let child = node;
  let parent = child.parent ?? null;
  while (parent && parent !== owner) {
    if (isNodeOfType(parent, "ConditionalExpression")) {
      if (parent.consequent === child) restrictions.set(parent, "consequent");
      if (parent.alternate === child) restrictions.set(parent, "alternate");
    } else if (
      (isNodeOfType(parent, "LogicalExpression") || isNodeOfType(parent, "AssignmentPattern")) &&
      parent.right === child
    ) {
      restrictions.set(parent, "right");
    }
    child = parent;
    parent = child.parent ?? null;
  }
  return restrictions;
};

const doesUpdateShareMutationExpressionRestrictions = (
  mutationNode: EsTreeNode,
  updateNode: EsTreeNode,
  owner: EsTreeNode,
): boolean => {
  const mutationRestrictions = collectExpressionRestrictions(mutationNode, owner);
  const updateRestrictions = collectExpressionRestrictions(updateNode, owner);
  return [...updateRestrictions].every(
    ([conditionalExpression, branch]) => mutationRestrictions.get(conditionalExpression) === branch,
  );
};

const doUpdatesCoverEveryPathAfterMutation = (
  mutation: ProjectionMutation,
  updateCalls: ReadonlyArray<ReceiverCall>,
  context: RuleContext,
): boolean | null => {
  const owner = context.cfg.enclosingFunction(mutation.node);
  if (!owner) return null;
  const functionCfg = context.cfg.cfgFor(owner);
  const mutationBlock = functionCfg?.blockOf(mutation.node);
  const mutationStart = getRangeStart(mutation.node);
  if (!functionCfg || !mutationBlock || mutationStart === null) return null;
  const matchingUpdateNodes = updateCalls.flatMap((updateCall) =>
    updateCall.receiverKey === mutation.receiverKey &&
    context.cfg.enclosingFunction(updateCall.node) === owner
      ? [updateCall.node]
      : [],
  );
  const expressionCoverageNodes = collectExpressionPathCoverageNodes(
    owner,
    matchingUpdateNodes,
    context,
  );
  for (const updateNode of matchingUpdateNodes) {
    if (doesUpdateShareMutationExpressionRestrictions(mutation.node, updateNode, owner)) {
      expressionCoverageNodes.add(updateNode);
    }
  }
  const matchingBlocks = new Set(
    [...expressionCoverageNodes].flatMap((updateNode) => {
      const updateBlock = functionCfg.blockOf(updateNode);
      const updateStart = getRangeStart(updateNode);
      if (!updateBlock || updateStart === null) return [];
      if (updateBlock === mutationBlock && updateStart < mutationStart) return [];
      return [updateBlock];
    }),
  );
  if (matchingBlocks.has(mutationBlock)) return true;
  const visitedBlocks = new Set([mutationBlock]);
  const pendingBlocks = [mutationBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    for (const edge of currentBlock.successors) {
      if (edge.kind === "throw" || matchingBlocks.has(edge.to)) continue;
      if (edge.to === functionCfg.exit) return false;
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return matchingBlocks.size > 0;
};

const hasLaterOpaqueReceiverCall = (
  mutation: ProjectionMutation,
  opaqueCalls: ReadonlyArray<ReceiverCall>,
  context: RuleContext,
): boolean => {
  const owner = context.cfg.enclosingFunction(mutation.node);
  if (!owner) return true;
  return opaqueCalls.some((opaqueCall) => {
    if (
      opaqueCall.receiverKey !== mutation.receiverKey ||
      context.cfg.enclosingFunction(opaqueCall.node) !== owner
    ) {
      return false;
    }
    return (
      canNodeReachLaterNodeWithinFunction(mutation.node, opaqueCall.node, owner, context) !== false
    );
  });
};

export const r3fRequireProjectionMatrixUpdate = defineRule({
  id: "r3f-require-projection-matrix-update",
  title: "Missing camera projection-matrix update",
  category: "Correctness",
  requires: ["r3f:3"],
  severity: "error",
  recommendation:
    "Call camera.updateProjectionMatrix() after imperatively changing projection properties so Three.js renders the new frustum",
  create: (context: RuleContext) => {
    const managedCameraRefSymbolIds = new Set<number>();
    const frameCallbacks = new Set<EsTreeNode>();
    const projectionMutations: ProjectionMutation[] = [];
    const updateCalls: ReceiverCall[] = [];
    const opaqueCalls: ReceiverCall[] = [];
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
          !CAMERA_HOST_NAMES.has(node.name.name)
        ) {
          return;
        }
        const refAttribute = getAuthoritativeJsxAttribute(node.attributes, "ref");
        if (
          !refAttribute?.value ||
          !isNodeOfType(refAttribute.value, "JSXExpressionContainer") ||
          isNodeOfType(refAttribute.value.expression, "JSXEmptyExpression")
        ) {
          return;
        }
        const refExpression = stripParenExpression(refAttribute.value.expression);
        const refSymbol = isNodeOfType(refExpression, "Identifier")
          ? resolveConstIdentifierAlias(refExpression, context.scopes)
          : null;
        if (refSymbol) managedCameraRefSymbolIds.add(refSymbol.id);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const frameCallback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (frameCallback) frameCallbacks.add(frameCallback);
        const updateReceiver = getUpdateProjectionMatrixReceiver(node);
        const updateReceiverKey = updateReceiver
          ? resolveExpressionKey(updateReceiver, context)
          : null;
        if (updateReceiverKey) {
          updateCalls.push({ node, receiverKey: updateReceiverKey });
          return;
        }
        const callee = stripParenExpression(node.callee);
        if (isNodeOfType(callee, "MemberExpression")) {
          const receiverKey = resolveExpressionKey(callee.object, context);
          if (receiverKey) opaqueCalls.push({ node, receiverKey });
        }
        for (const argument of node.arguments) {
          if (isNodeOfType(argument, "SpreadElement")) continue;
          const argumentKey = resolveExpressionKey(argument, context);
          if (argumentKey) opaqueCalls.push({ node, receiverKey: argumentKey });
        }
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        const receiver = getProjectionMutationReceiver(node);
        const receiverKey = receiver ? resolveExpressionKey(receiver, context) : null;
        if (receiver && receiverKey) projectionMutations.push({ node, receiver, receiverKey });
      },
      UpdateExpression(node: EsTreeNodeOfType<"UpdateExpression">) {
        const receiver = getProjectionMutationReceiver(node);
        const receiverKey = receiver ? resolveExpressionKey(receiver, context) : null;
        if (receiver && receiverKey) projectionMutations.push({ node, receiver, receiverKey });
      },
      "Program:exit"() {
        if (!importsReactThreeFiber) return;
        for (const mutation of projectionMutations) {
          if (
            !hasR3fCameraProvenance(
              mutation.receiver,
              frameCallbacks,
              managedCameraRefSymbolIds,
              context,
            ) ||
            hasLaterOpaqueReceiverCall(mutation, opaqueCalls, context) ||
            doUpdatesCoverEveryPathAfterMutation(mutation, updateCalls, context) !== false
          ) {
            continue;
          }
          context.report({
            node: mutation.node,
            message:
              "This camera projection property changes without a later updateProjectionMatrix() call on every path, so Three.js can keep rendering the stale projection matrix",
          });
        }
      },
    };
  },
});
