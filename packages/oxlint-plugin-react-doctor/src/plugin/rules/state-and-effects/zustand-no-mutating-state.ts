import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import {
  collectMutableStateReferenceMutations,
  updateMutableStateReferencesForIdentifierAssignment,
  updateMutableStateReferencesForVariableDeclaration,
  type MutableStateReferenceMutation,
  type MutableStateReferenceState,
} from "../../utils/mutable-state-reference-analysis.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import {
  resolveZustandStoreCreator,
  type ZustandStoreCreator,
} from "../../utils/resolve-zustand-api.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const MESSAGE =
  "This Zustand state reference is mutated and reused, so subscribers can miss the update.";

const FRESH_ARRAY_METHOD_NAMES = new Set([
  "concat",
  "filter",
  "flat",
  "flatMap",
  "map",
  "slice",
  "toReversed",
  "toSorted",
  "toSpliced",
  "with",
]);

const UNSUPPORTED_CONTROL_FLOW_TYPES = new Set([
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "IfStatement",
  "LabeledStatement",
  "BlockStatement",
  "SwitchStatement",
  "TryStatement",
  "WhileStatement",
  "WithStatement",
]);

interface ZustandCreatorBinding {
  creatorFunction: ZustandStoreCreator["creatorFunction"];
  getSymbol: SymbolDescriptor | null;
  hasNonImmerUsage: boolean;
  setSymbol: SymbolDescriptor | null;
  storeSymbolIds: Set<number>;
}

interface MutationWithStatementIndex {
  branchRoot: EsTreeNode | null;
  mutation: MutableStateReferenceMutation;
  statementIndex: number;
}

interface NotifierCallWithStatementIndex {
  branchRoot: EsTreeNode | null;
  callExpression: EsTreeNodeOfType<"CallExpression">;
  statementIndex: number;
}

interface ConditionalNotifierGroupWithStatementIndex {
  branchCalls: EsTreeNodeOfType<"CallExpression">[][];
  statementIndex: number;
}

const findIdentifierParameter = (
  parameter: EsTreeNode | undefined,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (!parameter) return null;
  if (isNodeOfType(parameter, "Identifier")) return parameter;
  if (isNodeOfType(parameter, "AssignmentPattern") && isNodeOfType(parameter.left, "Identifier")) {
    return parameter.left;
  }
  return null;
};

const symbolForParameter = (
  creatorFunction: ZustandStoreCreator["creatorFunction"],
  parameterIndex: number,
  context: RuleContext,
): SymbolDescriptor | null => {
  const parameter = findIdentifierParameter(creatorFunction.params[parameterIndex]);
  return parameter ? (context.scopes.symbolFor(parameter) ?? null) : null;
};

const isCallToSymbol = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  symbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(callee, context.scopes);
  return Boolean(symbol && symbolIds.has(symbol.id));
};

const rootCallForExpression = (
  expression: EsTreeNode,
): EsTreeNodeOfType<"CallExpression"> | null => {
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object);
  }
  return isNodeOfType(current, "CallExpression") ? current : null;
};

const storeSymbolIdForMethodCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  methodName: "getState" | "setState",
  context: RuleContext,
): number | null => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  if (getStaticPropertyName(callee) !== methodName) return null;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(receiver, context.scopes);
  return symbol?.id ?? null;
};

const isStoreMethodCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  methodName: "getState" | "setState",
  storeSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean => {
  const storeSymbolId = storeSymbolIdForMethodCall(callExpression, methodName, context);
  return storeSymbolId !== null && storeSymbolIds.has(storeSymbolId);
};

const isSnapshotExpression = (
  expression: EsTreeNode | null | undefined,
  getSymbolIds: ReadonlySet<number>,
  storeSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean => {
  if (!expression) return false;
  const rootCall = rootCallForExpression(expression);
  return Boolean(
    rootCall &&
    (isCallToSymbol(rootCall, getSymbolIds, context) ||
      isStoreMethodCall(rootCall, "getState", storeSymbolIds, context)),
  );
};

const expressionKeyPreservesTarget = (
  expression: EsTreeNode,
  targetKey: string,
  context: RuleContext,
): boolean => {
  const expressionKey = resolveExpressionKey(expression, context);
  return Boolean(
    expressionKey && (expressionKey === targetKey || targetKey.startsWith(`${expressionKey}.`)),
  );
};

const expressionPreservesTarget = (
  expression: EsTreeNode | null | undefined,
  targetKey: string,
  mutationNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!expression) return false;
  const candidate = stripParenExpression(expression);
  if (candidate === mutationNode) return true;
  if (isNodeOfType(candidate, "Identifier") || isNodeOfType(candidate, "MemberExpression")) {
    return expressionKeyPreservesTarget(candidate, targetKey, context);
  }
  if (isNodeOfType(candidate, "ObjectExpression")) {
    return candidate.properties.some((property) => {
      if (isNodeOfType(property, "SpreadElement")) {
        const spreadKey = resolveExpressionKey(property.argument, context);
        return Boolean(
          spreadKey && spreadKey !== targetKey && targetKey.startsWith(`${spreadKey}.`),
        );
      }
      return (
        isNodeOfType(property, "Property") &&
        expressionPreservesTarget(property.value, targetKey, mutationNode, context)
      );
    });
  }
  if (isNodeOfType(candidate, "ArrayExpression")) {
    return candidate.elements.some(
      (element) =>
        Boolean(element) &&
        !isNodeOfType(element, "SpreadElement") &&
        expressionPreservesTarget(element, targetKey, mutationNode, context),
    );
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      expressionPreservesTarget(candidate.consequent, targetKey, mutationNode, context) ||
      expressionPreservesTarget(candidate.alternate, targetKey, mutationNode, context)
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    return (
      expressionPreservesTarget(candidate.left, targetKey, mutationNode, context) ||
      expressionPreservesTarget(candidate.right, targetKey, mutationNode, context)
    );
  }
  if (isNodeOfType(candidate, "SequenceExpression")) {
    return expressionPreservesTarget(
      candidate.expressions[candidate.expressions.length - 1],
      targetKey,
      mutationNode,
      context,
    );
  }
  return false;
};

const expressionContainsFreshCloneOfTarget = (
  expression: EsTreeNode | null | undefined,
  targetKey: string,
  context: RuleContext,
): boolean => {
  if (!expression) return false;
  let didFindFreshClone = false;
  walkAst(expression, (node: EsTreeNode) => {
    const candidate = stripParenExpression(node);
    if (isFunctionLike(candidate)) return false;
    if (isNodeOfType(candidate, "SpreadElement")) {
      if (resolveExpressionKey(candidate.argument, context) === targetKey) {
        didFindFreshClone = true;
      }
      return false;
    }
    if (isNodeOfType(candidate, "NewExpression")) {
      const callee = stripParenExpression(candidate.callee);
      const firstArgument = candidate.arguments[0];
      if (
        isNodeOfType(callee, "Identifier") &&
        (callee.name === "Map" || callee.name === "Set") &&
        firstArgument &&
        !isNodeOfType(firstArgument, "SpreadElement") &&
        resolveExpressionKey(firstArgument, context) === targetKey
      ) {
        didFindFreshClone = true;
      }
      return;
    }
    if (!isNodeOfType(candidate, "CallExpression")) return;
    const callee = stripParenExpression(candidate.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    const methodName = getStaticPropertyName(callee);
    if (
      methodName &&
      FRESH_ARRAY_METHOD_NAMES.has(methodName) &&
      resolveExpressionKey(callee.object, context) === targetKey
    ) {
      didFindFreshClone = true;
    }
  });
  return didFindFreshClone;
};

const isDefinitelyNoUpdateExpression = (expression: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(expression);
  return (
    (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "void") ||
    (isNodeOfType(candidate, "Identifier") &&
      candidate.name === "undefined" &&
      context.scopes.isGlobalReference(candidate))
  );
};

const returnedExpressionsForFunction = (functionNode: EsTreeNode): EsTreeNode[] => {
  if (!isFunctionLike(functionNode)) return [];
  if (!isNodeOfType(functionNode.body, "BlockStatement")) return [functionNode.body];
  const returnedExpressions: EsTreeNode[] = [];
  for (const statement of functionNode.body.body) {
    if (isNodeOfType(statement, "ReturnStatement") && statement.argument) {
      returnedExpressions.push(statement.argument);
    }
  }
  return returnedExpressions;
};

const hasUnsupportedControlFlow = (statements: readonly EsTreeNode[]): boolean =>
  statements.some((statement) => UNSUPPORTED_CONTROL_FLOW_TYPES.has(statement.type));

const hasAbruptCompletion = (node: EsTreeNode): boolean => {
  let didFindAbruptCompletion = false;
  walkAst(node, (child: EsTreeNode) => {
    if (child !== node && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement") || isNodeOfType(child, "ThrowStatement")) {
      didFindAbruptCompletion = true;
      return false;
    }
  });
  return didFindAbruptCompletion;
};

const hasUnsupportedSnapshotControlFlow = (statements: readonly EsTreeNode[]): boolean =>
  statements.some(
    (statement) =>
      UNSUPPORTED_CONTROL_FLOW_TYPES.has(statement.type) &&
      (!isNodeOfType(statement, "IfStatement") || hasAbruptCompletion(statement)),
  );

const analyzeSetUpdater = (
  updaterFunction: EsTreeNode,
  context: RuleContext,
  reportedNodes: WeakSet<EsTreeNode>,
): void => {
  if (!isFunctionLike(updaterFunction) || updaterFunction.async || updaterFunction.generator)
    return;
  const stateParameter = findIdentifierParameter(updaterFunction.params[0]);
  if (!stateParameter) return;
  const state: MutableStateReferenceState = {
    mutableStateSourceNames: new Set([stateParameter.name]),
  };
  const returnedExpressions = returnedExpressionsForFunction(updaterFunction);
  const mutations: MutableStateReferenceMutation[] = [];
  if (isNodeOfType(updaterFunction.body, "BlockStatement")) {
    if (hasUnsupportedControlFlow(updaterFunction.body.body)) return;
    for (const statement of updaterFunction.body.body) {
      mutations.push(...collectMutableStateReferenceMutations(statement, state));
      if (isNodeOfType(statement, "VariableDeclaration")) {
        updateMutableStateReferencesForVariableDeclaration(statement, state);
      } else if (isNodeOfType(statement, "ExpressionStatement")) {
        const assignment = stripParenExpression(statement.expression);
        if (isNodeOfType(assignment, "AssignmentExpression")) {
          updateMutableStateReferencesForIdentifierAssignment(assignment, state);
        }
      }
      if (isNodeOfType(statement, "ReturnStatement")) break;
    }
  } else {
    mutations.push(...collectMutableStateReferenceMutations(updaterFunction.body, state));
  }
  for (const mutation of mutations) {
    const hasNoUpdateReturn = returnedExpressions.some((expression) =>
      isDefinitelyNoUpdateExpression(expression, context),
    );
    const doesPreserveTarget = returnedExpressions.some(
      (expression) => updateTargetReplacementDisposition(expression, mutation, context) === false,
    );
    if (returnedExpressions.length > 0 && !doesPreserveTarget && !hasNoUpdateReturn) continue;
    if (reportedNodes.has(mutation.node)) continue;
    reportedNodes.add(mutation.node);
    context.report({ node: mutation.node, message: MESSAGE });
  }
};

const collectNotifierCalls = (
  statement: EsTreeNode,
  setSymbolIds: ReadonlySet<number>,
  storeSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression">[] => {
  const notifierCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  walkAst(statement, (node: EsTreeNode) => {
    if (isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    if (
      isCallToSymbol(node, setSymbolIds, context) ||
      isStoreMethodCall(node, "setState", storeSymbolIds, context)
    ) {
      notifierCalls.push(node);
    }
  });
  return notifierCalls;
};

const staticPropertyPathForExpression = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
  followMutableInitializer = false,
): string[] | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = context.scopes.symbolFor(candidate);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return [];
    visitedSymbolIds.add(symbol.id);
    const bindingProperty = symbol.bindingIdentifier.parent;
    const bindingPattern = bindingProperty?.parent;
    const variableDeclarator = bindingPattern?.parent;
    if (
      isNodeOfType(bindingProperty, "Property") &&
      isNodeOfType(bindingPattern, "ObjectPattern") &&
      isNodeOfType(variableDeclarator, "VariableDeclarator")
    ) {
      const propertyName = getStaticPropertyKeyName(bindingProperty);
      const objectPath = variableDeclarator.init
        ? staticPropertyPathForExpression(
            variableDeclarator.init,
            context,
            visitedSymbolIds,
            followMutableInitializer,
          )
        : null;
      return propertyName && objectPath ? [...objectPath, propertyName] : null;
    }
    if ((!followMutableInitializer && symbol.kind !== "const") || !symbol.initializer) return [];
    return staticPropertyPathForExpression(
      symbol.initializer,
      context,
      visitedSymbolIds,
      followMutableInitializer,
    );
  }
  if (isNodeOfType(candidate, "MemberExpression")) {
    const propertyName = getStaticPropertyName(candidate);
    const objectPath = staticPropertyPathForExpression(
      candidate.object,
      context,
      visitedSymbolIds,
      followMutableInitializer,
    );
    return propertyName && objectPath ? [...objectPath, propertyName] : null;
  }
  if (isNodeOfType(candidate, "CallExpression")) return [];
  return null;
};

const isProvenFreshReplacementExpression = (
  expression: EsTreeNode,
  targetKey: string,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(expression);
  return (
    isNodeOfType(candidate, "ObjectExpression") ||
    isNodeOfType(candidate, "ArrayExpression") ||
    isNodeOfType(candidate, "NewExpression") ||
    isNodeOfType(candidate, "Literal") ||
    isNodeOfType(candidate, "TemplateLiteral") ||
    expressionContainsFreshCloneOfTarget(candidate, targetKey, context)
  );
};

const objectTargetReplacementDisposition = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  targetPath: readonly string[],
  targetKey: string,
  ancestorKey: string,
  mutationNode: EsTreeNode,
  isPartialUpdateRoot: boolean,
  context: RuleContext,
): boolean | null => {
  const propertyName = targetPath[0];
  if (!propertyName) return true;
  let disposition: boolean | null = isPartialUpdateRoot ? false : true;
  for (const property of objectExpression.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      const spreadKey = resolveExpressionKey(property.argument, context);
      disposition = spreadKey === ancestorKey ? false : null;
      continue;
    }
    if (!isNodeOfType(property, "Property")) continue;
    if (getStaticPropertyKeyName(property) !== propertyName) continue;
    if (targetPath.length === 1) {
      if (expressionPreservesTarget(property.value, targetKey, mutationNode, context)) {
        disposition = false;
      } else {
        disposition = isProvenFreshReplacementExpression(property.value, targetKey, context)
          ? true
          : null;
      }
      continue;
    }
    const propertyValue = stripParenExpression(property.value);
    if (isNodeOfType(propertyValue, "ObjectExpression")) {
      disposition = objectTargetReplacementDisposition(
        propertyValue,
        targetPath.slice(1),
        targetKey,
        `${ancestorKey}.${propertyName}`,
        mutationNode,
        false,
        context,
      );
    } else if (expressionKeyPreservesTarget(propertyValue, targetKey, context)) {
      disposition = false;
    } else {
      disposition = isProvenFreshReplacementExpression(propertyValue, targetKey, context)
        ? true
        : null;
    }
  }
  return disposition;
};

const staticPathPreservesTarget = (
  candidatePath: readonly string[] | null,
  targetPath: readonly string[],
): boolean =>
  Boolean(
    candidatePath &&
    candidatePath.length <= targetPath.length &&
    candidatePath.every((propertyName, index) => propertyName === targetPath[index]),
  );

const objectTargetPathReplacementDisposition = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  targetPath: readonly string[],
  isPartialUpdateRoot: boolean,
  context: RuleContext,
  ancestorPath: readonly string[] = [],
): boolean | null => {
  const propertyName = targetPath[0];
  if (!propertyName) return true;
  let disposition: boolean | null = isPartialUpdateRoot ? false : true;
  for (const property of objectExpression.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      disposition = null;
      continue;
    }
    if (!isNodeOfType(property, "Property")) continue;
    if (getStaticPropertyKeyName(property) !== propertyName) continue;
    const propertyValue = stripParenExpression(property.value);
    if (targetPath.length > 1 && isNodeOfType(propertyValue, "ObjectExpression")) {
      disposition = objectTargetPathReplacementDisposition(
        propertyValue,
        targetPath.slice(1),
        false,
        context,
        [...ancestorPath, propertyName],
      );
      continue;
    }
    if (
      staticPathPreservesTarget(staticPropertyPathForExpression(propertyValue, context), [
        ...ancestorPath,
        ...targetPath,
      ])
    ) {
      disposition = false;
      continue;
    }
    disposition = isProvenFreshReplacementExpression(propertyValue, "", context) ? true : null;
  }
  return disposition;
};

const rootIdentifierForExpression = (
  expression: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object);
  }
  return isNodeOfType(current, "Identifier") ? current : null;
};

const objectExpressionPublishesSymbolAtPath = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  targetPath: readonly string[],
  symbolId: number,
  context: RuleContext,
): boolean => {
  const propertyName = targetPath[0];
  if (!propertyName) return false;
  for (const property of objectExpression.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    if (getStaticPropertyKeyName(property) !== propertyName) continue;
    const propertyValue = stripParenExpression(property.value);
    if (targetPath.length > 1) {
      return (
        isNodeOfType(propertyValue, "ObjectExpression") &&
        objectExpressionPublishesSymbolAtPath(propertyValue, targetPath.slice(1), symbolId, context)
      );
    }
    return (
      isNodeOfType(propertyValue, "Identifier") &&
      context.scopes.symbolFor(propertyValue)?.id === symbolId
    );
  }
  return false;
};

const targetRebindReplacementDisposition = (
  updateExpression: EsTreeNode,
  mutation: MutableStateReferenceMutation,
  targetPath: readonly string[],
  targetKey: string,
  context: RuleContext,
): boolean | null | undefined => {
  const targetIdentifier = rootIdentifierForExpression(mutation.receiver);
  if (!targetIdentifier) return undefined;
  const targetSymbol = context.scopes.symbolFor(targetIdentifier);
  if (!targetSymbol || targetSymbol.kind === "const") return undefined;
  const candidate = stripParenExpression(updateExpression);
  const doesPublishTarget =
    targetPath.length === 0
      ? isNodeOfType(candidate, "Identifier") &&
        context.scopes.symbolFor(candidate)?.id === targetSymbol.id
      : isNodeOfType(candidate, "ObjectExpression") &&
        objectExpressionPublishesSymbolAtPath(candidate, targetPath, targetSymbol.id, context);
  if (!doesPublishTarget) return undefined;
  const mutationStart = getRangeStart(mutation.node);
  const updateStart = getRangeStart(updateExpression);
  const mutationFunction = findEnclosingFunction(mutation.node);
  if (mutationStart === null || updateStart === null) return undefined;
  let latestAssignment: EsTreeNodeOfType<"AssignmentExpression"> | null = null;
  let latestAssignmentStart: number | null = null;
  for (const reference of targetSymbol.references) {
    if (reference.flag === "read") continue;
    const assignment = reference.identifier.parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== reference.identifier ||
      findEnclosingFunction(assignment) !== mutationFunction
    ) {
      continue;
    }
    const assignmentStart = getRangeStart(assignment);
    if (
      assignmentStart === null ||
      assignmentStart <= mutationStart ||
      assignmentStart >= updateStart ||
      (latestAssignmentStart !== null && assignmentStart <= latestAssignmentStart)
    ) {
      continue;
    }
    latestAssignment = assignment;
    latestAssignmentStart = assignmentStart;
  }
  if (!latestAssignment) return undefined;
  if (expressionKeyPreservesTarget(latestAssignment.right, targetKey, context)) return false;
  return isProvenFreshReplacementExpression(latestAssignment.right, targetKey, context)
    ? true
    : null;
};

const updateTargetReplacementDisposition = (
  updateExpression: EsTreeNode,
  mutation: MutableStateReferenceMutation,
  context: RuleContext,
): boolean | null => {
  const targetKey = resolveExpressionKey(mutation.receiver, context);
  const targetPath = staticPropertyPathForExpression(
    mutation.receiver,
    context,
    new Set<number>(),
    true,
  );
  if (!targetPath) return null;
  const candidate = stripParenExpression(updateExpression);
  if (!targetKey) {
    if (targetPath.length === 0) return null;
    if (!isNodeOfType(candidate, "ObjectExpression")) {
      return staticPathPreservesTarget(
        staticPropertyPathForExpression(candidate, context),
        targetPath,
      )
        ? false
        : null;
    }
    return objectTargetPathReplacementDisposition(candidate, targetPath, true, context);
  }
  if (targetPath.length === 0) {
    if (expressionPreservesTarget(candidate, targetKey, mutation.node, context)) {
      const rebindDisposition = targetRebindReplacementDisposition(
        candidate,
        mutation,
        targetPath,
        targetKey,
        context,
      );
      return rebindDisposition === undefined ? false : rebindDisposition;
    }
    return isProvenFreshReplacementExpression(candidate, targetKey, context) ? true : null;
  }
  if (!isNodeOfType(candidate, "ObjectExpression")) {
    return expressionPreservesTarget(candidate, targetKey, mutation.node, context) ? false : null;
  }
  const ancestorKeySuffix = `.${targetPath.join(".")}`;
  const ancestorKey = targetKey.endsWith(ancestorKeySuffix)
    ? targetKey.slice(0, -ancestorKeySuffix.length)
    : targetKey;
  const disposition = objectTargetReplacementDisposition(
    candidate,
    targetPath,
    targetKey,
    ancestorKey,
    mutation.node,
    true,
    context,
  );
  if (disposition !== false) return disposition;
  const rebindDisposition = targetRebindReplacementDisposition(
    candidate,
    mutation,
    targetPath,
    targetKey,
    context,
  );
  return rebindDisposition === undefined ? false : rebindDisposition;
};

const notifierTargetReplacementDisposition = (
  notifierCall: EsTreeNodeOfType<"CallExpression">,
  mutation: MutableStateReferenceMutation,
  context: RuleContext,
): boolean | null => {
  const updateArgument = notifierCall.arguments[0];
  if (!updateArgument) return false;
  if (isNodeOfType(updateArgument, "SpreadElement")) return null;
  const updateFunction = resolveExactLocalFunction(updateArgument, context.scopes);
  const updateExpressions = updateFunction
    ? returnedExpressionsForFunction(updateFunction)
    : [updateArgument];
  const dispositions = updateExpressions.map((expression) =>
    updateTargetReplacementDisposition(expression, mutation, context),
  );
  if (dispositions.some((disposition) => disposition === true)) return true;
  if (dispositions.some((disposition) => disposition === null)) return null;
  return false;
};

const conditionalNotifierTargetReplacementDisposition = (
  branchCalls: readonly (readonly EsTreeNodeOfType<"CallExpression">[])[],
  mutation: MutableStateReferenceMutation,
  context: RuleContext,
): boolean | null => {
  const branchDispositions = branchCalls.map((calls) => {
    const dispositions = calls.map((callExpression) =>
      notifierTargetReplacementDisposition(callExpression, mutation, context),
    );
    if (dispositions.some((disposition) => disposition === true)) return true;
    if (dispositions.some((disposition) => disposition === null)) return null;
    return false;
  });
  if (branchDispositions.some((disposition) => disposition === false)) return false;
  return branchDispositions.every((disposition) => disposition === true) ? true : null;
};

const updateSnapshotStateForStatement = (
  statement: EsTreeNode,
  state: MutableStateReferenceState,
): void => {
  if (isNodeOfType(statement, "VariableDeclaration")) {
    updateMutableStateReferencesForVariableDeclaration(statement, state);
    return;
  }
  if (!isNodeOfType(statement, "ExpressionStatement")) return;
  const assignment = stripParenExpression(statement.expression);
  if (!isNodeOfType(assignment, "AssignmentExpression")) return;
  updateMutableStateReferencesForIdentifierAssignment(assignment, state);
};

const collectSequentialSnapshotMutations = (
  branchRoot: EsTreeNode,
  state: MutableStateReferenceState,
): MutableStateReferenceMutation[] => {
  const branchState: MutableStateReferenceState = {
    mutableStateSourceNames: new Set(state.mutableStateSourceNames),
  };
  if (state.isAdditionalMutableStateSource) {
    branchState.isAdditionalMutableStateSource = state.isAdditionalMutableStateSource;
  }
  const statements = isNodeOfType(branchRoot, "BlockStatement") ? branchRoot.body : [branchRoot];
  const mutations: MutableStateReferenceMutation[] = [];
  for (const statement of statements) {
    if (isNodeOfType(statement, "IfStatement")) {
      mutations.push(...collectSequentialSnapshotMutations(statement.consequent, branchState));
      if (statement.alternate) {
        mutations.push(...collectSequentialSnapshotMutations(statement.alternate, branchState));
      }
      continue;
    }
    mutations.push(...collectMutableStateReferenceMutations(statement, branchState));
    updateSnapshotStateForStatement(statement, branchState);
  }
  return mutations;
};

const analyzeSnapshotContainer = (
  statements: readonly EsTreeNode[],
  getSymbolIds: ReadonlySet<number>,
  setSymbolIds: ReadonlySet<number>,
  snapshotStoreSymbolIds: ReadonlySet<number>,
  notifierStoreSymbolIds: ReadonlySet<number>,
  context: RuleContext,
  reportedNodes: WeakSet<EsTreeNode>,
  returnedUpdateExpressions: readonly EsTreeNode[] = [],
): void => {
  if (hasUnsupportedSnapshotControlFlow(statements)) return;
  const state: MutableStateReferenceState = {
    isAdditionalMutableStateSource: (expression) =>
      isSnapshotExpression(expression, getSymbolIds, snapshotStoreSymbolIds, context),
    mutableStateSourceNames: new Set(),
  };
  const mutations: MutationWithStatementIndex[] = [];
  const notifierCalls: NotifierCallWithStatementIndex[] = [];
  const conditionalNotifierGroups: ConditionalNotifierGroupWithStatementIndex[] = [];
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex];
    if (isNodeOfType(statement, "IfStatement")) {
      const branchCalls: EsTreeNodeOfType<"CallExpression">[][] = [];
      for (const branchRoot of [statement.consequent, statement.alternate]) {
        if (!branchRoot) continue;
        for (const mutation of collectSequentialSnapshotMutations(branchRoot, state)) {
          mutations.push({ branchRoot, mutation, statementIndex });
        }
        const calls = collectNotifierCalls(
          branchRoot,
          setSymbolIds,
          notifierStoreSymbolIds,
          context,
        );
        branchCalls.push(calls);
        for (const callExpression of calls) {
          notifierCalls.push({ branchRoot, callExpression, statementIndex });
        }
      }
      if (statement.alternate) conditionalNotifierGroups.push({ branchCalls, statementIndex });
    } else {
      for (const mutation of collectMutableStateReferenceMutations(statement, state)) {
        mutations.push({ branchRoot: null, mutation, statementIndex });
      }
      for (const callExpression of collectNotifierCalls(
        statement,
        setSymbolIds,
        notifierStoreSymbolIds,
        context,
      )) {
        notifierCalls.push({ branchRoot: null, callExpression, statementIndex });
      }
    }
    updateSnapshotStateForStatement(statement, state);
    if (isNodeOfType(statement, "ReturnStatement")) break;
  }
  for (const { branchRoot, mutation, statementIndex } of mutations) {
    const followingNotifiers = notifierCalls.filter((notifier) => {
      if (!notifier.branchRoot) return notifier.statementIndex >= statementIndex;
      if (notifier.statementIndex !== statementIndex || notifier.branchRoot !== branchRoot) {
        return false;
      }
      const mutationStart = getRangeStart(mutation.node);
      const notifierStart = getRangeStart(notifier.callExpression);
      return mutationStart !== null && notifierStart !== null && notifierStart >= mutationStart;
    });
    const replacementDispositions = [
      ...followingNotifiers.map((notifier) =>
        notifierTargetReplacementDisposition(notifier.callExpression, mutation, context),
      ),
      ...returnedUpdateExpressions.map((expression) =>
        updateTargetReplacementDisposition(expression, mutation, context),
      ),
      ...conditionalNotifierGroups
        .filter((group) => group.statementIndex > statementIndex)
        .map((group) =>
          conditionalNotifierTargetReplacementDisposition(group.branchCalls, mutation, context),
        ),
    ];
    if (replacementDispositions.some((disposition) => disposition !== false)) {
      continue;
    }
    if (reportedNodes.has(mutation.node)) continue;
    reportedNodes.add(mutation.node);
    context.report({ node: mutation.node, message: MESSAGE });
  }
};

export const zustandNoMutatingState = defineRule({
  id: "zustand-no-mutating-state",
  title: "Zustand state mutated in place",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Create a new object, array, Map, or Set before passing the updated value to Zustand.",
  requires: ["zustand", "zustand:1"],
  create: (context: RuleContext) => {
    const creatorBindings = new Map<
      ZustandStoreCreator["creatorFunction"],
      ZustandCreatorBinding
    >();
    const bindingsWithBoundStoreNotifier = new Set<ZustandCreatorBinding>();
    const functionContainers = new Set<EsTreeNode>();
    const updaterFunctionNotifierSymbolIds = new Map<EsTreeNode, Set<number>>();
    const recordUpdaterFunctionNotifier = (
      updaterFunction: EsTreeNode,
      notifierSymbolId: number,
    ): void => {
      const notifierSymbolIds = updaterFunctionNotifierSymbolIds.get(updaterFunction);
      if (notifierSymbolIds) {
        notifierSymbolIds.add(notifierSymbolId);
      } else {
        updaterFunctionNotifierSymbolIds.set(updaterFunction, new Set([notifierSymbolId]));
      }
    };
    const reportedNodes = new WeakSet<EsTreeNode>();
    let programNode: EsTreeNodeOfType<"Program"> | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        programNode = node;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const creator = resolveZustandStoreCreator(node, context.scopes);
        if (!creator) return;
        let binding = creatorBindings.get(creator.creatorFunction);
        if (binding) {
          if (!creator.middlewareNames.has("immer")) binding.hasNonImmerUsage = true;
        } else {
          binding = {
            creatorFunction: creator.creatorFunction,
            getSymbol: symbolForParameter(creator.creatorFunction, 1, context),
            hasNonImmerUsage: !creator.middlewareNames.has("immer"),
            setSymbol: symbolForParameter(creator.creatorFunction, 0, context),
            storeSymbolIds: new Set(),
          };
          creatorBindings.set(creator.creatorFunction, binding);
        }
        const parent = node.parent;
        if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
          const storeSymbol = context.scopes.symbolFor(parent.id);
          if (storeSymbol) binding.storeSymbolIds.add(storeSymbol.id);
        }
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        functionContainers.add(node);
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        functionContainers.add(node);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        functionContainers.add(node);
      },
      "Program:exit"() {
        for (const binding of creatorBindings.values()) {
          if (binding.hasNonImmerUsage && binding.setSymbol) {
            const setSymbolId = binding.setSymbol.id;
            const creatorSetSymbolIds = new Set([setSymbolId]);
            walkAst(binding.creatorFunction.body, (node: EsTreeNode) => {
              if (!isNodeOfType(node, "CallExpression")) return;
              if (!isCallToSymbol(node, creatorSetSymbolIds, context)) return;
              const updaterArgument = node.arguments[0];
              if (!updaterArgument || isNodeOfType(updaterArgument, "SpreadElement")) return;
              const updaterFunction = resolveExactLocalFunction(updaterArgument, context.scopes);
              if (!updaterFunction) return;
              recordUpdaterFunctionNotifier(updaterFunction, setSymbolId);
              analyzeSetUpdater(updaterFunction, context, reportedNodes);
            });
          }
          if (!programNode || binding.storeSymbolIds.size === 0) continue;
          walkAst(programNode, (node: EsTreeNode) => {
            if (!isNodeOfType(node, "CallExpression")) return;
            const storeSymbolId = storeSymbolIdForMethodCall(node, "setState", context);
            if (storeSymbolId === null || !binding.storeSymbolIds.has(storeSymbolId)) return;
            bindingsWithBoundStoreNotifier.add(binding);
            const updaterArgument = node.arguments[0];
            if (!updaterArgument || isNodeOfType(updaterArgument, "SpreadElement")) return;
            const updaterFunction = resolveExactLocalFunction(updaterArgument, context.scopes);
            if (!updaterFunction) return;
            recordUpdaterFunctionNotifier(updaterFunction, storeSymbolId);
            analyzeSetUpdater(updaterFunction, context, reportedNodes);
          });
        }
        const analyzeProvenance = (
          getSymbolIds: ReadonlySet<number>,
          setSymbolIds: ReadonlySet<number>,
          snapshotStoreSymbolIds: ReadonlySet<number>,
          notifierStoreSymbolIds: ReadonlySet<number>,
        ): void => {
          if (programNode) {
            analyzeSnapshotContainer(
              programNode.body,
              getSymbolIds,
              setSymbolIds,
              snapshotStoreSymbolIds,
              notifierStoreSymbolIds,
              context,
              reportedNodes,
            );
          }
          for (const functionContainer of functionContainers) {
            if (!isFunctionLike(functionContainer)) continue;
            if (!isNodeOfType(functionContainer.body, "BlockStatement")) continue;
            const updaterNotifierSymbolIds =
              updaterFunctionNotifierSymbolIds.get(functionContainer);
            const isUpdaterNotifierForProvenance = Boolean(
              updaterNotifierSymbolIds &&
              Array.from(updaterNotifierSymbolIds).some(
                (notifierSymbolId) =>
                  setSymbolIds.has(notifierSymbolId) ||
                  notifierStoreSymbolIds.has(notifierSymbolId),
              ),
            );
            analyzeSnapshotContainer(
              functionContainer.body.body,
              getSymbolIds,
              setSymbolIds,
              snapshotStoreSymbolIds,
              notifierStoreSymbolIds,
              context,
              reportedNodes,
              isUpdaterNotifierForProvenance
                ? returnedExpressionsForFunction(functionContainer)
                : [],
            );
          }
        };
        for (const binding of creatorBindings.values()) {
          const getSymbolIds = new Set<number>();
          const setSymbolIds = new Set<number>();
          if (
            binding.getSymbol &&
            binding.setSymbol &&
            (binding.setSymbol.references.length > 0 || bindingsWithBoundStoreNotifier.has(binding))
          ) {
            getSymbolIds.add(binding.getSymbol.id);
          }
          if (binding.setSymbol) setSymbolIds.add(binding.setSymbol.id);
          analyzeProvenance(getSymbolIds, setSymbolIds, new Set<number>(), binding.storeSymbolIds);
          for (const storeSymbolId of binding.storeSymbolIds) {
            const storeSymbolIds = new Set([storeSymbolId]);
            analyzeProvenance(new Set<number>(), new Set<number>(), storeSymbolIds, storeSymbolIds);
          }
        }
      },
    };
  },
});
