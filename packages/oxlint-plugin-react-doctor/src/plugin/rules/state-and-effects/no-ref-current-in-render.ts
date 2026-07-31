import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { collectSynchronouslyEffectInvokedFunctions } from "../../utils/collect-effect-invoked-functions.js";
import { containsNonDeterministicSource } from "../../utils/contains-non-deterministic-source.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { findDeferredExecutionBoundary } from "../../utils/find-deferred-execution-boundary.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isOutsideAllFunctions } from "../../utils/is-outside-all-functions.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const REPEATED_ANCESTOR_TYPES = new Set([
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "WhileStatement",
]);

const isSameRefCurrentMember = (
  node: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "MemberExpression") || getStaticPropertyName(node) !== "current") {
    return false;
  }
  const receiver = stripParenExpression(node.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    resolveConstIdentifierAlias(receiver, scopes)?.id === refSymbol.id
  );
};

const isSameRefCurrentAlias = (
  node: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const expression = stripParenExpression(node);
  if (isSameRefCurrentMember(expression, refSymbol, scopes)) return true;
  if (!isNodeOfType(expression, "Identifier")) return false;
  const aliasSymbol = scopes.symbolFor(expression);
  return (
    aliasSymbol?.kind === "const" &&
    aliasSymbol.initializer !== null &&
    isSameRefCurrentMember(stripParenExpression(aliasSymbol.initializer), refSymbol, scopes)
  );
};

const resolveImmutableInitializationValue = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "Identifier")) return expression;
  const symbol = scopes.symbolFor(expression);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    symbol.references.some((reference) => reference.flag !== "read") ||
    visitedSymbolIds.has(symbol.id)
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveImmutableInitializationValue(symbol.initializer, scopes, visitedSymbolIds);
};

const isProvablyTruthyInitializationValue = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = resolveImmutableInitializationValue(node, scopes);
  if (!expression) return false;
  if (isNodeOfType(expression, "CallExpression")) {
    const callee = stripParenExpression(expression.callee);
    return isNodeOfType(callee, "Identifier") && callee.name.startsWith("create");
  }
  return (
    isNodeOfType(expression, "NewExpression") ||
    isNodeOfType(expression, "ObjectExpression") ||
    isNodeOfType(expression, "ArrayExpression") ||
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression") ||
    isNodeOfType(expression, "ClassExpression")
  );
};

const getInitializationValueName = (node: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const expression = resolveImmutableInitializationValue(node, scopes);
  if (!expression) return null;
  if (isNodeOfType(expression, "NewExpression") || isNodeOfType(expression, "CallExpression")) {
    const callee = stripParenExpression(expression.callee);
    if (!isNodeOfType(callee, "Identifier")) return null;
    return callee.name.startsWith("create") && callee.name.length > "create".length
      ? callee.name.slice("create".length)
      : callee.name;
  }
  return null;
};

const isMatchingReturnType = (
  typeNode: EsTreeNode,
  initializationValue: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(typeNode, "TSTypeReference")) return false;
  const typeName = typeNode.typeName;
  if (!isNodeOfType(typeName, "Identifier") || typeName.name !== "ReturnType") return false;
  const [returnTypeArgument] = typeNode.typeArguments?.params ?? [];
  if (!returnTypeArgument || !isNodeOfType(returnTypeArgument, "TSTypeQuery")) return false;
  const queriedName = returnTypeArgument.exprName;
  const expression = stripParenExpression(initializationValue);
  if (!isNodeOfType(queriedName, "Identifier") || !isNodeOfType(expression, "CallExpression")) {
    return false;
  }
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const queriedSymbol = scopes.symbolFor(queriedName);
  const calleeSymbol = scopes.symbolFor(callee);
  return queriedSymbol && calleeSymbol
    ? queriedSymbol.id === calleeSymbol.id
    : queriedName.name === callee.name;
};

const isClosedTruthyTypeDomain = (
  typeNode: EsTreeNode,
  initializationValue: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const initializationExpression = stripParenExpression(initializationValue);
  if (isNodeOfType(typeNode, "TSTypeLiteral")) {
    return isNodeOfType(initializationExpression, "ObjectExpression");
  }
  if (isNodeOfType(typeNode, "TSArrayType") || isNodeOfType(typeNode, "TSTupleType")) {
    return isNodeOfType(initializationExpression, "ArrayExpression");
  }
  if (isNodeOfType(typeNode, "TSFunctionType") || isNodeOfType(typeNode, "TSConstructorType")) {
    return (
      isNodeOfType(initializationExpression, "ArrowFunctionExpression") ||
      isNodeOfType(initializationExpression, "FunctionExpression") ||
      isNodeOfType(initializationExpression, "ClassExpression")
    );
  }
  if (isNodeOfType(typeNode, "TSObjectKeyword")) {
    return true;
  }
  if (isNodeOfType(typeNode, "TSIndexedAccessType")) {
    return isNodeOfType(initializationExpression, "ObjectExpression");
  }
  if (!isNodeOfType(typeNode, "TSTypeReference")) return false;
  const typeName = typeNode.typeName;
  if (
    isNodeOfType(initializationExpression, "ObjectExpression") ||
    isMatchingReturnType(typeNode, initializationExpression, scopes)
  ) {
    return true;
  }
  return (
    isNodeOfType(typeName, "Identifier") &&
    typeName.name === getInitializationValueName(initializationExpression, scopes)
  );
};

const refHasClosedFalsySentinelDomain = (
  refSymbol: SymbolDescriptor,
  initializationValue: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const initializer = refSymbol.initializer ? stripParenExpression(refSymbol.initializer) : null;
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  const [initialValue] = initializer.arguments ?? [];
  if (
    (initialValue && isNodeOfType(initialValue, "SpreadElement")) ||
    (initialValue && !isEmptySentinel(initialValue, scopes))
  ) {
    return false;
  }
  const [declaredType] = initializer.typeArguments?.params ?? [];
  if (!declaredType) return false;
  const domainTypes = isNodeOfType(declaredType, "TSUnionType")
    ? declaredType.types
    : [declaredType];
  let hasTruthyDomain = false;
  for (const memberType of domainTypes) {
    if (
      isNodeOfType(memberType, "TSNullKeyword") ||
      isNodeOfType(memberType, "TSUndefinedKeyword")
    ) {
      continue;
    }
    if (!isClosedTruthyTypeDomain(memberType, initializationValue, scopes)) return false;
    hasTruthyDomain = true;
  }
  return hasTruthyDomain;
};

const refHasEmptySentinelInitializer = (
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const initializer = refSymbol.initializer ? stripParenExpression(refSymbol.initializer) : null;
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  const [initialValue] = initializer.arguments ?? [];
  return Boolean(
    !initialValue ||
    (!isNodeOfType(initialValue, "SpreadElement") && isEmptySentinel(initialValue, scopes)),
  );
};

const refHasDeclaredType = (refSymbol: SymbolDescriptor): boolean => {
  const initializer = refSymbol.initializer ? stripParenExpression(refSymbol.initializer) : null;
  return Boolean(
    initializer &&
    isNodeOfType(initializer, "CallExpression") &&
    (initializer.typeArguments?.params.length ?? 0) > 0,
  );
};

const isSafeRefIdentifierUse = (identifier: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(identifier);
  const parent = expressionRoot.parent;
  if (
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.id === expressionRoot &&
    parent.parent !== null &&
    isNodeOfType(parent.parent, "VariableDeclaration") &&
    parent.parent.kind === "const"
  ) {
    return true;
  }
  if (
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === expressionRoot &&
    getStaticPropertyName(parent) === "current"
  ) {
    return true;
  }
  if (!parent || !isNodeOfType(parent, "VariableDeclarator") || parent.init !== expressionRoot) {
    return false;
  }
  return (
    isNodeOfType(parent.id, "Identifier") &&
    parent.parent !== null &&
    isNodeOfType(parent.parent, "VariableDeclaration") &&
    parent.parent.kind === "const"
  );
};

const refDoesNotEscape = (
  branchRoot: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  let didEscape = false;
  walkAst(branchRoot, (child: EsTreeNode): boolean | void => {
    if (didEscape) return false;
    if (!isNodeOfType(child, "Identifier")) return;
    if (resolveConstIdentifierAlias(child, scopes)?.id !== refSymbol.id) return;
    if (child === refSymbol.bindingIdentifier || isSafeRefIdentifierUse(child)) return;
    didEscape = true;
    return false;
  });
  return !didEscape;
};

const expressionContainsRefCurrent = (
  expression: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  let didFindRefCurrent = false;
  walkAst(expression, (child: EsTreeNode): boolean | void => {
    if (didFindRefCurrent) return false;
    if (resolveReactRefSymbol(child, scopes)?.id !== refSymbol.id) return;
    didFindRefCurrent = true;
    return false;
  });
  return didFindRefCurrent;
};

const isEmptySentinel = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(node);
  return (
    (isNodeOfType(expression, "Literal") && expression.value === null) ||
    (isNodeOfType(expression, "Identifier") &&
      expression.name === "undefined" &&
      scopes.isGlobalReference(expression))
  );
};

const isInitializationInputIndependent = (
  node: EsTreeNode,
  renderOwner: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  let isInputIndependent = true;
  walkAst(node, (child: EsTreeNode): boolean | void => {
    if (!isInputIndependent) return false;
    if (resolveReactRefSymbol(child, scopes)) return false;
    if (!isNodeOfType(child, "Identifier")) return;
    const symbol = scopes.symbolFor(child);
    if (!symbol) return;
    if (symbol.kind === "import") return false;
    if (symbol.kind === "let" || symbol.kind === "var" || symbol.kind === "using") {
      isInputIndependent = false;
      return false;
    }
    if (isOutsideAllFunctions(symbol)) return false;
    if (symbol.kind === "parameter") {
      if (symbol.scope.node === renderOwner) isInputIndependent = false;
      return false;
    }
    if (!symbol.initializer || symbol.references.some((reference) => reference.flag !== "read")) {
      isInputIndependent = false;
      return false;
    }
    if (visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    if (
      !isInitializationInputIndependent(symbol.initializer, renderOwner, scopes, visitedSymbolIds)
    ) {
      isInputIndependent = false;
    }
    return false;
  });
  return isInputIndependent;
};

const isPredictableInitializationValue = (
  node: EsTreeNode,
  refSymbol: SymbolDescriptor,
  renderOwner: EsTreeNode,
  scopes: ScopeAnalysis,
  requiresClosedTruthyDomain: boolean,
): boolean =>
  isInitializationInputIndependent(node, renderOwner, scopes) &&
  !containsNonDeterministicSource(node) &&
  ((isProvablyTruthyInitializationValue(node, scopes) &&
    (!requiresClosedTruthyDomain || !refHasDeclaredType(refSymbol))) ||
    refHasClosedFalsySentinelDomain(refSymbol, node, scopes));

const hasRepeatedExecutionAncestor = (node: EsTreeNode, stop: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor && ancestor !== stop) {
    if (isFunctionLike(ancestor) || REPEATED_ANCESTOR_TYPES.has(ancestor.type)) return true;
    ancestor = ancestor.parent;
  }
  return ancestor !== stop;
};

const getBranchConstraints = (
  node: EsTreeNode,
  branchRoot: EsTreeNode,
): Map<EsTreeNode, boolean> => {
  const constraints = new Map<EsTreeNode, boolean>();
  let descendant = node;
  let ancestor = descendant.parent;
  while (ancestor && descendant !== branchRoot) {
    if (isNodeOfType(ancestor, "IfStatement")) {
      if (ancestor.consequent === descendant) constraints.set(ancestor, true);
      if (ancestor.alternate === descendant) constraints.set(ancestor, false);
    }
    descendant = ancestor;
    ancestor = ancestor.parent;
  }
  return constraints;
};

const canExecuteTogether = (
  firstConstraints: Map<EsTreeNode, boolean>,
  secondConstraints: Map<EsTreeNode, boolean>,
): boolean => {
  for (const [statement, branch] of firstConstraints) {
    const otherBranch = secondConstraints.get(statement);
    if (otherBranch !== undefined && otherBranch !== branch) return false;
  }
  return true;
};

const hasNoCoExecutableCompetingWrite = (
  assignmentExpression: EsTreeNodeOfType<"AssignmentExpression">,
  renderOwner: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const assignmentConstraints = getBranchConstraints(assignmentExpression, renderOwner);
  const synchronouslyInvokedFunctions = collectSynchronouslyEffectInvokedFunctions(
    renderOwner,
    scopes,
  );
  let hasCompetingWrite = false;
  walkAst(renderOwner, (child: EsTreeNode): boolean | void => {
    if (hasCompetingWrite) return false;
    let writtenExpression: EsTreeNode | null = null;
    if (isNodeOfType(child, "AssignmentExpression")) {
      if (child === assignmentExpression) return;
      writtenExpression = child.left;
    } else if (
      isNodeOfType(child, "UpdateExpression") ||
      (isNodeOfType(child, "UnaryExpression") && child.operator === "delete")
    ) {
      writtenExpression = child.argument;
    } else if (isNodeOfType(child, "ForInStatement") || isNodeOfType(child, "ForOfStatement")) {
      writtenExpression = child.left;
    }
    const deferredExecutionBoundary = findDeferredExecutionBoundary(child);
    const deferredWriteValue =
      isNodeOfType(child, "AssignmentExpression") && child.operator === "="
        ? resolveImmutableInitializationValue(child.right, scopes)
        : null;
    const isDeferredTruthyWrite =
      deferredExecutionBoundary !== null &&
      deferredExecutionBoundary !== renderOwner &&
      !synchronouslyInvokedFunctions.has(deferredExecutionBoundary) &&
      !executesDuringRender(deferredExecutionBoundary, scopes) &&
      deferredWriteValue !== null &&
      !isNodeOfType(deferredWriteValue, "CallExpression") &&
      isProvablyTruthyInitializationValue(deferredWriteValue, scopes);
    if (
      !writtenExpression ||
      isDeferredTruthyWrite ||
      !expressionContainsRefCurrent(writtenExpression, refSymbol, scopes) ||
      !canExecuteTogether(assignmentConstraints, getBranchConstraints(child, renderOwner))
    ) {
      return;
    }
    hasCompetingWrite = true;
    return false;
  });
  return !hasCompetingWrite;
};

const hasNoPriorCoExecutableWrite = (
  assignmentExpression: EsTreeNodeOfType<"AssignmentExpression">,
  branchRoot: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const assignmentConstraints = getBranchConstraints(assignmentExpression, branchRoot);
  const assignmentStart = getRangeStart(assignmentExpression);
  let hasCoExecutableWrite = false;
  walkAst(branchRoot, (child: EsTreeNode): boolean | void => {
    if (hasCoExecutableWrite) return false;
    const childStart = getRangeStart(child);
    if (
      child === assignmentExpression ||
      !isNodeOfType(child, "AssignmentExpression") ||
      assignmentStart === null ||
      childStart === null ||
      childStart >= assignmentStart ||
      resolveReactRefSymbol(child.left, scopes)?.id !== refSymbol.id ||
      hasRepeatedExecutionAncestor(child, branchRoot)
    ) {
      return;
    }
    if (canExecuteTogether(assignmentConstraints, getBranchConstraints(child, branchRoot))) {
      hasCoExecutableWrite = true;
      return false;
    }
  });
  return !hasCoExecutableWrite;
};

const isPredictableGuardedInitialization = (
  assignmentExpression: EsTreeNodeOfType<"AssignmentExpression">,
  guardedBranch: EsTreeNode,
  renderOwner: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  requiresClosedTruthyDomain: boolean,
): boolean =>
  refHasEmptySentinelInitializer(refSymbol, scopes) &&
  isPredictableInitializationValue(
    assignmentExpression.right,
    refSymbol,
    renderOwner,
    scopes,
    requiresClosedTruthyDomain,
  ) &&
  !hasRepeatedExecutionAncestor(assignmentExpression, guardedBranch) &&
  (guardedBranch === renderOwner || !hasRepeatedExecutionAncestor(guardedBranch, renderOwner)) &&
  hasNoPriorCoExecutableWrite(assignmentExpression, renderOwner, refSymbol, scopes) &&
  hasNoCoExecutableCompetingWrite(assignmentExpression, renderOwner, refSymbol, scopes) &&
  refDoesNotEscape(renderOwner, refSymbol, scopes);

const isDocumentedLazyInitialization = (
  assignmentExpression: EsTreeNodeOfType<"AssignmentExpression">,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const renderOwner = findRenderPhaseComponentOrHook(assignmentExpression, scopes);
  if (!renderOwner) return false;
  if (assignmentExpression.operator === "??=" || assignmentExpression.operator === "||=") {
    return isPredictableGuardedInitialization(
      assignmentExpression,
      renderOwner,
      renderOwner,
      refSymbol,
      scopes,
      assignmentExpression.operator === "||=",
    );
  }
  if (assignmentExpression.operator !== "=") return false;
  let descendant: EsTreeNode = assignmentExpression;
  let ancestor = descendant.parent;
  while (ancestor) {
    const test = isNodeOfType(ancestor, "IfStatement") ? stripParenExpression(ancestor.test) : null;
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      test &&
      isNodeOfType(test, "UnaryExpression") &&
      test.operator === "!" &&
      isSameRefCurrentAlias(test.argument, refSymbol, scopes) &&
      ancestor.consequent === descendant &&
      isPredictableGuardedInitialization(
        assignmentExpression,
        ancestor.consequent,
        renderOwner,
        refSymbol,
        scopes,
        true,
      )
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      isNodeOfType(test, "BinaryExpression") &&
      ["===", "==", "!==", "!="].includes(test.operator)
    ) {
      const { left, right } = test;
      const comparesEmptySentinel =
        (isSameRefCurrentAlias(left, refSymbol, scopes) && isEmptySentinel(right, scopes)) ||
        (isSameRefCurrentAlias(right, refSymbol, scopes) && isEmptySentinel(left, scopes));
      const isEquality = test.operator === "===" || test.operator === "==";
      const guardedBranch = isEquality ? ancestor.consequent : ancestor.alternate;
      if (
        comparesEmptySentinel &&
        guardedBranch === descendant &&
        guardedBranch &&
        isPredictableGuardedInitialization(
          assignmentExpression,
          guardedBranch,
          renderOwner,
          refSymbol,
          scopes,
          false,
        )
      )
        return true;
    }
    descendant = ancestor;
    ancestor = descendant.parent;
  }
  return false;
};

export const noRefCurrentInRender = defineRule({
  id: "no-ref-current-in-render",
  title: "Ref mutated during render",
  severity: "error",
  recommendation:
    "Move ref writes into an event handler or effect. Render must stay pure because React can replay or discard it. The predictable null-guarded lazy initialization pattern remains supported.",
  create: (context) => {
    const report = (memberExpression: EsTreeNode) => {
      if (!resolveReactRefSymbol(memberExpression, context.scopes)) return;
      if (!findRenderPhaseComponentOrHook(memberExpression, context.scopes)) return;
      context.report({
        node: memberExpression,
        message:
          "This ref is mutated during render. React can replay or discard render work, so the mutation can leak from UI that never commits.",
      });
    };

    return {
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        const refSymbol = resolveReactRefSymbol(node.left, context.scopes);
        if (!refSymbol) return;
        if (isDocumentedLazyInitialization(node, refSymbol, context.scopes)) return;
        report(node.left);
      },
      UpdateExpression(node: EsTreeNodeOfType<"UpdateExpression">) {
        report(node.argument);
      },
    };
  },
});
