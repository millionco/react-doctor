import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { collectEffectInvokedFunctions } from "../../utils/collect-effect-invoked-functions.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { resolveTanstackQueryHookNameFromInitializer } from "./utils/resolve-tanstack-query-hook-name.js";

const isTanstackQueryResult = (expression: EsTreeNode, context: RuleContext): boolean =>
  Boolean(resolveTanstackQueryHookNameFromInitializer(expression, context.scopes));

const isStaticRefetchMember = (memberExpression: EsTreeNodeOfType<"MemberExpression">): boolean =>
  getStaticPropertyKeyName(memberExpression, { allowComputedString: true }) === "refetch";

const resolveCalledFunction = (callee: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  const unwrappedCallee = stripParenExpression(callee);
  if (isFunctionLike(unwrappedCallee)) return unwrappedCallee;
  if (!isNodeOfType(unwrappedCallee, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(unwrappedCallee, context.scopes);
  if (!symbol) return null;
  const candidate = symbol.kind === "function" ? symbol.declarationNode : symbol.initializer;
  return candidate && isFunctionLike(candidate) ? candidate : null;
};

const hasSuspensionBefore = (
  functionNode: EsTreeNode,
  boundary: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(functionNode)) return true;
  if (functionNode.generator) return true;
  const boundaryStart = getRangeStart(boundary);
  if (boundaryStart === null) return true;
  let hasSuspension = false;
  walkAst(functionNode, (node) => {
    if (node !== functionNode && isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "AwaitExpression") || !isNodeReachableWithinFunction(node, context)) {
      return;
    }
    const suspensionStart = getRangeStart(node);
    if (suspensionStart !== null && suspensionStart < boundaryStart) {
      hasSuspension = true;
      return false;
    }
  });
  return hasSuspension;
};

const isFunctionAncestor = (ancestor: EsTreeNode, functionNode: EsTreeNode): boolean => {
  let enclosingFunction = findEnclosingFunction(functionNode);
  while (enclosingFunction) {
    if (enclosingFunction === ancestor) return true;
    enclosingFunction = findEnclosingFunction(enclosingFunction);
  }
  return false;
};

const isUnconditionallyExecuted = (
  node: EsTreeNode,
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean =>
  context.cfg.isUnconditionalFromEntry(node) &&
  !isNodeConditionallyExecuted(node, functionNode) &&
  !(
    isNodeOfType(node, "MemberExpression") &&
    isNodeOfType(node.parent, "AssignmentExpression") &&
    node.parent.left === node &&
    (node.parent.operator === "&&=" ||
      node.parent.operator === "||=" ||
      node.parent.operator === "??=")
  );

const functionInvokesTarget = (
  callerFunction: EsTreeNode,
  targetFunction: EsTreeNode,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode>,
  canCrossSuspension = false,
): boolean => {
  if (visitedFunctions.has(callerFunction)) return false;
  visitedFunctions.add(callerFunction);
  let invokesTarget = false;
  walkAst(callerFunction, (node) => {
    if (node !== callerFunction && isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    if (
      !isNodeReachableWithinFunction(node, context) ||
      !isUnconditionallyExecuted(node, callerFunction, context) ||
      (!canCrossSuspension && hasSuspensionBefore(callerFunction, node, context))
    ) {
      return;
    }
    const calledFunction = resolveCalledFunction(node.callee, context);
    if (
      calledFunction === targetFunction ||
      (calledFunction &&
        functionInvokesTarget(
          calledFunction,
          targetFunction,
          context,
          visitedFunctions,
          canCrossSuspension,
        ))
    ) {
      invokesTarget = true;
      return false;
    }
  });
  return invokesTarget;
};

const isFunctionInvokedBefore = (
  invokedFunction: EsTreeNode,
  boundary: EsTreeNode,
  context: RuleContext,
): boolean => {
  const boundaryFunction = findEnclosingFunction(boundary);
  const boundaryStart = getRangeStart(boundary);
  if (!boundaryFunction || boundaryStart === null) return false;
  let isInvokedBefore = false;
  walkAst(boundaryFunction, (node) => {
    if (node !== boundaryFunction && isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callStart = getRangeStart(node);
    if (
      callStart === null ||
      callStart >= boundaryStart ||
      !isNodeReachableWithinFunction(node, context) ||
      !isUnconditionallyExecuted(node, boundaryFunction, context) ||
      hasSuspensionBefore(boundaryFunction, node, context)
    ) {
      return;
    }
    const calledFunction = resolveCalledFunction(node.callee, context);
    if (
      calledFunction === invokedFunction ||
      (calledFunction && functionInvokesTarget(calledFunction, invokedFunction, context, new Set()))
    ) {
      isInvokedBefore = true;
      return false;
    }
  });
  return isInvokedBefore;
};

const isFunctionInvokedAfter = (
  invokedFunction: EsTreeNode,
  boundary: EsTreeNode,
  callerFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  const boundaryStart = getRangeStart(boundary);
  if (boundaryStart === null) return false;
  let isInvokedAfter = false;
  walkAst(callerFunction, (node) => {
    if (node !== callerFunction && isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callStart = getRangeStart(node);
    if (
      callStart === null ||
      callStart <= boundaryStart ||
      !isNodeReachableWithinFunction(node, context) ||
      !isUnconditionallyExecuted(node, callerFunction, context)
    ) {
      return;
    }
    const calledFunction = resolveCalledFunction(node.callee, context);
    if (
      calledFunction === invokedFunction ||
      (calledFunction &&
        functionInvokesTarget(calledFunction, invokedFunction, context, new Set(), true))
    ) {
      isInvokedAfter = true;
      return false;
    }
  });
  return isInvokedAfter;
};

const isWriteExecutedBefore = (
  writeNode: EsTreeNode,
  boundary: EsTreeNode,
  context: RuleContext,
  deferredExecutionFunction: EsTreeNode | null,
): boolean => {
  const writeStart = getRangeStart(writeNode);
  const boundaryStart = getRangeStart(boundary);
  const writeFunction = findEnclosingFunction(writeNode);
  const writeExecutionBoundary = writeFunction ?? findProgramRoot(writeNode);
  if (
    writeStart === null ||
    boundaryStart === null ||
    !writeExecutionBoundary ||
    !isNodeReachableWithinFunction(writeNode, context) ||
    !isUnconditionallyExecuted(writeNode, writeExecutionBoundary, context)
  ) {
    return false;
  }
  const boundaryFunction = findEnclosingFunction(boundary);
  const renderFunction = deferredExecutionFunction
    ? findEnclosingFunction(deferredExecutionFunction)
    : null;
  if (writeFunction === boundaryFunction) return writeStart < boundaryStart;
  if (!writeFunction) return writeStart < boundaryStart;
  if (boundaryFunction && isFunctionAncestor(writeFunction, boundaryFunction)) {
    const isRenderAncestor = Boolean(
      renderFunction &&
      (writeFunction === renderFunction || isFunctionAncestor(writeFunction, renderFunction)),
    );
    if (isRenderAncestor) return true;
    if (deferredExecutionFunction && boundaryFunction !== deferredExecutionFunction) {
      if (
        hasSuspensionBefore(boundaryFunction, boundary, context) &&
        isFunctionInvokedBefore(boundaryFunction, writeNode, context)
      ) {
        return true;
      }
      return isFunctionInvokedAfter(boundaryFunction, writeNode, writeFunction, context);
    }
    return writeStart < boundaryStart;
  }
  if (
    renderFunction &&
    isFunctionAncestor(renderFunction, writeFunction) &&
    !hasSuspensionBefore(writeFunction, writeNode, context) &&
    functionInvokesTarget(renderFunction, writeFunction, context, new Set())
  ) {
    return true;
  }
  return (
    !hasSuspensionBefore(writeFunction, writeNode, context) &&
    isFunctionInvokedBefore(writeFunction, boundary, context)
  );
};

const getStaticStringValue = (node: EsTreeNode): string | null => {
  const unwrappedNode = stripParenExpression(node);
  if (isNodeOfType(unwrappedNode, "Literal") && typeof unwrappedNode.value === "string") {
    return unwrappedNode.value;
  }
  if (isNodeOfType(unwrappedNode, "TemplateLiteral") && unwrappedNode.expressions.length === 0) {
    return getStaticTemplateLiteralValue(unwrappedNode);
  }
  return null;
};

const isSameRefetchMember = (
  target: EsTreeNode,
  candidate: EsTreeNode,
  context: RuleContext,
): boolean => {
  const unwrappedTarget = stripParenExpression(target);
  const unwrappedCandidate = stripParenExpression(candidate);
  if (
    !isNodeOfType(unwrappedTarget, "Identifier") ||
    !isNodeOfType(unwrappedCandidate, "MemberExpression") ||
    !isStaticRefetchMember(unwrappedCandidate)
  ) {
    return false;
  }
  const candidateTarget = stripParenExpression(unwrappedCandidate.object);
  if (!isNodeOfType(candidateTarget, "Identifier")) return false;
  const targetSymbol = resolveConstIdentifierAlias(unwrappedTarget, context.scopes);
  const candidateSymbol = resolveConstIdentifierAlias(candidateTarget, context.scopes);
  return Boolean(targetSymbol && candidateSymbol?.id === targetSymbol.id);
};

const getRefetchMutationTarget = (node: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  if (isNodeOfType(node, "MemberExpression") && isStaticRefetchMember(node)) {
    const parent = node.parent;
    if (
      isNodeOfType(parent, "AssignmentExpression") &&
      parent.left === node &&
      isSameRefetchMember(node.object, parent.right, context)
    ) {
      return null;
    }
    const isWrite =
      (isNodeOfType(parent, "AssignmentExpression") && parent.left === node) ||
      (isNodeOfType(parent, "UpdateExpression") && parent.argument === node) ||
      (isNodeOfType(parent, "UnaryExpression") && parent.operator === "delete");
    return isWrite ? node.object : null;
  }
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const receiver = stripParenExpression(callee.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    receiver.name !== "Object" ||
    context.scopes.symbolFor(receiver)
  ) {
    return null;
  }
  const methodName = getStaticPropertyKeyName(callee, { allowComputedString: true });
  const target = node.arguments[0];
  if (!target || isNodeOfType(target, "SpreadElement")) return null;
  if (methodName === "defineProperty") {
    const propertyKey = node.arguments[1];
    if (!propertyKey || getStaticStringValue(propertyKey) !== "refetch") return null;
    const descriptor = node.arguments[2];
    if (isNodeOfType(descriptor, "ObjectExpression")) {
      const valueProperty = descriptor.properties.find(
        (property) =>
          isNodeOfType(property, "Property") &&
          getStaticPropertyKeyName(property, { allowComputedString: true }) === "value",
      );
      if (
        isNodeOfType(valueProperty, "Property") &&
        isSameRefetchMember(target, valueProperty.value, context)
      ) {
        return null;
      }
    }
    return target;
  }
  if (methodName !== "assign") return null;
  let finalRefetchValue: EsTreeNode | null = null;
  for (const source of node.arguments.slice(1)) {
    if (!isNodeOfType(source, "ObjectExpression")) continue;
    for (const property of source.properties) {
      if (
        isNodeOfType(property, "Property") &&
        getStaticPropertyKeyName(property, { allowComputedString: true }) === "refetch"
      ) {
        finalRefetchValue = property.value;
      }
    }
  }
  if (!finalRefetchValue || isSameRefetchMember(target, finalRefetchValue, context)) return null;
  return target;
};

const hasRefetchMemberWriteBefore = (
  expression: EsTreeNode,
  boundary: EsTreeNode,
  context: RuleContext,
  deferredExecutionFunction: EsTreeNode | null,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return false;
  const resultSymbol = resolveConstIdentifierAlias(unwrappedExpression, context.scopes);
  if (!resultSymbol) return false;
  const program = findProgramRoot(expression);
  if (!program) return true;
  const boundaryStart = getRangeStart(boundary);
  if (boundaryStart === null) return true;
  let hasWrite = false;
  walkAst(program, (node) => {
    const mutationTarget = getRefetchMutationTarget(node, context);
    if (!mutationTarget) return;
    if (!isWriteExecutedBefore(node, boundary, context, deferredExecutionFunction)) return;
    const object = stripParenExpression(mutationTarget);
    if (!isNodeOfType(object, "Identifier")) return;
    const writtenSymbol = resolveConstIdentifierAlias(object, context.scopes);
    if (writtenSymbol?.id === resultSymbol.id) {
      hasWrite = true;
      return false;
    }
  });
  return hasWrite;
};

const isTanstackRefetchExpression = (
  expression: EsTreeNode,
  context: RuleContext,
  deferredExecutionFunction: EsTreeNode | null,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    return (
      isStaticRefetchMember(unwrappedExpression) &&
      isTanstackQueryResult(unwrappedExpression.object, context) &&
      !hasRefetchMemberWriteBefore(
        unwrappedExpression.object,
        unwrappedExpression,
        context,
        deferredExecutionFunction,
      )
    );
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read") ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  const bindingProperty = symbol.bindingIdentifier.parent;
  if (
    isNodeOfType(bindingProperty, "Property") &&
    getStaticPropertyKeyName(bindingProperty, { allowComputedString: true }) === "refetch"
  ) {
    const initializer = symbol.declarationNode.init;
    return Boolean(
      initializer &&
      isTanstackQueryResult(initializer, context) &&
      !hasRefetchMemberWriteBefore(initializer, symbol.declarationNode, context, null),
    );
  }
  return Boolean(
    symbol.declarationNode.id === symbol.bindingIdentifier &&
    symbol.initializer &&
    isTanstackRefetchExpression(symbol.initializer, context, null, visitedSymbolIds),
  );
};

const isTanstackRefetchCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  effectCallback: EsTreeNode,
): boolean => {
  return isTanstackRefetchExpression(callExpression.callee, context, effectCallback);
};

export const queryNoQueryInEffect = defineRule({
  id: "query-no-query-in-effect",
  title: "Query refetch inside useEffect",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Use `queryKey` changes or `enabled` so React Query schedules the fetch once instead of refetching again from `useEffect`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;

      const callback = getEffectCallback(node);
      if (!callback) return;

      const effectInvokedFunctions = collectEffectInvokedFunctions(callback);
      walkAst(callback, (child: EsTreeNode) => {
        // Skip calls registered inside nested handlers (addEventListener /
        // setInterval) — those fire on an external event — but keep walking
        // into functions the effect body itself invokes (IIFEs, called local
        // functions, promise-chain callbacks): those run on every effect
        // execution.
        if (child !== callback && isFunctionLike(child) && !effectInvokedFunctions.has(child))
          return false;
        if (!isNodeOfType(child, "CallExpression")) return;

        if (isTanstackRefetchCall(child, context, callback)) {
          context.report({
            node: child,
            message:
              "refetch() inside useEffect duplicates work React Query already does, causing extra fetches.",
          });
        }
      });
    },
  }),
});
