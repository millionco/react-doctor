import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isImportedOrStableParameterCall } from "../../utils/is-imported-or-stable-parameter-call.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSynchronousIteratorCallback } from "../../utils/is-synchronous-iterator-callback.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";

interface InstancedBufferMutation {
  readonly bufferPropertyName: "instanceColor" | "instanceMatrix";
  readonly methodName: "setColorAt" | "setMatrixAt";
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly refSymbolId: number;
}

interface InstancedBufferCompletion {
  readonly bufferPropertyName: "instanceColor" | "instanceMatrix";
  readonly node: EsTreeNode;
  readonly refSymbolId: number;
}

const resolveStableRefSymbol = (
  identifier: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (!isNodeOfType(identifier, "Identifier") && !isNodeOfType(identifier, "JSXIdentifier")) {
    return null;
  }
  const symbol = resolveConstIdentifierAlias(identifier, context.scopes);
  return symbol &&
    (symbol.kind === "const" || symbol.kind === "parameter") &&
    symbol.references.every((reference) => reference.flag === "read")
    ? symbol
    : null;
};

const resolveCurrentRefSymbol = (
  expression: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  const candidate = stripParenExpression(expression);
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    getStaticPropertyName(candidate) !== "current"
  ) {
    return null;
  }
  return resolveStableRefSymbol(stripParenExpression(candidate.object), context);
};

const isDirectExecutionRoot = (current: EsTreeNode): boolean => {
  if (isNodeOfType(current.parent, "ExpressionStatement")) {
    return current.parent.expression === current;
  }
  if (isNodeOfType(current.parent, "ReturnStatement")) {
    return current.parent.argument === current;
  }
  return Boolean(isFunctionLike(current.parent) && current.parent.body === current);
};

const isDirectExecutedCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  let current = findTransparentExpressionRoot(node);
  const parent = current.parent;
  if (
    parent &&
    ((isNodeOfType(parent, "AwaitExpression") && parent.argument === current) ||
      (isNodeOfType(parent, "UnaryExpression") &&
        parent.operator === "void" &&
        parent.argument === current))
  ) {
    current = findTransparentExpressionRoot(parent);
  }
  return isDirectExecutionRoot(current);
};

const getMutation = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): InstancedBufferMutation | null => {
  if (!isDirectExecutedCall(node)) return null;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(callee);
  if (methodName !== "setMatrixAt" && methodName !== "setColorAt") return null;
  const bufferPropertyName = methodName === "setMatrixAt" ? "instanceMatrix" : "instanceColor";
  const refSymbol = resolveCurrentRefSymbol(callee.object, context);
  if (!refSymbol) return null;
  return {
    bufferPropertyName,
    methodName,
    node,
    refSymbolId: refSymbol.id,
  };
};

const getBufferUpdate = (
  node: EsTreeNodeOfType<"AssignmentExpression">,
  context: RuleContext,
): InstancedBufferCompletion | null => {
  const assignmentRoot = findTransparentExpressionRoot(node);
  const assignedValue = stripParenExpression(node.right);
  if (
    node.operator !== "=" ||
    !isNodeOfType(assignedValue, "Literal") ||
    assignedValue.value !== true ||
    !isDirectExecutionRoot(assignmentRoot)
  ) {
    return null;
  }
  const needsUpdateMember = stripParenExpression(node.left);
  if (
    !isNodeOfType(needsUpdateMember, "MemberExpression") ||
    getStaticPropertyName(needsUpdateMember) !== "needsUpdate"
  ) {
    return null;
  }
  const bufferMember = stripParenExpression(needsUpdateMember.object);
  if (!isNodeOfType(bufferMember, "MemberExpression")) return null;
  const bufferPropertyName = getStaticPropertyName(bufferMember);
  if (bufferPropertyName !== "instanceMatrix" && bufferPropertyName !== "instanceColor") {
    return null;
  }
  const refSymbol = resolveCurrentRefSymbol(bufferMember.object, context);
  return refSymbol
    ? {
        bufferPropertyName,
        node,
        refSymbolId: refSymbol.id,
      }
    : null;
};

const getOpaqueRefTransfer = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): ReadonlyArray<InstancedBufferCompletion> => {
  if (!isDirectExecutedCall(node)) return [];
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "MemberExpression")) {
    const methodName = getStaticPropertyName(callee);
    if (methodName === "setMatrixAt" || methodName === "setColorAt") return [];
  }
  if (!isImportedOrStableParameterCall(node, context.scopes)) return [];
  const completions: InstancedBufferCompletion[] = [];
  for (const argument of node.arguments) {
    if (isNodeOfType(argument, "SpreadElement")) continue;
    const candidate = stripParenExpression(argument);
    if (isNodeOfType(candidate, "MemberExpression")) {
      const bufferPropertyName = getStaticPropertyName(candidate);
      if (bufferPropertyName === "instanceMatrix" || bufferPropertyName === "instanceColor") {
        const refSymbol = resolveCurrentRefSymbol(candidate.object, context);
        if (refSymbol) completions.push({ bufferPropertyName, node, refSymbolId: refSymbol.id });
        continue;
      }
    }
    const refSymbol = isNodeOfType(candidate, "Identifier")
      ? resolveStableRefSymbol(candidate, context)
      : resolveCurrentRefSymbol(candidate, context);
    if (!refSymbol) continue;
    completions.push({ bufferPropertyName: "instanceMatrix", node, refSymbolId: refSymbol.id });
    completions.push({ bufferPropertyName: "instanceColor", node, refSymbolId: refSymbol.id });
  }
  return completions;
};

const expressionMatchesCompletionBuffer = (
  expression: EsTreeNode,
  completion: InstancedBufferCompletion,
  context: RuleContext,
): boolean => {
  const bufferMember = stripParenExpression(expression);
  if (
    !isNodeOfType(bufferMember, "MemberExpression") ||
    getStaticPropertyName(bufferMember) !== completion.bufferPropertyName
  ) {
    return false;
  }
  return resolveCurrentRefSymbol(bufferMember.object, context)?.id === completion.refSymbolId;
};

const isCompletionGuardedByMatchingBuffer = (
  completion: InstancedBufferCompletion,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  let currentChild = completion.node;
  let currentAncestor = completion.node.parent;
  while (currentAncestor && currentAncestor !== owner) {
    if (
      isNodeOfType(currentAncestor, "IfStatement") &&
      currentAncestor.consequent === currentChild &&
      !isNodeConditionallyExecuted(completion.node, currentAncestor.consequent) &&
      expressionMatchesCompletionBuffer(currentAncestor.test, completion, context)
    ) {
      return true;
    }
    if (
      isNodeOfType(currentAncestor, "ConditionalExpression") &&
      currentAncestor.consequent === currentChild &&
      expressionMatchesCompletionBuffer(currentAncestor.test, completion, context)
    ) {
      return true;
    }
    if (
      isNodeOfType(currentAncestor, "LogicalExpression") &&
      currentAncestor.operator === "&&" &&
      currentAncestor.right === currentChild &&
      expressionMatchesCompletionBuffer(currentAncestor.left, completion, context)
    ) {
      return true;
    }
    currentChild = currentAncestor;
    currentAncestor = currentAncestor.parent;
  }
  return false;
};

const completionsCoverEveryPathWithinOwner = (
  pathAnchor: EsTreeNode,
  owner: EsTreeNode,
  completions: ReadonlyArray<InstancedBufferCompletion>,
  context: RuleContext,
): boolean => {
  const functionCfg = context.cfg.cfgFor(owner);
  const mutationBlock = functionCfg?.blockOf(pathAnchor);
  const mutationStart = getRangeStart(pathAnchor);
  if (!functionCfg || !mutationBlock || mutationStart === null) return true;
  if (
    completions.some((completion) => {
      const completionStart = getRangeStart(completion.node);
      return (
        completionStart !== null &&
        completionStart > mutationStart &&
        isCompletionGuardedByMatchingBuffer(completion, owner, context)
      );
    })
  ) {
    return true;
  }
  const matchingBlocks = new Set(
    completions.flatMap((completion) => {
      const completionBlock = functionCfg.blockOf(completion.node);
      const completionStart = getRangeStart(completion.node);
      if (!completionBlock || completionStart === null) return [];
      if (completionBlock === mutationBlock && completionStart < mutationStart) return [];
      return [completionBlock];
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

const completionsCoverEveryPathAfterMutation = (
  mutation: InstancedBufferMutation,
  completions: ReadonlyArray<InstancedBufferCompletion>,
  context: RuleContext,
): boolean => {
  let pathAnchor: EsTreeNode = mutation.node;
  let owner = context.cfg.enclosingFunction(pathAnchor);
  while (owner) {
    const matchingCompletions = completions.filter(
      (completion) =>
        completion.refSymbolId === mutation.refSymbolId &&
        completion.bufferPropertyName === mutation.bufferPropertyName &&
        context.cfg.enclosingFunction(completion.node) === owner,
    );
    if (completionsCoverEveryPathWithinOwner(pathAnchor, owner, matchingCompletions, context)) {
      return true;
    }
    if (
      !isFunctionLike(owner) ||
      owner.async ||
      owner.generator ||
      !isSynchronousIteratorCallback(owner)
    ) {
      return false;
    }
    const iteratorCall = owner.parent;
    if (!isNodeOfType(iteratorCall, "CallExpression")) return false;
    pathAnchor = iteratorCall;
    owner = context.cfg.enclosingFunction(pathAnchor);
  }
  return true;
};

export const r3fRequireInstancedBufferUpdate = defineRule({
  id: "r3f-require-instanced-buffer-update",
  title: "Instanced mesh buffer is not marked for upload",
  category: "Correctness",
  severity: "error",
  recommendation:
    "After setMatrixAt or setColorAt, set the matching instance buffer's needsUpdate flag to true",
  create: (context: RuleContext) => {
    const managedRefSymbolIds = new Set<number>();
    const mutations: InstancedBufferMutation[] = [];
    const completions: InstancedBufferCompletion[] = [];
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          !isR3fHostIntrinsic(node) ||
          resolveJsxElementType(node) !== "instancedMesh"
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
        const refSymbol = resolveStableRefSymbol(
          stripParenExpression(refAttribute.value.expression),
          context,
        );
        if (refSymbol) managedRefSymbolIds.add(refSymbol.id);
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (!importsReactThreeFiber) return;
        const completion = getBufferUpdate(node, context);
        if (completion) completions.push(completion);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!importsReactThreeFiber) return;
        const mutation = getMutation(node, context);
        if (mutation) {
          mutations.push(mutation);
          return;
        }
        completions.push(...getOpaqueRefTransfer(node, context));
      },
      "Program:exit"() {
        for (const mutation of mutations) {
          if (
            !managedRefSymbolIds.has(mutation.refSymbolId) ||
            completionsCoverEveryPathAfterMutation(mutation, completions, context)
          ) {
            continue;
          }
          context.report({
            node: mutation.node,
            message: `After ${mutation.methodName}, set ${mutation.bufferPropertyName}.needsUpdate to true so Three.js uploads the changed instance data`,
          });
        }
      },
    };
  },
});
